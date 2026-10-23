import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterEach, describe, expect, it } from "vitest";
import { AccountsService } from "../src/accounts/accounts.service.js";
import { AppModule } from "../src/app.module.js";
import { AuditService } from "../src/audit/audit.service.js";
import { AuthService } from "../src/auth/auth.service.js";
import { CashService } from "../src/cash/cash.service.js";
import { DATABASE } from "../src/database/database.port.js";
import { DeliveryModule } from "../src/delivery/delivery.module.js";
import { DeliveryService } from "../src/delivery/delivery.service.js";
import { IdempotencyService } from "../src/idempotency/idempotency.service.js";
import { OutboxService } from "../src/outbox/outbox.service.js";
import { ProductionService } from "../src/production/production.service.js";
import { SalesService } from "../src/sales/sales.service.js";
import type { AuthContext } from "../src/security/auth-context.js";
import { createServiceFixture, fixtureIds } from "./service-fixture.js";
import type { TestDatabase } from "./test-database.js";

const operator: AuthContext = {
  sessionId: crypto.randomUUID(), siteId: fixtureIds.site, userId: fixtureIds.user,
  terminalId: fixtureIds.terminalOne, displayName: "Operador",
  permissions: ["delivery.manage", "service.account.open", "service.item.add", "service.item.edit", "service.item.cancel", "service.round.send"],
};

const services = (database: TestDatabase) => {
  const audit = new AuditService();
  const idempotency = new IdempotencyService(database);
  const outbox = new OutboxService();
  const production = new ProductionService(database, audit, idempotency, outbox);
  const accounts = new AccountsService(database, audit, idempotency, outbox, production);
  const delivery = new DeliveryService(database, audit, idempotency, accounts);
  const cash = new CashService(database, audit, idempotency, outbox);
  const sales = new SalesService(database, accounts, cash, audit, idempotency, outbox);
  return { accounts, delivery, cash, sales };
};

let database: TestDatabase | undefined;
let app: NestFastifyApplication | undefined;
afterEach(async () => {
  if (app) await app.close();
  else await database?.close();
  app = undefined;
  database = undefined;
});

const prepare = async (database: TestDatabase) => {
  const { accounts, delivery } = services(database);
  const driver = (await delivery.createDriver({ name: "  Luis  ", phone: " 5551234567 " }, "driver", operator)).body.driver;
  const account = (await accounts.open({ serviceType: "takeaway", guestCount: 1, customerName: "Ana" }, "open", operator)).body;
  const added = await accounts.addItem(account.id, {
    productId: fixtureIds.product, quantity: 2, expectedVersion: 0, note: "Con todo",
    modifierIds: [fixtureIds.modifier],
  }, "add", operator);
  const input = { accountId: account.id, driverId: driver.id, expectedAccountVersion: 1, address: " Calle 3 #20 ", phone: "5552223333", notes: "Puerta azul" };
  const assignment = (await delivery.createAssignment(input, "assign", operator)).body.assignment;
  return { accounts, delivery, driver, account, item: added.body.item, assignment, input };
};

describe("repartidores y comandas móviles aisladas", () => {
  it("crea repartidores y asignaciones una sola vez con totales y notas congelados", async () => {
    database = await createServiceFixture();
    const { delivery, account, assignment, input, driver } = await prepare(database);
    expect(driver).toMatchObject({ name: "Luis", phone: "5551234567", active: true });
    expect((await delivery.drivers(operator)).drivers).toEqual([driver]);
    expect(assignment).toMatchObject({
      accountId: account.id, driverId: driver.id, status: "assigned", version: 0,
      accountVersion: 1, customerName: "Ana", address: "Calle 3 #20", accountChanged: false,
      snapshot: { customerName: "Ana", totalInCents: 2400, items: [{
        productName: "Taco de prueba", quantity: 2, note: "Con todo", modifiers: ["Extra"], lineTotalInCents: 2400,
      }] },
    });
    const replay = await delivery.createAssignment(input, "assign", operator);
    expect(replay.replayed).toBe(true);
    expect(replay.body.assignment.id).toBe(assignment.id);
    expect((await delivery.assignments(operator)).assignments).toEqual([assignment]);
    await expect(delivery.createAssignment(input, "duplicate", operator)).rejects.toBeInstanceOf(ConflictException);
    await expect(delivery.createDriver({ name: "Otro" }, "driver", operator)).rejects.toBeInstanceOf(ConflictException);
    expect((await database.query("SELECT id FROM audit_events WHERE action = 'delivery.assigned'")).rowCount).toBe(1);
  });

  it("rechaza sin permiso, sucursal ajena, cuenta vacía y versión anterior", async () => {
    database = await createServiceFixture();
    const { delivery, accounts, input } = await prepare(database);
    const restricted = { ...operator, permissions: [] };
    await expect(delivery.drivers(restricted)).rejects.toBeInstanceOf(ForbiddenException);
    expect(() => delivery.createDriver({ name: "Luis" }, "not-allowed", restricted)).toThrow(ForbiddenException);
    expect(() => delivery.createDriver({ name: " " }, "empty-driver", operator)).toThrow(BadRequestException);
    expect(() => delivery.createAssignment({ ...input, address: " " }, "empty-address", operator)).toThrow(BadRequestException);
    const empty = await accounts.open({ serviceType: "quick", guestCount: 1 }, "empty", operator);
    await expect(delivery.createAssignment({ ...input, accountId: empty.body.id, expectedAccountVersion: 0 }, "empty-assign", operator))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(delivery.createAssignment({ ...input, expectedAccountVersion: 0 }, "stale-assign", operator))
      .rejects.toBeInstanceOf(ConflictException);
    const otherSite = crypto.randomUUID();
    await database.query("INSERT INTO sites (id, code, name) VALUES ($1, 'OTHER', 'Otra')", [otherSite]);
    const otherDriver = crypto.randomUUID();
    await database.query("INSERT INTO delivery_drivers (id, site_id, name) VALUES ($1, $2, 'Ajeno')", [otherDriver, otherSite]);
    await expect(delivery.createAssignment({ ...input, driverId: otherDriver }, "foreign-driver", operator))
      .rejects.toBeInstanceOf(NotFoundException);
    expect((await delivery.assignments({ ...operator, siteId: otherSite })).assignments).toEqual([]);
    await expect(delivery.createAssignment(input, "foreign-account", { ...operator, siteId: otherSite }))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it("cambia estados con versión y auditoría sin cobrar ni cerrar la cuenta", async () => {
    database = await createServiceFixture();
    const { delivery, accounts, assignment, account } = await prepare(database);
    const sent = await delivery.updateStatus(assignment.id, { expectedVersion: 0, status: "out_for_delivery" }, "out", operator);
    expect(sent.body.assignment).toMatchObject({ status: "out_for_delivery", version: 1 });
    const replay = await delivery.updateStatus(assignment.id, { expectedVersion: 0, status: "out_for_delivery" }, "out", operator);
    expect(replay.replayed).toBe(true);
    await expect(delivery.updateStatus(assignment.id, { expectedVersion: 0, status: "delivered" }, "stale", operator))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(delivery.updateStatus(assignment.id, { expectedVersion: 1, status: "assigned" }, "back", operator))
      .rejects.toBeInstanceOf(ConflictException);
    const done = await delivery.updateStatus(assignment.id, { expectedVersion: 1, status: "delivered" }, "done", operator);
    expect(done.body.assignment).toMatchObject({ status: "delivered", version: 2 });
    expect(await accounts.get(account.id, operator)).toMatchObject({ status: "open", version: 1, totalInCents: 2400 });
    expect((await database.query("SELECT id FROM sales_receipts")).rowCount).toBe(0);
    expect((await database.query("SELECT id FROM payments")).rowCount).toBe(0);
    expect((await database.query("SELECT id FROM audit_events WHERE action = 'delivery.status.updated'")).rowCount).toBe(2);
  });

  it("excluye artículos cancelados y conserva el total real al actualizar la comanda", async () => {
    database = await createServiceFixture();
    const { delivery, accounts, assignment, account } = await prepare(database);
    const extra = await accounts.addItem(account.id, { productId: fixtureIds.product, quantity: 1, expectedVersion: 1, note: "Cancelado" }, "extra", operator);
    await accounts.cancelItem(account.id, extra.body.item.id, { expectedVersion: 2, reason: "Cancelado por cliente" }, "cancel-extra", operator);
    const refreshed = await delivery.refresh(assignment.id, { expectedVersion: 0, expectedAccountVersion: 3 }, "refresh-cancelled", operator);
    expect(refreshed.body.assignment.snapshot.items).toHaveLength(1);
    expect(refreshed.body.assignment.snapshot.totalInCents).toBe(2400);
    expect(refreshed.body.assignment.snapshot.items[0]?.note).toBe("Con todo");
  });

  it("actualiza una entrega ya finalizada después del cobro sin reabrir sus estados", async () => {
    database = await createServiceFixture();
    const { accounts, delivery, assignment, account } = await prepare(database);
    const { cash, sales } = services(database);
    const sent = await accounts.sendRound(account.id, { expectedVersion: 1 }, "send-delivered", operator);
    const ready = await delivery.refresh(assignment.id, {
      expectedVersion: 0, expectedAccountVersion: sent.body.accountVersion,
    }, "refresh-before-delivery", operator);
    const link = await delivery.share(assignment.id, { expectedVersion: ready.body.assignment.version }, operator);
    const done = await delivery.updateStatus(assignment.id, {
      expectedVersion: link.version, status: "delivered",
    }, "deliver-before-payment", operator);
    await cash.openShift({ openingFloatInCents: 0 }, "delivery-cash", operator);
    await sales.checkout(account.id, {
      expectedVersion: sent.body.accountVersion,
      payments: [{ methodCode: "CASH", amountInCents: 2400, tipInCents: 0, tenderedInCents: 2400 }],
    }, "pay-delivered", operator);
    await expect(delivery.shared(link.token)).rejects.toBeInstanceOf(NotFoundException);
    const current = await accounts.get(account.id, operator);
    expect(current.status).toBe("closed");
    const refreshed = await delivery.refresh(assignment.id, {
      expectedVersion: done.body.assignment.version, expectedAccountVersion: current.version,
    }, "refresh-paid-delivery", operator);
    expect(refreshed.body.assignment).toMatchObject({
      status: "delivered", accountChanged: false,
      snapshot: { accountStatus: "closed", accountVersion: current.version, totalInCents: 2400 },
    });
    const renewed = await delivery.share(assignment.id, { expectedVersion: refreshed.body.assignment.version }, operator);
    expect((await delivery.shared(renewed.token)).assignment.snapshot.accountStatus).toBe("closed");
    for (const status of ["assigned", "out_for_delivery", "cancelled"] as const) {
      await expect(delivery.updateStatus(assignment.id, {
        expectedVersion: renewed.version, status,
      }, `delivered-cannot-${status}`, operator)).rejects.toBeInstanceOf(ConflictException);
    }
    expect((await accounts.get(account.id, operator)).status).toBe("closed");
  });

  it.each(["cancellation", "refund"] as const)("bloquea reparto de una venta con %s y permite cancelar la asignación", async (kind) => {
    database = await createServiceFixture();
    const { accounts, delivery, cash, sales } = services(database);
    const opened = await accounts.open({ serviceType: "takeaway", guestCount: 1 }, `sale-${kind}`, operator);
    await accounts.addItem(opened.body.id, {
      productId: fixtureIds.product, quantity: 1, expectedVersion: 0,
    }, `add-${kind}`, operator);
    await accounts.sendRound(opened.body.id, { expectedVersion: 1 }, `send-${kind}`, operator);
    await cash.openShift({ openingFloatInCents: 0 }, `shift-${kind}`, operator);
    const receipt = await sales.checkout(opened.body.id, {
      expectedVersion: 2, payments: [{ methodCode: "CASH", amountInCents: 1000, tipInCents: 0 }],
    }, `checkout-${kind}`, operator);
    const account = await accounts.get(opened.body.id, operator);
    const driver = await delivery.createDriver({ name: "Luis" }, `driver-${kind}`, operator);
    const input = { accountId: account.id, expectedAccountVersion: account.version,
      driverId: driver.body.driver.id, address: "Calle 3" };
    const assignment = (await delivery.createAssignment(input, `assign-${kind}`, operator)).body.assignment;
    const link = await delivery.share(assignment.id, { expectedVersion: 0 }, operator);
    await sales.refundReceipt(receipt.body.id, { kind, reason: "Cliente canceló" }, `refund-${kind}`, operator);
    expect((await delivery.assignments(operator)).assignments[0]).toMatchObject({
      accountChanged: true, accountUnavailable: true, status: "assigned",
    });
    await expect(delivery.shared(link.token)).rejects.toBeInstanceOf(NotFoundException);
    await expect(delivery.share(assignment.id, { expectedVersion: link.version }, operator))
      .rejects.toThrow("cancelada o reembolsada");
    await expect(delivery.refresh(assignment.id, {
      expectedVersion: link.version, expectedAccountVersion: account.version,
    }, `refresh-${kind}`, operator)).rejects.toThrow("cancelada o reembolsada");
    for (const status of ["out_for_delivery", "delivered"] as const) {
      await expect(delivery.updateStatus(assignment.id, {
        expectedVersion: link.version, status,
      }, `${status}-${kind}`, operator)).rejects.toThrow("cancelada o reembolsada");
    }
    await delivery.updateStatus(assignment.id, {
      expectedVersion: link.version, status: "cancelled",
    }, `cancel-delivery-${kind}`, operator);
    await expect(delivery.createAssignment(input, `new-assignment-${kind}`, operator))
      .rejects.toThrow("cancelada o reembolsada");
    expect((await delivery.assignments(operator)).assignments).toHaveLength(1);
    expect((await accounts.get(account.id, operator)).version).toBe(account.version);
    expect((await database.query("SELECT id FROM sales_refunds")).rowCount).toBe(1);
  });

  it.each([undefined, "Ana", "Ana de la oficina"])("sincroniza el cliente heredado y conserva el nombre distinto: %s", async (customerName) => {
    database = await createServiceFixture();
    const { accounts, delivery } = services(database);
    const opened = await accounts.open({
      serviceType: "takeaway", guestCount: 1, customerName: "Ana",
    }, "name-account", operator);
    await accounts.addItem(opened.body.id, {
      productId: fixtureIds.product, quantity: 1, expectedVersion: 0,
    }, "name-product", operator);
    const driver = await delivery.createDriver({ name: "Luis" }, "name-driver", operator);
    const assignment = (await delivery.createAssignment({
      accountId: opened.body.id, expectedAccountVersion: 1, driverId: driver.body.driver.id,
      address: "Calle 3", ...(customerName === undefined ? {} : { customerName }),
    }, "name-assignment", operator)).body.assignment;
    await accounts.updateDetails(opened.body.id, { expectedVersion: 1, customerName: "Luis" }, "rename-customer", operator);
    const refreshed = (await delivery.refresh(assignment.id, {
      expectedVersion: 0, expectedAccountVersion: 2,
    }, "refresh-customer", operator)).body.assignment;
    const expectedName = customerName === "Ana de la oficina" ? customerName : "Luis";
    expect(refreshed).toMatchObject({
      customerName: expectedName, snapshot: { customerName: "Luis" },
      accountChanged: false, accountUnavailable: false,
    });
    const link = await delivery.share(assignment.id, { expectedVersion: refreshed.version }, operator);
    expect((await delivery.shared(link.token)).assignment.customerName).toBe(expectedName);
    expect(refreshed).not.toHaveProperty("customerNameFollowsAccount");
  });

  it("invalida un reparto al fusionar su cuenta origen y permite cancelar la asignación", async () => {
    database = await createServiceFixture();
    const { accounts, delivery, assignment, account } = await prepare(database);
    const link = await delivery.share(assignment.id, { expectedVersion: 0 }, operator);
    const destination = await accounts.open({ serviceType: "takeaway", guestCount: 1 }, "merge-target", operator);
    const manager = { ...operator, permissions: [...operator.permissions, "service.account.manage"] };
    await accounts.merge(account.id, {
      sourceExpectedVersion: 1, destinationAccountId: destination.body.id,
      destinationExpectedVersion: 0, reason: "Unir pedidos del cliente",
    }, "merge-source", manager);
    const source = await accounts.get(account.id, operator);
    expect(source.status).toBe("closed");
    expect(source.items.filter((item) => item.preparationState !== "cancelled")).toHaveLength(0);
    expect((await delivery.assignments(operator)).assignments[0]).toMatchObject({
      accountChanged: true, accountUnavailable: true, status: "assigned",
    });
    await expect(delivery.shared(link.token)).rejects.toBeInstanceOf(NotFoundException);
    await expect(delivery.share(assignment.id, { expectedVersion: link.version }, operator))
      .rejects.toThrow("ya no tiene artículos");
    await expect(delivery.refresh(assignment.id, {
      expectedVersion: link.version, expectedAccountVersion: source.version,
    }, "refresh-merged", operator)).rejects.toThrow("comanda vacía");
    for (const status of ["out_for_delivery", "delivered"] as const) {
      await expect(delivery.updateStatus(assignment.id, {
        expectedVersion: link.version, status,
      }, `merged-${status}`, operator)).rejects.toThrow("ya no tiene artículos");
    }
    const cancelled = await delivery.updateStatus(assignment.id, {
      expectedVersion: link.version, status: "cancelled",
    }, "cancel-merged-delivery", operator);
    expect(cancelled.body.assignment).toMatchObject({ status: "cancelled", accountUnavailable: true });
    expect((await accounts.get(destination.body.id, operator)).totalInCents).toBe(2400);
  });

  it("guarda sólo el hash, rota y vence enlaces y revoca al cancelar", async () => {
    database = await createServiceFixture();
    const { delivery, assignment } = await prepare(database);
    const first = await delivery.share(assignment.id, { expectedVersion: 0 }, operator);
    expect(first.token).toHaveLength(43);
    const shared = await delivery.shared(first.token);
    expect(shared.assignment).toMatchObject({ id: assignment.id, driverName: "Luis", customerName: "Ana", address: "Calle 3 #20" });
    expect(shared.assignment).not.toHaveProperty("siteId");
    expect(shared.assignment).not.toHaveProperty("driverPhone");
    expect(shared.assignment.snapshot).not.toHaveProperty("responsible");
    const stored = await database.query<{ share_token_hash: string }>("SELECT share_token_hash FROM delivery_assignments WHERE id = $1", [assignment.id]);
    expect(stored.rows[0]?.share_token_hash).toHaveLength(64);
    expect(stored.rows[0]?.share_token_hash).not.toBe(first.token);
    const persisted = await database.query("SELECT response_body FROM idempotency_records");
    expect(JSON.stringify(persisted.rows)).not.toContain(first.token);
    expect(JSON.stringify((await database.query("SELECT changes, metadata FROM audit_events")).rows)).not.toContain(first.token);
    await expect(delivery.shared("invalid")).rejects.toBeInstanceOf(NotFoundException);
    await expect(delivery.shared(undefined)).rejects.toBeInstanceOf(NotFoundException);
    const second = await delivery.share(assignment.id, { expectedVersion: 1 }, operator);
    await expect(delivery.shared(first.token)).rejects.toBeInstanceOf(NotFoundException);
    expect((await delivery.shared(second.token)).assignment.id).toBe(assignment.id);
    await database.query("UPDATE delivery_assignments SET share_expires_at = now() - interval '1 second' WHERE id = $1", [assignment.id]);
    await expect(delivery.shared(second.token)).rejects.toBeInstanceOf(NotFoundException);
    const third = await delivery.share(assignment.id, { expectedVersion: 2 }, operator);
    await delivery.updateStatus(assignment.id, { expectedVersion: 3, status: "cancelled" }, "cancel", operator);
    await expect(delivery.shared(third.token)).rejects.toBeInstanceOf(NotFoundException);
    await expect(delivery.share(assignment.id, { expectedVersion: 4 }, operator)).rejects.toBeInstanceOf(ConflictException);
  });

  it("invalida la copia al cambiar la comanda y exige actualizarla antes de compartir", async () => {
    database = await createServiceFixture();
    const { delivery, accounts, assignment, account, item } = await prepare(database);
    const first = await delivery.share(assignment.id, { expectedVersion: 0 }, operator);
    await accounts.updateItem(account.id, item.id, { expectedVersion: 1, quantity: 2, note: "Sin crema" }, "change-note", operator);
    await expect(delivery.shared(first.token)).rejects.toBeInstanceOf(NotFoundException);
    expect((await delivery.assignments(operator)).assignments[0]).toMatchObject({ accountChanged: true, snapshot: { items: [{ note: "Con todo" }] } });
    await expect(delivery.share(assignment.id, { expectedVersion: 1 }, operator)).rejects.toBeInstanceOf(ConflictException);
    await expect(delivery.updateStatus(assignment.id, { expectedVersion: 1, status: "out_for_delivery" }, "stale-out", operator))
      .rejects.toBeInstanceOf(ConflictException);
    const refreshed = await delivery.refresh(assignment.id, { expectedVersion: 1, expectedAccountVersion: 2 }, "refresh", operator);
    expect(refreshed.body.assignment).toMatchObject({ version: 2, accountVersion: 2, accountChanged: false, shareExpiresAt: null, snapshot: { items: [{ note: "Sin crema" }] } });
    expect((await delivery.refresh(assignment.id, { expectedVersion: 1, expectedAccountVersion: 2 }, "refresh", operator)).replayed).toBe(true);
    await expect(delivery.shared(first.token)).rejects.toBeInstanceOf(NotFoundException);
    const second = await delivery.share(assignment.id, { expectedVersion: 2 }, operator);
    expect((await delivery.shared(second.token)).assignment.snapshot.items[0]?.note).toBe("Sin crema");
    await accounts.cancelItem(account.id, item.id, { expectedVersion: 2, reason: "Sin existencia" }, "cancel-item", operator);
    expect((await delivery.assignments(operator)).assignments[0]?.accountUnavailable).toBe(true);
    await expect(delivery.refresh(assignment.id, { expectedVersion: 3, expectedAccountVersion: 3 }, "empty-refresh", operator)).rejects.toBeInstanceOf(ConflictException);
  });

  it("expone lectura móvil sin sesión y mantiene las mutaciones protegidas por permiso", async () => {
    database = await createServiceFixture();
    const { delivery, assignment } = await prepare(database);
    const link = await delivery.share(assignment.id, { expectedVersion: 0 }, operator);
    const module = await Test.createTestingModule({ imports: [AppModule, DeliveryModule] })
      .overrideProvider(DATABASE).useValue(database)
      .overrideProvider(AuthService).useValue({ resolveToken: async (token: string) => {
        if (token === "operator") return operator;
        if (token === "restricted") return { ...operator, permissions: [] };
        throw new UnauthorizedException();
      } }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix("api");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const publicCopy = await app.inject({ method: "GET", url: "/api/v1/delivery/shared", headers: { "x-delivery-token": link.token } });
    expect(publicCopy.statusCode).toBe(200);
    expect(publicCopy.headers["cache-control"]).toBe("no-store");
    expect(publicCopy.json().assignment.id).toBe(assignment.id);
    expect((await app.inject({ method: "GET", url: "/api/v1/delivery/shared" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/v1/delivery/assignments" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/v1/delivery/assignments", headers: { authorization: "Bearer restricted" } })).statusCode).toBe(403);
    const invalid = await app.inject({ method: "POST", url: "/api/v1/delivery/drivers", headers: { authorization: "Bearer operator", "idempotency-key": "invalid-http" }, payload: { name: " " } });
    expect(invalid.statusCode).toBe(400);
    const noKey = await app.inject({ method: "POST", url: "/api/v1/delivery/drivers", headers: { authorization: "Bearer operator" }, payload: { name: "Repartidor" } });
    expect(noKey.statusCode).toBe(400);
  });
});
