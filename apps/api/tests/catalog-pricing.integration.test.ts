import { ConflictException, NotFoundException, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it } from "vitest";
import { AccountsService } from "../src/accounts/accounts.service.js";
import { AppModule } from "../src/app.module.js";
import { AuditService } from "../src/audit/audit.service.js";
import { AuthService } from "../src/auth/auth.service.js";
import { CashService } from "../src/cash/cash.service.js";
import { CatalogPricingService } from "../src/catalog/catalog-pricing.service.js";
import { CatalogService } from "../src/catalog/catalog.service.js";
import { DATABASE } from "../src/database/database.port.js";
import { IdempotencyService } from "../src/idempotency/idempotency.service.js";
import { OutboxService } from "../src/outbox/outbox.service.js";
import { ProductionService } from "../src/production/production.service.js";
import { SalesService } from "../src/sales/sales.service.js";
import type { AuthContext } from "../src/security/auth-context.js";
import { createServiceFixture, fixtureIds } from "./service-fixture.js";
import type { TestDatabase } from "./test-database.js";

const administrator: AuthContext = {
  sessionId: crypto.randomUUID(),
  siteId: fixtureIds.site,
  userId: fixtureIds.user,
  terminalId: fixtureIds.terminalOne,
  displayName: "Administrador",
  permissions: ["catalog.read", "catalog.product.manage", "cash.shift.open", "sales.payment.capture"],
};

let database: TestDatabase | undefined;
let app: NestFastifyApplication | undefined;

afterEach(async () => {
  if (app) await app.close();
  else await database?.close();
  app = undefined;
  database = undefined;
});

const pricing = () => new CatalogPricingService(new AuditService(), new IdempotencyService(database!));
const productInput = { expectedVersion: 0, priceInCents: 1750 };
const modifierInput = { expectedPriceDeltaInCents: 200, priceDeltaInCents: 350 };

describe("precios administrables del catálogo completo", () => {
  it("actualiza menú fijo y temporada, conserva historial, audita e impide sobrescribir versiones", async () => {
    database = await createServiceFixture();
    const service = pricing();
    await database.query("UPDATE products SET available = false WHERE id = $1", [fixtureIds.product]);
    const result = await service.updateProductPrice(fixtureIds.product, productInput, "fixed-price", administrator);
    expect(result.body).toEqual({ product: {
      id: fixtureIds.product, name: "Taco de prueba", available: false, version: 1, priceInCents: 1750,
    } });
    const replay = await service.updateProductPrice(fixtureIds.product, productInput, "fixed-price", administrator);
    expect(replay).toMatchObject({ body: result.body, replayed: true });
    await expect(service.updateProductPrice(fixtureIds.product, productInput, "stale-price", administrator))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(service.updateProductPrice(fixtureIds.product, { ...productInput, priceInCents: 2000 }, "fixed-price", administrator))
      .rejects.toBeInstanceOf(ConflictException);

    expect((await database.query<{ price_in_cents: number; active: boolean }>(
      "SELECT price_in_cents, active FROM product_prices WHERE product_id = $1 ORDER BY active", [fixtureIds.product],
    )).rows).toEqual([{ price_in_cents: 1000, active: false }, { price_in_cents: 1750, active: true }]);
    expect((await database.query<{ changes: unknown; actor_user_id: string; terminal_id: string }>(
      "SELECT changes, actor_user_id, terminal_id FROM audit_events WHERE action = 'catalog.product.price.updated'",
    )).rows).toEqual([{
      actor_user_id: administrator.userId,
      terminal_id: administrator.terminalId,
      changes: { before: { priceInCents: 1000, version: 0 }, after: { priceInCents: 1750, version: 1 } },
    }]);

    await database.query("UPDATE product_categories SET seasonal = true WHERE id = $1", [fixtureIds.category]);
    const seasonal = await service.updateProductPrice(fixtureIds.product, { expectedVersion: 1, priceInCents: 0 }, "seasonal-free", administrator);
    expect(seasonal.body.product).toMatchObject({ priceInCents: 0, version: 2, available: false });
    const currentCatalog = await new CatalogService(database).catalog(fixtureIds.site);
    expect(currentCatalog.categories[0]?.products[0]).toMatchObject({ priceInCents: 0, version: 2 });
  });

  it("actualiza recargos, rechaza datos anteriores y mantiene auditoría única al reintentar", async () => {
    database = await createServiceFixture();
    const service = pricing();
    const changed = await service.updateModifierPrice(fixtureIds.modifier, modifierInput, "extra-price", administrator);
    expect(changed.body).toEqual({ modifier: { id: fixtureIds.modifier, name: "Extra", priceDeltaInCents: 350 } });
    expect((await service.updateModifierPrice(fixtureIds.modifier, modifierInput, "extra-price", administrator)).replayed).toBe(true);
    await expect(service.updateModifierPrice(fixtureIds.modifier, modifierInput, "stale-extra", administrator))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(service.updateModifierPrice(fixtureIds.modifier, { ...modifierInput, priceDeltaInCents: 100 }, "extra-price", administrator))
      .rejects.toBeInstanceOf(ConflictException);
    const currentCatalog = await new CatalogService(database).catalog(fixtureIds.site);
    expect(currentCatalog.categories[0]?.products[0]?.modifierGroups[0]?.options[0])
      .toMatchObject({ id: fixtureIds.modifier, name: "Extra", priceDeltaInCents: 350 });
    expect((await database.query<{ changes: unknown }>(
      "SELECT changes FROM audit_events WHERE action = 'catalog.modifier.price.updated'",
    )).rows).toEqual([{ changes: { before: { priceDeltaInCents: 200 }, after: { priceDeltaInCents: 350 } } }]);

    const otherSite = crypto.randomUUID();
    await database.query("INSERT INTO sites (id, code, name) VALUES ($1, 'OTHER', 'Otra')", [otherSite]);
    const foreignActor = { ...administrator, siteId: otherSite };
    await expect(service.updateProductPrice(fixtureIds.product, { expectedVersion: 0, priceInCents: 1 }, "other-product", foreignActor))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(service.updateModifierPrice(fixtureIds.modifier, modifierInput, "other-extra", foreignActor))
      .rejects.toBeInstanceOf(NotFoundException);
    await database.query("UPDATE modifiers SET active = false WHERE id = $1", [fixtureIds.modifier]);
    await expect(service.updateModifierPrice(fixtureIds.modifier, { expectedPriceDeltaInCents: 350, priceDeltaInCents: 0 }, "inactive-extra", administrator))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it("permite una sola edición cuando dos terminales parten del mismo precio", async () => {
    database = await createServiceFixture();
    const service = pricing();
    const productResults = await Promise.allSettled([
      service.updateProductPrice(fixtureIds.product, { expectedVersion: 0, priceInCents: 1500 }, "terminal-one-product", administrator),
      service.updateProductPrice(fixtureIds.product, { expectedVersion: 0, priceInCents: 1800 }, "terminal-two-product", administrator),
    ]);
    const modifierResults = await Promise.allSettled([
      service.updateModifierPrice(fixtureIds.modifier, { expectedPriceDeltaInCents: 200, priceDeltaInCents: 400 }, "terminal-one-option", administrator),
      service.updateModifierPrice(fixtureIds.modifier, { expectedPriceDeltaInCents: 200, priceDeltaInCents: 600 }, "terminal-two-option", administrator),
    ]);
    for (const results of [productResults, modifierResults]) {
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(ConflictException);
    }
    expect((await database.query("SELECT id FROM product_prices WHERE product_id = $1 AND active", [fixtureIds.product])).rowCount).toBe(1);
  });

  it("aplica los nuevos precios a capturas nuevas y conserva cuentas y ventas anteriores", async () => {
    database = await createServiceFixture();
    const audit = new AuditService();
    const idempotency = new IdempotencyService(database);
    const outbox = new OutboxService();
    const production = new ProductionService(database, audit, idempotency, outbox);
    const accounts = new AccountsService(database, audit, idempotency, outbox, production);
    const cash = new CashService(database, audit, idempotency, outbox);
    const sales = new SalesService(database, accounts, cash, audit, idempotency, outbox);
    const service = pricing();
    const addAccount = async (key: string) => {
      const opened = await accounts.open({ serviceType: "quick", guestCount: 1 }, `${key}-open`, administrator);
      await accounts.addItem(opened.body.id, {
        productId: fixtureIds.product, quantity: 1, modifierIds: [fixtureIds.modifier], expectedVersion: 0,
      }, `${key}-add`, administrator);
      return opened.body.id;
    };
    await cash.openShift({ openingFloatInCents: 0 }, "price-test-shift", administrator);
    const saleAccountId = await addAccount("sold");
    const sent = await accounts.sendRound(saleAccountId, { expectedVersion: 1 }, "sold-send", administrator);
    const receipt = await sales.checkout(saleAccountId, {
      expectedVersion: sent.body.accountVersion,
      payments: [{ methodCode: "CASH", amountInCents: 1200, tipInCents: 0, tenderedInCents: 1200 }],
    }, "sold-checkout", administrator);
    const pendingAccountId = await addAccount("pending");
    const pendingBefore = await accounts.get(pendingAccountId, administrator);

    await service.updateProductPrice(fixtureIds.product, productInput, "new-base", administrator);
    await service.updateModifierPrice(fixtureIds.modifier, modifierInput, "new-extra", administrator);

    expect(await accounts.get(pendingAccountId, administrator)).toEqual(pendingBefore);
    expect(await sales.getReceipt(receipt.body.id, administrator)).toEqual(receipt.body);
    expect(receipt.body.totals.saleInCents).toBe(1200);
    const newAccount = await accounts.get(await addAccount("new-prices"), administrator);
    expect(newAccount).toMatchObject({ totalInCents: 2100 });
    expect(newAccount.items[0]).toMatchObject({ unitPriceInCents: 1750, modifiers: [{ priceDeltaInCents: 350 }] });
  });

  it("exige sesión, permiso administrativo, idempotencia y montos válidos en ambos endpoints", async () => {
    database = await createServiceFixture();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE).useValue(database)
      .overrideProvider(AuthService).useValue({ resolveToken: async (token: string) => {
        if (token === "admin") return administrator;
        if (token === "waiter") return { ...administrator, permissions: ["catalog.read"] };
        throw new UnauthorizedException();
      } }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const endpoints = [
      { url: `/v1/catalog/products/${fixtureIds.product}/price`, payload: productInput, amount: "priceInCents", expected: "expectedVersion" },
      { url: `/v1/catalog/modifiers/${fixtureIds.modifier}/price`, payload: modifierInput, amount: "priceDeltaInCents", expected: "expectedPriceDeltaInCents" },
    ];
    for (const endpoint of endpoints) {
      const request = { method: "PATCH" as const, url: endpoint.url, payload: endpoint.payload };
      expect((await app.inject(request)).statusCode).toBe(401);
      expect((await app.inject({ ...request, headers: { authorization: "Bearer waiter", "idempotency-key": "forbidden" } })).statusCode).toBe(403);
      expect((await app.inject({ ...request, headers: { authorization: "Bearer admin" } })).statusCode).toBe(400);
      const headers = { authorization: "Bearer admin", "idempotency-key": endpoint.amount };
      for (const amount of [-1, 1.5, 1_000_001, "35"]) {
        expect((await app.inject({ ...request, headers, payload: { ...endpoint.payload, [endpoint.amount]: amount } })).statusCode).toBe(400);
      }
      for (const payload of [
        { ...endpoint.payload, [endpoint.expected]: 0.5 },
        { ...endpoint.payload, name: "Cambio no solicitado" },
        { [endpoint.expected]: 0 },
      ]) {
        expect((await app.inject({ ...request, headers, payload })).statusCode).toBe(400);
      }
      expect((await app.inject({ ...request, url: endpoint.url.replace(/\/[0-9a-f-]+\/price$/, "/invalid/price"), headers })).statusCode).toBe(400);
      const response = await app.inject({ ...request, headers });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ idempotencyReplayed: false });
      expect((await app.inject({ ...request, headers })).json()).toMatchObject({ ...response.json(), idempotencyReplayed: true });
    }
    expect((await app.inject({ method: "PATCH", url: `/v1/catalog/products/${fixtureIds.product}/price`,
      headers: { authorization: "Bearer admin", "idempotency-key": "negative-version" },
      payload: { expectedVersion: -1, priceInCents: 0 },
    })).statusCode).toBe(400);
  });
});
