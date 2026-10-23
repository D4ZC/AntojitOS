import { BadRequestException, ConflictException, NotFoundException, ValidationPipe } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it } from "vitest";
import { AccountingController } from "../src/accounting/accounting.controller.js";
import { AccountingService } from "../src/accounting/accounting.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import { AuthGuard } from "../src/auth/auth.guard.js";
import { AuthService } from "../src/auth/auth.service.js";
import { PermissionsGuard } from "../src/auth/permissions.guard.js";
import { CashService } from "../src/cash/cash.service.js";
import { DATABASE } from "../src/database/database.port.js";
import { runMigrations } from "../src/database/run-migrations.js";
import { IdempotencyService } from "../src/idempotency/idempotency.service.js";
import { OutboxService } from "../src/outbox/outbox.service.js";
import type { AuthContext } from "../src/security/auth-context.js";
import { createServiceFixture, fixtureIds } from "./service-fixture.js";
import type { TestDatabase } from "./test-database.js";

const actor = (): AuthContext => ({ sessionId: crypto.randomUUID(), siteId: fixtureIds.site,
  userId: fixtureIds.user, terminalId: fixtureIds.terminalOne, displayName: "Administrador",
  permissions: ["accounting.manage"] });
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City",
  year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const services = (database: TestDatabase) => {
  const audit = new AuditService(); const idempotency = new IdempotencyService(database);
  const outbox = new OutboxService();
  return { accounting: new AccountingService(database, audit, idempotency, outbox),
    cash: new CashService(database, audit, idempotency, outbox) };
};
let database: TestDatabase | undefined;
let app: NestFastifyApplication | undefined;
afterEach(async () => { await app?.close(); app = undefined; await database?.close(); database = undefined; });

describe("contabilidad administrativa", () => {
  it("registra proveedores y cargos generales, conserva versiones e idempotencia", async () => {
    database = await createServiceFixture();
    const { accounting } = services(database); const admin = actor();
    const input = { name: "  Tortillería Pérez  ", phone: "555123", taxId: "RFC123", notes: "Entrega diaria" };
    const created = await accounting.createSupplier(input, "supplier", admin);
    const replay = await accounting.createSupplier(input, "supplier", admin);
    expect(replay.replayed).toBe(true);
    expect(created.body.supplier).toMatchObject({ name: "Tortillería Pérez", active: true, version: 0 });
    const supplier = await accounting.updateSupplier(created.body.supplier.id,
      { expectedVersion: 0, contactName: "Ana", notes: "" }, "update", admin);
    expect(supplier.body.supplier).toMatchObject({ version: 1, contactName: "Ana", notes: null });
    await expect(accounting.updateSupplier(created.body.supplier.id,
      { expectedVersion: 0, active: false }, "stale", admin)).rejects.toBeInstanceOf(ConflictException);
    const bill = await accounting.createBill({ supplierId: supplier.body.supplier.id,
      description: "Tortillas", amountInCents: 25000, issuedOn: "2026-10-01", dueOn: "2026-10-15" }, "bill", admin);
    expect(bill.body.bill).toMatchObject({ supplierName: "Tortillería Pérez", amountInCents: 25000,
      paidInCents: 0, outstandingInCents: 25000, issuedOn: "2026-10-01", dueOn: "2026-10-15", version: 0 });
    const rent = await accounting.createBill({ description: "Renta", amountInCents: 100000, issuedOn: "2026-10-01" }, "rent", admin);
    expect(rent.body.bill).toMatchObject({ supplierId: null, supplierName: null });
    expect((await accounting.bills(admin)).bills).toHaveLength(2);
    expect((await accounting.suppliers(admin)).suppliers).toHaveLength(1);
    expect((await database.query("SELECT id FROM audit_events WHERE action LIKE 'accounting.%'")).rowCount).toBe(4);
    await expect(accounting.createSupplier({ name: "Otra" }, "supplier", admin)).rejects.toBeInstanceOf(ConflictException);
  });

  it("acepta abonos fuera de caja, rechaza sobrepagos y permite anular sin borrar historial", async () => {
    database = await createServiceFixture();
    const { accounting } = services(database); const admin = actor();
    const created = await accounting.createBill({ description: "Luz", amountInCents: 9000, issuedOn: "2026-10-01" }, "bill", admin);
    const id = created.body.bill.id;
    const paymentInput = { expectedVersion: 0, amountInCents: 4000, methodCode: "TRANSFER" as const,
      paidOn: "2026-10-02", source: "external" as const, reference: "TRANSFER-1" };
    const first = await accounting.payBill(id, paymentInput, "payment", admin);
    const replay = await accounting.payBill(id, paymentInput, "payment", admin);
    expect(replay.replayed).toBe(true);
    expect(first.body.bill).toMatchObject({ version: 1, paidInCents: 4000, outstandingInCents: 5000 });
    expect((await database.query("SELECT id FROM cash_movements")).rowCount).toBe(0);
    await expect(accounting.payBill(id, { ...paymentInput, expectedVersion: 1, amountInCents: 5001 }, "excess", admin))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(accounting.payBill(id, { ...paymentInput, amountInCents: 5000 }, "stale", admin))
      .rejects.toBeInstanceOf(ConflictException);
    const paid = await accounting.payBill(id, { ...paymentInput, expectedVersion: 1, amountInCents: 5000 }, "remaining", admin);
    expect(paid.body.bill).toMatchObject({ paidInCents: 9000, outstandingInCents: 0, version: 2 });
    expect((await accounting.summary({ from: "2026-10-02", to: "2026-10-02" }, admin)).expenses.supplierPaymentsInCents).toBe(9000);
    const paymentId = first.body.bill.payments[0]!.id;
    const voided = await accounting.voidPayment(id, paymentId, { expectedVersion: 2, reason: "Pago duplicado" }, "void", admin);
    expect(voided.body.bill).toMatchObject({ version: 3, paidInCents: 5000, outstandingInCents: 4000 });
    expect(voided.body.bill.payments).toHaveLength(2);
    expect(voided.body.bill.payments[0]).toMatchObject({ voidReason: "Pago duplicado", voidedAt: expect.any(String) });
    // Una corrección posterior retira el importe del periodo original del pago; conserva el historial.
    expect((await accounting.summary({ from: "2026-10-02", to: "2026-10-02" }, admin)).expenses.supplierPaymentsInCents).toBe(5000);
    await expect(accounting.voidPayment(id, paymentId, { expectedVersion: 3, reason: "Otra vez" }, "void-again", admin))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it("anula un cargo erróneo sin borrar su historial y bloquea nuevos pagos", async () => {
    database = await createServiceFixture();
    const { accounting } = services(database); const admin = actor();
    const bill = (await accounting.createBill({ description: "Cargo duplicado", amountInCents: 7000, issuedOn: today() }, "bill", admin)).body.bill;
    expect((await accounting.summary({}, admin)).outstandingInCents).toBe(7000);
    const input = { expectedVersion: 0, reason: "Captura duplicada" };
    const voided = await accounting.voidBill(bill.id, input, "void-bill", admin);
    expect(voided.body.bill).toMatchObject({ amountInCents: 7000, paidInCents: 0, outstandingInCents: 0,
      version: 1, voidedAt: expect.any(String), voidReason: "Captura duplicada" });
    expect((await accounting.voidBill(bill.id, input, "void-bill", admin)).replayed).toBe(true);
    expect((await accounting.bills(admin)).bills).toHaveLength(1);
    expect((await accounting.summary({}, admin)).outstandingInCents).toBe(0);
    await expect(accounting.payBill(bill.id, { expectedVersion: 1, amountInCents: 1000,
      methodCode: "CASH", source: "external", paidOn: today() }, "pay-void", admin)).rejects.toBeInstanceOf(ConflictException);
    await expect(accounting.voidBill(bill.id, { expectedVersion: 1, reason: "Otra vez" }, "void-twice", admin))
      .rejects.toBeInstanceOf(ConflictException);
    expect((await database.query("SELECT id FROM audit_events WHERE action = 'accounting.bill.voided'")).rowCount).toBe(1);
  });

  it("exige anular todos los abonos antes de anular un cargo y conserva ambos historiales", async () => {
    database = await createServiceFixture();
    const { accounting } = services(database); const admin = actor();
    const bill = (await accounting.createBill({ description: "Compra equivocada", amountInCents: 7000, issuedOn: today() }, "bill", admin)).body.bill;
    const paid = (await accounting.payBill(bill.id, { expectedVersion: 0, amountInCents: 3000,
      methodCode: "TRANSFER", source: "external", paidOn: today() }, "pay", admin)).body.bill;
    await expect(accounting.voidBill(bill.id, { expectedVersion: 1, reason: "Error" }, "void-with-payment", admin))
      .rejects.toBeInstanceOf(ConflictException);
    const corrected = (await accounting.voidPayment(bill.id, paid.payments[0]!.id,
      { expectedVersion: 1, reason: "Pago equivocado" }, "void-payment", admin)).body.bill;
    await expect(accounting.voidBill(bill.id, { expectedVersion: 1, reason: "Error" }, "void-stale", admin))
      .rejects.toBeInstanceOf(ConflictException);
    const voided = (await accounting.voidBill(bill.id,
      { expectedVersion: corrected.version, reason: "Cargo equivocado" }, "void-bill", admin)).body.bill;
    expect(voided).toMatchObject({ version: 3, outstandingInCents: 0, voidReason: "Cargo equivocado" });
    expect(voided.payments[0]).toMatchObject({ voidReason: "Pago equivocado", amountInCents: 3000 });
    expect((await accounting.summary({}, admin)).outstandingInCents).toBe(0);
  });

  it("integra pago y reverso de efectivo en el mismo turno sin duplicar egresos", async () => {
    database = await createServiceFixture();
    const { accounting, cash } = services(database); const admin = actor();
    const bill = (await accounting.createBill({ description: "Verduras", amountInCents: 20000, issuedOn: today() }, "bill", admin)).body.bill;
    const input = { expectedVersion: 0, amountInCents: 4000, methodCode: "CASH" as const, paidOn: today(), source: "business_cash" as const };
    await expect(accounting.payBill(bill.id, input, "no-cash", admin)).rejects.toBeInstanceOf(ConflictException);
    await cash.openShift({ openingFloatInCents: 50000 }, "cash", admin);
    await expect(accounting.payBill(bill.id, input, "wrong-terminal", { ...admin, terminalId: fixtureIds.terminalTwo }))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(accounting.payBill(bill.id, { ...input, paidOn: "2020-01-01" }, "old", admin)).rejects.toBeInstanceOf(BadRequestException);
    const paid = await accounting.payBill(bill.id, input, "pay-cash", admin);
    await accounting.payBill(bill.id, input, "pay-cash", admin);
    await cash.createMovement({ direction: "out", amountInCents: 1000, reason: "Compra pequeña" }, "manual", admin);
    const summary = await accounting.summary({ from: today(), to: today() }, admin);
    expect(summary.expenses).toEqual({ supplierPaymentsInCents: 4000, manualCashOutInCents: 1000, totalInCents: 5000 });
    expect((await cash.currentReport(admin)).cash.theoreticalInCents).toBe(45000);
    expect((await database.query("SELECT id FROM accounting_supplier_payments")).rowCount).toBe(1);
    expect(paid.body.bill.payments[0]?.cashMovementId).toEqual(expect.any(String));
    const voided = await accounting.voidPayment(bill.id, paid.body.bill.payments[0]!.id,
      { expectedVersion: 1, reason: "Importe incorrecto" }, "undo-cash", admin);
    expect(voided.body.bill.payments[0]?.reversalCashMovementId).toEqual(expect.any(String));
    expect((await cash.currentReport(admin)).cash.theoreticalInCents).toBe(49000);
    expect((await accounting.summary({ from: today(), to: today() }, admin)).expenses)
      .toEqual({ supplierPaymentsInCents: 0, manualCashOutInCents: 1000, totalInCents: 1000 });
  });

  it("no modifica cortes cerrados al intentar anular efectivo", async () => {
    database = await createServiceFixture();
    const { accounting, cash } = services(database); const admin = actor();
    const shift = await cash.openShift({ openingFloatInCents: 10000 }, "cash", admin);
    const bill = (await accounting.createBill({ description: "Gas", amountInCents: 1000, issuedOn: today() }, "bill", admin)).body.bill;
    const paid = await accounting.payBill(bill.id, { expectedVersion: 0, amountInCents: 1000,
      methodCode: "CASH", paidOn: today(), source: "business_cash" }, "pay", admin);
    await database.query("UPDATE cash_shifts SET status = 'closed' WHERE id = $1", [shift.body.shift.id]);
    await expect(accounting.voidPayment(bill.id, paid.body.bill.payments[0]!.id,
      { expectedVersion: 1, reason: "Error" }, "void", admin)).rejects.toBeInstanceOf(ConflictException);
    expect((await accounting.bills(admin)).bills[0]).toMatchObject({ version: 1, paidInCents: 1000 });
    expect((await database.query("SELECT id FROM cash_movements WHERE type = 'cash_in'")).rowCount).toBe(0);
  });

  it("aísla proveedores, cargos y pagos por sucursal", async () => {
    database = await createServiceFixture();
    const { accounting } = services(database); const admin = actor();
    const supplier = (await accounting.createSupplier({ name: "Proveedor" }, "supplier", admin)).body.supplier;
    const bill = (await accounting.createBill({ supplierId: supplier.id, description: "Compra", amountInCents: 1000, issuedOn: today() }, "bill", admin)).body.bill;
    const other = { ...admin, siteId: "20000000-0000-4000-8000-000000000001" };
    await database.query("INSERT INTO sites (id, code, name) VALUES ($1, 'OTHER', 'Otra')", [other.siteId]);
    expect(await accounting.suppliers(other)).toEqual({ suppliers: [] });
    expect(await accounting.bills(other)).toEqual({ bills: [] });
    await expect(accounting.createBill({ supplierId: supplier.id, description: "Cruce", amountInCents: 1000, issuedOn: today() }, "cross", other))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(accounting.payBill(bill.id, { expectedVersion: 0, amountInCents: 1000, methodCode: "CASH", paidOn: today(), source: "external" }, "pay", other))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it("valida importes y fechas reales y bloquea proveedores inactivos", async () => {
    database = await createServiceFixture();
    const { accounting } = services(database); const admin = actor();
    for (const amountInCents of [0, -1, 1.5, 100_000_001, NaN]) {
      await expect(accounting.createBill({ description: "Cargo", amountInCents, issuedOn: today() }, `bad-${amountInCents}`, admin))
        .rejects.toBeInstanceOf(BadRequestException);
    }
    for (const issuedOn of ["2026-02-30", "2026-13-01", "2026-1-01", "0000-01-01"]) {
      await expect(accounting.createBill({ description: "Cargo", amountInCents: 100, issuedOn }, `date-${issuedOn}`, admin))
        .rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(accounting.createBill({ description: "Cargo", amountInCents: 100, issuedOn: "2026-10-10", dueOn: "2026-10-01" }, "due", admin))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(accounting.summary({ from: "2026-10-20", to: "2026-10-01" }, admin)).rejects.toBeInstanceOf(BadRequestException);
    const supplier = (await accounting.createSupplier({ name: "Proveedor" }, "supplier", admin)).body.supplier;
    await accounting.updateSupplier(supplier.id, { expectedVersion: 0, active: false }, "disable", admin);
    await expect(accounting.createBill({ supplierId: supplier.id, description: "Cargo", amountInCents: 100, issuedOn: today() }, "inactive", admin))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it("calcula ventas y devoluciones por su fecha local y excluye las devoluciones de gastos manuales", async () => {
    database = await createServiceFixture();
    const { accounting, cash } = services(database); const admin = actor();
    const shift = (await cash.openShift({ openingFloatInCents: 0 }, "shift", admin)).body.shift;
    const accountId = crypto.randomUUID(); const receiptId = crypto.randomUUID(); const refundId = crypto.randomUUID();
    await database.query(`INSERT INTO service_accounts (id, account_group_id, site_id, service_type,
      responsible_user_id, opened_by_user_id, opened_on_terminal_id, status)
      VALUES ($1,$1,$2,'quick',$3,$3,$4,'closed')`, [accountId, admin.siteId, admin.userId, admin.terminalId]);
    await database.query(`INSERT INTO sales_receipts (id, site_id, account_id, shift_id, folio_number, folio,
      subtotal_in_cents,discount_in_cents,tax_in_cents,total_in_cents,snapshot,issued_by_user_id,issued_on_terminal_id,issued_at)
      VALUES ($1,$2,$3,$4,1,'T-000001',10000,0,0,10000,'{}',$5,$6,'2026-10-02T05:30:00Z')`,
    [receiptId, admin.siteId, accountId, shift.id, admin.userId, admin.terminalId]);
    await database.query(`INSERT INTO sales_refunds (id,site_id,receipt_id,shift_id,kind,sale_in_cents,reason,snapshot,
      created_by_user_id,created_on_terminal_id,created_at)
      VALUES ($1,$2,$3,$4,'refund',10000,'Error','{}',$5,$6,'2026-10-02T06:30:00Z')`,
    [refundId, admin.siteId, receiptId, shift.id, admin.userId, admin.terminalId]);
    await database.query(`INSERT INTO cash_movements (id,site_id,shift_id,type,direction,amount_in_cents,
      refund_id,created_by_user_id,created_on_terminal_id,created_at)
      VALUES ($1,$2,$3,'cash_out','out',10000,$4,$5,$6,'2026-10-02T06:30:00Z')`,
    [crypto.randomUUID(),admin.siteId,shift.id,refundId,admin.userId,admin.terminalId]);
    const first = await accounting.summary({ from: "2026-10-01", to: "2026-10-01" }, admin);
    expect(first.sales).toEqual({ grossInCents: 10000, refundedInCents: 0, netInCents: 10000, receiptCount: 1 });
    const second = await accounting.summary({ from: "2026-10-02", to: "2026-10-02" }, admin);
    expect(second.sales).toEqual({ grossInCents: 0, refundedInCents: 10000, netInCents: -10000, receiptCount: 0 });
    expect(second.expenses.totalInCents).toBe(0);
  });

  it("otorga permiso en migración exclusivamente al rol administrador", async () => {
    database = await createServiceFixture();
    await database.query(`INSERT INTO roles (id, site_id, code, name) VALUES
      ('30000000-0000-4000-8000-000000000001',$1,'ADMINISTRATOR','Administrador'),
      ('30000000-0000-4000-8000-000000000002',$1,'CASHIER','Cajero')`, [fixtureIds.site]);
    await database.query("DELETE FROM schema_migrations WHERE filename = '0010_administrative_accounting.sql'");
    await database.query("DROP TABLE accounting_supplier_payments; DROP TABLE accounting_bills; DROP TABLE accounting_suppliers;");
    await runMigrations(database);
    expect((await database.query<{ code: string }>(`SELECT r.code FROM roles r
      JOIN role_permissions rp ON rp.role_id = r.id WHERE rp.permission_code = 'accounting.manage'`)).rows)
      .toEqual([{ code: "ADMINISTRATOR" }]);
  });

  it("protege todos los endpoints y valida el cuerpo HTTP, además de exigir idempotencia", async () => {
    database = await createServiceFixture();
    const admin = actor();
    const module = await Test.createTestingModule({ controllers: [AccountingController], providers: [
      AccountingService, AuditService, IdempotencyService, OutboxService,
      { provide: DATABASE, useValue: database },
      { provide: AuthService, useValue: { resolveToken: async (token: string) => ({ ...admin, permissions: token === "admin" ? ["accounting.manage"] : [] }) } },
      { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard },
    ] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    const id = "30000000-0000-4000-8000-000000000001";
    const endpoints = [
      ["GET", "/v1/accounting/suppliers"], ["POST", "/v1/accounting/suppliers"], ["PATCH", `/v1/accounting/suppliers/${id}`],
      ["GET", "/v1/accounting/bills"], ["POST", "/v1/accounting/bills"], ["GET", "/v1/accounting/summary"],
      ["POST", `/v1/accounting/bills/${id}/payments`], ["POST", `/v1/accounting/bills/${id}/payments/${id}/voids`],
      ["POST", `/v1/accounting/bills/${id}/voids`],
    ] as const;
    for (const [method, url] of endpoints) {
      expect((await app.inject({ method, url })).statusCode).toBe(401);
      expect((await app.inject({ method, url, headers: { authorization: "Bearer cashier" } })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: "POST", url: "/v1/accounting/suppliers",
      headers: { authorization: "Bearer admin" }, payload: { name: "Proveedor" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/accounting/bills", headers: { authorization: "Bearer admin", "idempotency-key": "invalid" },
      payload: { description: "Renta", amountInCents: -1, issuedOn: today() } })).statusCode).toBe(400);
    const created = await app.inject({ method: "POST", url: "/v1/accounting/bills", headers: { authorization: "Bearer admin", "idempotency-key": "rent" },
      payload: { description: "Renta", amountInCents: 10000, issuedOn: today(), supplierId: null, dueOn: null, reference: null } });
    expect(created.statusCode).toBe(201);
    expect(created.json().bill).toMatchObject({ supplierId: null, description: "Renta", outstandingInCents: 10000 });
  });
});
