import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ValidationPipe, type ExecutionContext } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it } from "vitest";
import { AccountsService } from "../src/accounts/accounts.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import { PermissionsGuard } from "../src/auth/permissions.guard.js";
import { CustomersController } from "../src/customers/customers.controller.js";
import { CustomersService } from "../src/customers/customers.service.js";
import { IdempotencyService } from "../src/idempotency/idempotency.service.js";
import { OutboxService } from "../src/outbox/outbox.service.js";
import { ProductionService } from "../src/production/production.service.js";
import type { AuthContext } from "../src/security/auth-context.js";
import { createServiceFixture, fixtureIds } from "./service-fixture.js";
import type { TestDatabase } from "./test-database.js";

const actor = (): AuthContext => ({ sessionId: crypto.randomUUID(), siteId: fixtureIds.site,
  userId: fixtureIds.user, terminalId: fixtureIds.terminalOne, displayName: "Administrador",
  permissions: ["customers.read", "customers.manage", "service.account.manage", "sales.receipt.read"] });
const services = (database: TestDatabase) => {
  const audit = new AuditService(); const idempotency = new IdempotencyService(database);
  const outbox = new OutboxService(); const production = new ProductionService(database, audit, idempotency, outbox);
  return { customers: new CustomersService(database, audit, idempotency, outbox),
    accounts: new AccountsService(database, audit, idempotency, outbox, production) };
};
let database: TestDatabase | undefined;
let app: NestFastifyApplication | undefined;
afterEach(async () => { await app?.close(); app = undefined; await database?.close(); database = undefined; });

describe("clientes frecuentes", () => {
  it("registra, actualiza y audita clientes con idempotencia y control de versiones", async () => {
    database = await createServiceFixture();
    const { customers } = services(database); const admin = actor();
    const input = { name: "  Ana López  ", phone: " 3331234567 ", address: " Calle 1 ", notes: "Recoge los viernes" };
    const created = await customers.create(input, "create-customer", admin);
    expect(created.body.customer).toMatchObject({ name: "Ana López", phone: "3331234567", address: "Calle 1", active: true, version: 0 });
    expect((await customers.create(input, "create-customer", admin)).replayed).toBe(true);
    expect((await customers.list(admin)).customers).toHaveLength(1);
    const updated = await customers.update(created.body.customer.id, { expectedVersion: 0, name: "Ana Pérez", notes: "" }, "update-customer", admin);
    expect(updated.body.customer).toMatchObject({ name: "Ana Pérez", notes: null, phone: "3331234567", version: 1 });
    await expect(customers.update(created.body.customer.id, { expectedVersion: 0, active: false }, "stale", admin)).rejects.toBeInstanceOf(ConflictException);
    await expect(customers.create({ name: "   " }, "blank", admin)).rejects.toBeInstanceOf(BadRequestException);
    expect((await database.query("SELECT id FROM audit_events WHERE entity_type = 'frequent_customer'")).rowCount).toBe(2);
  });

  it("usa al cliente en venta rápida, para llevar y programados sin alterar pedidos históricos", async () => {
    database = await createServiceFixture();
    const { customers, accounts } = services(database); const admin = actor();
    const customer = (await customers.create({ name: "Ana", phone: "3331234567", address: "El Salto 6" }, "customer", admin)).body.customer;
    const opened = [];
    for (const [index, input] of [
      { serviceType: "quick" as const },
      { serviceType: "takeaway" as const },
      { serviceType: "takeaway" as const, scheduledFor: new Date(Date.now() + 86_400_000).toISOString() },
    ].entries()) {
      opened.push(await accounts.open({ ...input, guestCount: 1, customerId: customer.id, customerName: "Nombre distinto" }, `order-${index}`, admin));
    }
    await customers.update(customer.id, { expectedVersion: 0, name: "Ana nueva", phone: "3337654321", address: "Otra dirección" }, "change-customer", admin);
    for (const order of opened) {
      expect(await accounts.get(order.body.id, admin)).toMatchObject({ customerId: customer.id, customerName: "Ana", customerPhone: "3331234567", customerAddress: "El Salto 6" });
    }
    const second = opened[1]!;
    await accounts.updateDetails(second.body.id, { expectedVersion: 0, customerId: customer.id, customerName: "Ana" }, "keep-snapshot", admin);
    expect(await accounts.get(second.body.id, admin)).toMatchObject({ customerId: customer.id, customerName: "Ana", customerPhone: "3331234567", customerAddress: "El Salto 6" });
    const first = opened[0]!;
    await accounts.updateDetails(first.body.id, { expectedVersion: 0, customerName: "Invitado" }, "free-name", admin);
    expect(await accounts.get(first.body.id, admin)).toMatchObject({ customerId: null, customerName: "Invitado", customerPhone: null, customerAddress: null });
    await accounts.updateDetails(first.body.id, { expectedVersion: 1, customerId: customer.id }, "select-customer", admin);
    expect(await accounts.get(first.body.id, admin)).toMatchObject({ customerId: customer.id, customerName: "Ana nueva", customerPhone: "3337654321", customerAddress: "Otra dirección" });
    await accounts.updateDetails(first.body.id, { expectedVersion: 2, customerId: null, customerName: null }, "clear-customer", admin);
    expect(await accounts.get(first.body.id, admin)).toMatchObject({ customerId: null, customerName: null, customerPhone: null, customerAddress: null });
    expect((await accounts.listOpenCounter(admin)).accounts).toHaveLength(3);
  });

  it("rechaza clientes ajenos o inactivos y evita consultar cuentas cerradas sin permiso", async () => {
    database = await createServiceFixture();
    const { customers, accounts } = services(database); const admin = actor();
    const customer = (await customers.create({ name: "Ana" }, "customer", admin)).body.customer;
    const otherSite = crypto.randomUUID(); const otherCustomer = crypto.randomUUID();
    await database.query("INSERT INTO sites (id, code, name) VALUES ($1, 'OTHER', 'Otra sucursal')", [otherSite]);
    await database.query("INSERT INTO frequent_customers (id, site_id, name) VALUES ($1, $2, 'Cliente ajeno')", [otherCustomer, otherSite]);
    expect((await customers.list(admin)).customers.map((row) => row.id)).toEqual([customer.id]);
    await expect(customers.update(otherCustomer, { expectedVersion: 0, name: "Ajeno" }, "other-site", admin)).rejects.toBeInstanceOf(NotFoundException);
    await expect(accounts.open({ serviceType: "quick", guestCount: 1, customerId: otherCustomer }, "foreign-order", admin)).rejects.toBeInstanceOf(NotFoundException);
    await customers.update(customer.id, { expectedVersion: 0, active: false }, "deactivate", admin);
    await expect(accounts.open({ serviceType: "takeaway", guestCount: 1, customerId: customer.id }, "inactive-order", admin)).rejects.toBeInstanceOf(ConflictException);
    const order = await accounts.open({ serviceType: "quick", guestCount: 1 }, "open-order", admin);
    await expect(accounts.updateDetails(order.body.id, { expectedVersion: 0, customerId: customer.id }, "inactive-details", admin)).rejects.toBeInstanceOf(ConflictException);
    await database.query("UPDATE service_accounts SET status = 'closed' WHERE id = $1", [order.body.id]);
    await expect(accounts.get(order.body.id, { ...admin, permissions: ["service.account.read"] })).rejects.toBeInstanceOf(ForbiddenException);
    expect((await accounts.get(order.body.id, admin)).status).toBe("closed");
    expect((await accounts.get(order.body.id, { ...admin, permissions: ["delivery.manage"] })).status).toBe("closed");
    expect((await accounts.readAccount(database, order.body.id, admin.siteId)).status).toBe("closed");
  });

  it("protege los endpoints y valida nombres, UUID e idempotencia", async () => {
    database = await createServiceFixture();
    const { customers } = services(database); const admin = actor();
    const module = await Test.createTestingModule({ controllers: [CustomersController], providers: [
      { provide: CustomersService, useValue: customers },
      { provide: APP_GUARD, useValue: { canActivate(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest();
        request.auth = { ...admin, permissions: request.headers["x-read-only"] ? ["customers.read"] : admin.permissions };
        return true;
      } } },
      { provide: APP_GUARD, useClass: PermissionsGuard },
    ] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    const server = app.getHttpAdapter().getInstance();
    expect((await server.inject({ method: "POST", url: "/v1/customers", payload: { name: "Ana" } })).statusCode).toBe(400);
    expect((await server.inject({ method: "POST", url: "/v1/customers", headers: { "idempotency-key": "readonly", "x-read-only": "1" }, payload: { name: "Ana" } })).statusCode).toBe(403);
    expect((await server.inject({ method: "POST", url: "/v1/customers", headers: { "idempotency-key": "invalid" }, payload: { name: "A".repeat(81) } })).statusCode).toBe(400);
    const result = await server.inject({ method: "POST", url: "/v1/customers", headers: { "idempotency-key": "valid" }, payload: { name: "Ana", phone: "3331234567" } });
    expect(result.statusCode).toBe(201);
    expect(result.json().customer).toMatchObject({ name: "Ana", phone: "3331234567" });
    const listed = await server.inject({ method: "GET", url: "/v1/customers", headers: { "x-read-only": "1" } });
    expect(listed.statusCode).toBe(200); expect(listed.json().customers).toHaveLength(1);
    expect((await server.inject({ method: "PATCH", url: "/v1/customers/not-a-uuid", headers: { "idempotency-key": "bad-id" }, payload: { expectedVersion: 0, name: "Ana" } })).statusCode).toBe(400);
  });
});
