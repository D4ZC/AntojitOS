import { afterEach, describe, expect, it } from "vitest";
import { AccountsService } from "../src/accounts/accounts.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import { CatalogPricingService } from "../src/catalog/catalog-pricing.service.js";
import { CatalogService } from "../src/catalog/catalog.service.js";
import { applyPilotCatalog, pilotCatalog } from "../src/database/pilot-catalog.js";
import { IdempotencyService } from "../src/idempotency/idempotency.service.js";
import { OutboxService } from "../src/outbox/outbox.service.js";
import { ProductionService } from "../src/production/production.service.js";
import type { AuthContext } from "../src/security/auth-context.js";
import { createServiceFixture, fixtureIds } from "./service-fixture.js";
import type { TestDatabase } from "./test-database.js";

const administrator: AuthContext = {
  sessionId: crypto.randomUUID(),
  siteId: fixtureIds.site,
  userId: fixtureIds.user,
  terminalId: fixtureIds.terminalOne,
  displayName: "Administrador",
  permissions: ["catalog.product.manage", "service.account.open", "service.item.edit", "service.round.send"],
};

let database: TestDatabase | undefined;
afterEach(async () => {
  await database?.close();
  database = undefined;
});

describe("importes visibles de los botes de pozole", () => {
  it.each([
    { base: 18000, extra: 5000, expectedName: "Bote de $230" },
    { base: 18025, extra: 5025, expectedName: "Bote de $230.50" },
  ])("actualiza catálogo y comandas nuevas a $expectedName y conserva las anteriores", async ({ base, extra, expectedName }) => {
    database = await createServiceFixture();
    await database.transaction((transaction) => applyPilotCatalog(transaction, {
      siteId: fixtureIds.site,
      kitchenId: fixtureIds.productionCenter,
      taxRuleId: fixtureIds.tax,
    }));
    const audit = new AuditService();
    const idempotency = new IdempotencyService(database);
    const outbox = new OutboxService();
    const production = new ProductionService(database, audit, idempotency, outbox);
    const accounts = new AccountsService(database, audit, idempotency, outbox, production);
    const pricing = new CatalogPricingService(audit, idempotency);
    const catalog = new CatalogService(database);
    const bote = pilotCatalog.products.find((product) => product.code === "POZOLE-BOTE")!;
    const amount = pilotCatalog.modifierGroups.find((group) => group.code === "POZOLE-BOTE-MONTO")!
      .options.find((option) => option.code === "POZOLE-BOTE-200")!;
    const meat = pilotCatalog.modifierGroups.find((group) => group.code === "POZOLE-CARNE")!.options[0]!;

    const capture = async (key: string) => {
      const opened = await accounts.open({ serviceType: "takeaway", guestCount: 1 }, `${key}-open`, administrator);
      const added = await accounts.addItem(opened.body.id, {
        productId: bote.id, quantity: 1, modifierIds: [amount.id, meat.id], expectedVersion: 0,
      }, `${key}-add`, administrator);
      await accounts.sendRound(opened.body.id, { expectedVersion: 1 }, `${key}-send`, administrator);
      return { accountId: opened.body.id, item: added.body.item };
    };
    const before = await capture("original");
    expect(before.item.modifiers.find((modifier) => modifier.id === amount.id)?.name).toBe("Bote de $200");
    const originalAccount = await accounts.get(before.accountId, administrator);

    await pricing.updateProductPrice(bote.id, { expectedVersion: 0, priceInCents: base }, "new-bote-base", administrator);
    await pricing.updateModifierPrice(amount.id, {
      expectedPriceDeltaInCents: 5000, priceDeltaInCents: extra,
    }, "new-bote-extra", administrator);

    const current = (await catalog.catalog(fixtureIds.site)).categories
      .flatMap((category) => category.products).find((product) => product.id === bote.id)!;
    expect(current.priceInCents).toBe(base);
    expect(current.modifierGroups.flatMap((group) => group.options)
      .find((option) => option.id === amount.id)).toMatchObject({ name: expectedName, priceDeltaInCents: extra });
    expect(current.modifierGroups.flatMap((group) => group.options)
      .find((option) => option.id === meat.id)?.name).toBe(meat.name);
    const after = await capture("updated");
    expect(after.item.modifiers.find((modifier) => modifier.id === amount.id))
      .toMatchObject({ name: expectedName, priceDeltaInCents: extra });
    expect((await accounts.get(after.accountId, administrator)).totalInCents).toBe(base + extra);
    expect(await accounts.get(before.accountId, administrator)).toEqual(originalAccount);

    for (const { accountId, name } of [
      { accountId: before.accountId, name: "Bote de $200" },
      { accountId: after.accountId, name: expectedName },
    ]) {
      const printed = await database.query<{ payload: { items: Array<{ modifiers: string[] }> } }>(
        `SELECT jobs.payload FROM print_jobs jobs
          JOIN production_tickets tickets ON tickets.id = jobs.ticket_id
         WHERE tickets.account_id = $1`,
        [accountId],
      );
      expect(printed.rows[0]?.payload.items[0]?.modifiers).toContain(name);
    }
    expect((await database.query<{ name: string }>(
      "SELECT name FROM modifiers WHERE id = $1", [amount.id],
    )).rows[0]?.name).toBe("Bote de $200");
  });
});
