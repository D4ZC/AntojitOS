import { ValidationPipe } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountsService } from "../src/accounts/accounts.service.js";
import { AccountingController } from "../src/accounting/accounting.controller.js";
import { AccountingService } from "../src/accounting/accounting.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import { AuthGuard } from "../src/auth/auth.guard.js";
import { AuthService } from "../src/auth/auth.service.js";
import { PermissionsGuard } from "../src/auth/permissions.guard.js";
import { CashController } from "../src/cash/cash.controller.js";
import { CashService } from "../src/cash/cash.service.js";
import { AppConfigService } from "../src/config/app-config.service.js";
import { DATABASE } from "../src/database/database.port.js";
import { provisionCashierAccounts } from "../src/database/provision-cashier.js";
import { runMigrations } from "../src/database/run-migrations.js";
import { EventsGateway } from "../src/events/events.gateway.js";
import { IdempotencyService } from "../src/idempotency/idempotency.service.js";
import { OutboxService } from "../src/outbox/outbox.service.js";
import { ProductionService } from "../src/production/production.service.js";
import { SalesController } from "../src/sales/sales.controller.js";
import { SalesService } from "../src/sales/sales.service.js";
import type { AuthContext } from "../src/security/auth-context.js";
import { createServiceFixture, fixtureIds } from "./service-fixture.js";
import type { TestDatabase } from "./test-database.js";

let database: TestDatabase | undefined;
let app: NestFastifyApplication | undefined;
afterEach(async () => {
  await app?.close(); app = undefined;
  await database?.close(); database = undefined;
  vi.unstubAllEnvs();
});
const setup = async () => {
  database = await createServiceFixture();
  await provisionCashierAccounts(database, { pin: "4567" });
  const config = new AppConfigService();
  const auth = new AuthService(database, config);
  const login = await auth.login({ terminalId: fixtureIds.terminalOne,
    employeeCode: "CAJERO", pin: "4567", deviceToken: "terminal-one" });
  const cashier = await auth.resolveToken(login.accessToken);
  const admin: AuthContext = { ...cashier, userId: fixtureIds.user, displayName: "Administrador",
    permissions: ["cash.shift.read", "cash.shift.open", "cash.shift.close", "cash.shift.preview", "cash.shift.reconcile", "sales.receipt.read"] };
  const audit = new AuditService();
  const idempotency = new IdempotencyService(database);
  const outbox = new OutboxService();
  const production = new ProductionService(database, audit, idempotency, outbox);
  const accounts = new AccountsService(database, audit, idempotency, outbox, production);
  const cash = new CashService(database, audit, idempotency, outbox);
  const sales = new SalesService(database, accounts, cash, audit, idempotency, outbox);
  const accounting = new AccountingService(database, audit, idempotency, outbox);
  const module = await Test.createTestingModule({
    controllers: [CashController, SalesController, AccountingController],
    providers: [
      { provide: DATABASE, useValue: database },
      { provide: AuthService, useValue: auth }, { provide: CashService, useValue: cash },
      { provide: SalesService, useValue: sales }, { provide: AccountingService, useValue: accounting },
      { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard },
    ],
  }).compile();
  app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  return { auth, cashier, admin, cash, accounts, sales,
    headers: { authorization: `Bearer ${login.accessToken}` } };
};
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const closeInput = { expectedVersion: 0, declarations: [
  { methodCode: "CASH" as const, declaredInCents: 49_000 },
  { methodCode: "CARD" as const, declaredInCents: 0 },
  { methodCode: "TRANSFER" as const, declaredInCents: 0 },
] };

describe("cajero con corte ciego", () => {
  it("actualiza una instalación existente y conserva el PIN al aplicar migraciones de nuevo", async () => {
    database = await createServiceFixture();
    vi.stubEnv("SEED_CASHIER_PIN", "4567");
    await database.query("DELETE FROM schema_migrations WHERE filename = '0016_cashier_blind_close.sql'");
    await runMigrations(database);
    const auth = new AuthService(database, new AppConfigService());
    const input = { terminalId: fixtureIds.terminalOne, employeeCode: "CAJERO", pin: "4567", deviceToken: "terminal-one" };
    expect((await auth.login(input)).user.permissions).toContain("cash.shift.close");
    const before = await database.query<{ pin_hash: string }>(
      "SELECT pin_hash FROM user_pin_credentials JOIN app_users ON app_users.id = user_id WHERE employee_code = 'CAJERO'",
    );
    vi.stubEnv("SEED_CASHIER_PIN", "9999");
    await runMigrations(database);
    await expect(auth.login(input)).resolves.toHaveProperty("accessToken");
    const after = await database.query<{ pin_hash: string }>(
      "SELECT pin_hash FROM user_pin_credentials JOIN app_users ON app_users.id = user_id WHERE employee_code = 'CAJERO'",
    );
    expect(after.rows[0]?.pin_hash).toBe(before.rows[0]?.pin_hash);
  });

  it("provisiona usuario independiente, conserva su PIN y niega reportes e historial por HTTP", async () => {
    const { auth, cashier, headers } = await setup();
    expect(cashier.permissions).toEqual(expect.arrayContaining([
      "cash.shift.open", "cash.shift.close", "sales.payment.capture", "customers.read", "customers.manage",
    ]));
    expect(cashier.permissions).not.toEqual(expect.arrayContaining([
      "cash.shift.preview", "cash.shift.reconcile", "accounting.manage", "sales.receipt.read",
    ]));
    for (const denied of ["cash.shift.preview", "cash.shift.reconcile", "accounting.manage", "sales.receipt.read", "audit.read", "terminal.manage", "production.ticket.read", "delivery.manage"]) {
      expect(cashier.permissions).not.toContain(denied);
    }
    await provisionCashierAccounts(database!, { pin: "9999" });
    await expect(auth.login({ terminalId: fixtureIds.terminalOne, employeeCode: "CAJERO", pin: "4567",
      deviceToken: "terminal-one" })).resolves.toHaveProperty("accessToken");
    for (const url of ["/v1/cash/shifts/current/report", "/v1/cash/shifts/closes", "/v1/sales/receipts", "/v1/accounting/summary", "/v1/accounting/bills", "/v1/accounting/suppliers"]) {
      const response = await app!.inject({ method: "GET", url, headers });
      expect(response.statusCode, url).toBe(403);
    }
  });

  it("permite cobrar y declarar sin revelar importes, guarda diferencias y limita el ticket de corte", async () => {
    const { cashier, admin, cash, accounts, sales, headers } = await setup();
    const opened = await cash.openShift({ openingFloatInCents: 50_000 }, "admin-open", admin);
    const current = await app!.inject({ method: "GET", url: "/v1/cash/current-shift", headers });
    expect(current.json()).toMatchObject({ blind: true, shift: { id: opened.body.shift.id, version: 0 } });
    expect(current.json().shift).not.toHaveProperty("openingFloatInCents");
    const openReplay = await cash.openShift({ openingFloatInCents: 50_000 }, "admin-open", cashier);
    expect(json(openReplay.body).shift).not.toHaveProperty("openingFloatInCents");
    const account = await accounts.open({ serviceType: "quick", guestCount: 1 }, "cashier-order", cashier);
    await accounts.addItem(account.body.id, { productId: fixtureIds.product, quantity: 1, expectedVersion: 0 }, "cashier-add", cashier);
    const sent = await accounts.sendRound(account.body.id, { expectedVersion: 1 }, "cashier-send", cashier);
    const receipt = await sales.checkout(account.body.id, { expectedVersion: sent.body.accountVersion,
      payments: [{ methodCode: "CASH", amountInCents: 1_000, tenderedInCents: 1_000, tipInCents: 0 }] }, "cashier-pay", cashier);
    expect(receipt.body.totals.saleInCents).toBe(1_000);
    const closed = await app!.inject({ method: "POST", url: "/v1/cash/shifts/current/close",
      headers: { ...headers, "idempotency-key": "cashier-close" }, payload: closeInput });
    expect(closed.statusCode).toBe(201);
    const body = closed.json();
    expect(body).toMatchObject({ blind: true, status: "closed", declarations: [
      { method: { code: "CASH" }, declaredInCents: 49_000 },
      { method: { code: "CARD" }, declaredInCents: 0 },
      { method: { code: "TRANSFER" }, declaredInCents: 0 },
    ] });
    expect(JSON.stringify(body)).not.toMatch(/report|theoreticalInCents|differenceInCents|openingFloatInCents/u);
    const printed = await database!.query<{ payload: { close: unknown } }>("SELECT payload FROM print_jobs WHERE kind = 'shift_close'");
    expect(JSON.stringify(printed.rows[0]!.payload.close)).not.toMatch(/report|theoreticalInCents|differenceInCents|openingFloatInCents/u);
    const history = await cash.closedShifts(admin);
    expect(history.closes[0]).toMatchObject({ report: { cash: { theoreticalInCents: 51_000 } },
      declarations: [ { theoreticalInCents: 51_000, declaredInCents: 49_000, differenceInCents: -2_000 }, {}, {} ] });
    await expect(cash.closedShifts(cashier)).rejects.toThrow("Permiso insuficiente");
    await expect(cash.currentReport(cashier)).rejects.toThrow("Permiso insuficiente");
  });

  it("redacta también el replay de un cierre administrador y los eventos financieros en vivo", async () => {
    const { admin, cashier, cash, auth } = await setup();
    await cash.openShift({ openingFloatInCents: 50_000 }, "open-replay-close", admin);
    const full = await cash.closeShift(closeInput, "admin-close", admin);
    expect(full.body.declarations[0]?.differenceInCents).toBe(-1_000);
    const replay = await cash.closeShift(closeInput, "admin-close", cashier);
    expect(replay.replayed).toBe(true);
    expect(JSON.stringify(json(replay.body))).not.toMatch(/report|theoreticalInCents|differenceInCents|openingFloatInCents/u);
    const emit = vi.fn();
    const gateway = new EventsGateway(auth);
    Object.assign(gateway, { server: { to: () => ({ emit }) } });
    gateway.publish(fixtureIds.site, "cash.shift.closed", { closeId: "close", declarations: [{ differenceInCents: -100 }] });
    gateway.publish(fixtureIds.site, "sale.completed", { receiptId: "receipt", totalInCents: 12_000, tipInCents: 500 });
    expect(emit.mock.calls).toEqual([
      ["cash.shift.closed", { closeId: "close" }], ["sale.completed", { receiptId: "receipt" }],
    ]);
  });
});
