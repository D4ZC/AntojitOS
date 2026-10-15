import { ConflictException } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { AccountsService } from "../src/accounts/accounts.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import { CatalogService } from "../src/catalog/catalog.service.js";
import { IdempotencyService } from "../src/idempotency/idempotency.service.js";
import { OutboxService } from "../src/outbox/outbox.service.js";
import { ProductionService } from "../src/production/production.service.js";
import type { AuthContext } from "../src/security/auth-context.js";
import {
  createServiceFixture,
  fixtureIds,
} from "./service-fixture.js";
import type { TestDatabase } from "./test-database.js";

const actor = (terminalId: string): AuthContext => ({
  sessionId: crypto.randomUUID(),
  siteId: fixtureIds.site,
  userId: fixtureIds.user,
  terminalId,
  displayName: "Administrador",
  permissions: [
    "catalog.read",
    "service.account.open",
    "service.account.read",
    "service.item.add",
    "service.item.edit",
    "service.round.send",
    "service.account.manage",
    "service.account.discount",
    "service.precheck.create",
  ],
});

const createAccountsService = (database: TestDatabase): AccountsService => {
  const audit = new AuditService();
  const idempotency = new IdempotencyService(database);
  const outbox = new OutboxService();
  const production = new ProductionService(database, audit, idempotency, outbox);
  return new AccountsService(database, audit, idempotency, outbox, production);
};

let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

describe("cuentas y captura concurrente", () => {
  it("abre una sola cuenta por mesa y actualiza el plano", async () => {
    database = await createServiceFixture();
    const accounts = createAccountsService(database);
    const catalog = new CatalogService(database);
    const terminal = actor(fixtureIds.terminalOne);
    const input = {
      serviceType: "table" as const,
      tableId: fixtureIds.table,
      guestCount: 2,
    };

    const opened = await accounts.open(input, "open-table-1", terminal);
    const replay = await accounts.open(input, "open-table-1", terminal);

    expect(opened.body.version).toBe(0);
    expect(opened.replayed).toBe(false);
    expect(replay.body).toEqual(opened.body);
    expect(replay.replayed).toBe(true);

    await expect(
      accounts.open(input, "open-table-again", terminal),
    ).rejects.toBeInstanceOf(ConflictException);

    const layout = await catalog.serviceLayout(fixtureIds.site);
    expect(layout.areas[0]?.tables[0]).toMatchObject({
      id: fixtureIds.table,
      state: "occupied",
      accountId: opened.body.id,
      accountVersion: 0,
    });
    const productCatalog = await catalog.catalog(fixtureIds.site);
    expect(productCatalog.categories[0]?.products[0]).toMatchObject({
      id: fixtureIds.product,
      priceInCents: 1000,
      modifierGroups: [
        expect.objectContaining({
          id: fixtureIds.modifierGroup,
          options: [expect.objectContaining({ id: fixtureIds.modifier })],
        }),
      ],
    });
  });

  it("recupera ventas rápidas y para llevar que siguen abiertas", async () => {
    database = await createServiceFixture();
    const accounts = createAccountsService(database);
    const terminal = actor(fixtureIds.terminalOne);
    const quick = await accounts.open(
      { serviceType: "quick", guestCount: 1 },
      "open-quick-recovery",
      terminal,
    );
    const takeaway = await accounts.open(
      { serviceType: "takeaway", guestCount: 1, reference: "Pedido Ana" },
      "open-takeaway-recovery",
      terminal,
    );

    const open = await accounts.listOpenCounter(terminal);

    expect(open.accounts).toEqual([
      expect.objectContaining({
        id: quick.body.id,
        label: "Venta rápida",
        serviceType: "quick",
        sequence: 1,
      }),
      expect.objectContaining({
        id: takeaway.body.id,
        label: "Pedido Ana",
        serviceType: "takeaway",
        sequence: 2,
      }),
    ]);
  });

  it("calcula descuentos auditables y conserva una precuenta inmutable", async () => {
    database = await createServiceFixture();
    const accounts = createAccountsService(database);
    const terminal = actor(fixtureIds.terminalOne);
    const opened = await accounts.open(
      { serviceType: "quick", guestCount: 1, reference: "Mostrador" },
      "open-adjusted",
      terminal,
    );
    const added = await accounts.addItem(
      opened.body.id,
      {
        productId: fixtureIds.product,
        quantity: 1,
        expectedVersion: 0,
        modifierIds: [fixtureIds.modifier],
      },
      "add-adjusted",
      terminal,
    );
    const adjusted = await accounts.applyAdjustment(
      opened.body.id,
      {
        kind: "discount",
        calculation: "percentage",
        value: 1_000,
        expectedVersion: added.body.accountVersion,
        reason: "Promoción de prueba",
      },
      "discount-ten",
      terminal,
    );

    const account = await accounts.get(opened.body.id, terminal);
    expect(account.totals).toEqual({
      itemTotalInCents: 1_200,
      subtotalInCents: 931,
      adjustmentTotalInCents: 120,
      discountInCents: 120,
      taxInCents: 149,
      totalInCents: 1_080,
    });
    expect(account.adjustments[0]).toMatchObject({
      id: adjusted.body.adjustmentId,
      reason: "Promoción de prueba",
      appliedInCents: 120,
    });

    const precheck = await accounts.createPrecheck(
      opened.body.id,
      { expectedVersion: adjusted.body.accountVersion },
      "precheck-one",
      terminal,
    );
    const replay = await accounts.createPrecheck(
      opened.body.id,
      { expectedVersion: adjusted.body.accountVersion },
      "precheck-one",
      terminal,
    );
    expect(precheck.body.sequence).toBe(1);
    expect(precheck.body.account.totals.totalInCents).toBe(1_080);
    expect(replay.replayed).toBe(true);

    await accounts.voidAdjustment(
      opened.body.id,
      adjusted.body.adjustmentId,
      {
        expectedVersion: adjusted.body.accountVersion,
        reason: "Promoción capturada por error",
      },
      "void-discount",
      terminal,
    );
    const restored = await accounts.get(opened.body.id, terminal);
    expect(restored.totalInCents).toBe(1_200);
    expect(restored.adjustments).toEqual([]);

    const stored = await database.query<{ snapshot: unknown }>(
      "SELECT snapshot FROM account_prechecks WHERE id = $1",
      [precheck.body.id],
    );
    expect(stored.rows[0]?.snapshot).toBeTruthy();
  });

  it("cambia mesa y responsable con control de versión", async () => {
    database = await createServiceFixture();
    const accounts = createAccountsService(database);
    const catalog = new CatalogService(database);
    const terminal = actor(fixtureIds.terminalOne);
    const opened = await accounts.open(
      {
        serviceType: "table",
        tableId: fixtureIds.table,
        guestCount: 2,
      },
      "open-context",
      terminal,
    );

    const updated = await accounts.updateContext(
      opened.body.id,
      {
        expectedVersion: 0,
        tableId: fixtureIds.tableTwo,
        responsibleUserId: fixtureIds.userTwo,
      },
      "move-table-and-owner",
      terminal,
    );
    expect(updated.body.accountVersion).toBe(1);
    const account = await accounts.get(opened.body.id, terminal);
    expect(account).toMatchObject({
      tableId: fixtureIds.tableTwo,
      tableName: "Mesa 2",
      responsible: { id: fixtureIds.userTwo, displayName: "Mesero dos" },
    });
    const layout = await catalog.serviceLayout(fixtureIds.site);
    expect(layout.areas[0]?.tables).toEqual([
      expect.objectContaining({ id: fixtureIds.table, state: "free", accountCount: 0 }),
      expect.objectContaining({ id: fixtureIds.tableTwo, state: "occupied", accountCount: 1 }),
    ]);
  });

  it("cancela una cuenta sin artículos activos y libera la mesa con auditoría", async () => {
    database = await createServiceFixture();
    const accounts = createAccountsService(database);
    const catalog = new CatalogService(database);
    const terminal = actor(fixtureIds.terminalOne);
    const opened = await accounts.open(
      {
        serviceType: "table",
        tableId: fixtureIds.table,
        guestCount: 2,
      },
      "open-to-cancel",
      terminal,
    );
    const added = await accounts.addItem(
      opened.body.id,
      { productId: fixtureIds.product, quantity: 1, expectedVersion: 0 },
      "add-before-cancel",
      terminal,
    );

    await expect(
      accounts.cancelAccount(
        opened.body.id,
        { expectedVersion: added.body.accountVersion, reason: "Mesa abierta por error" },
        "reject-active-account",
        terminal,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    const cancelledItem = await accounts.cancelItem(
      opened.body.id,
      added.body.item.id,
      {
        expectedVersion: added.body.accountVersion,
        reason: "Artículo capturado por error",
      },
      "cancel-active-item",
      terminal,
    );
    const cancelled = await accounts.cancelAccount(
      opened.body.id,
      {
        expectedVersion: cancelledItem.body.accountVersion,
        reason: "Mesa abierta por error",
      },
      "cancel-empty-account",
      terminal,
    );
    const replay = await accounts.cancelAccount(
      opened.body.id,
      {
        expectedVersion: cancelledItem.body.accountVersion,
        reason: "Mesa abierta por error",
      },
      "cancel-empty-account",
      terminal,
    );

    expect(cancelled.body).toMatchObject({
      accountId: opened.body.id,
      accountVersion: 3,
      status: "cancelled",
      tableId: fixtureIds.table,
    });
    expect(replay.replayed).toBe(true);
    expect((await catalog.serviceLayout(fixtureIds.site)).areas[0]?.tables[0]).toMatchObject({
      id: fixtureIds.table,
      state: "free",
      accountId: null,
      accountCount: 0,
    });

    const stored = await database.query<{ status: string; closed_at: Date | null }>(
      "SELECT status, closed_at FROM service_accounts WHERE id = $1",
      [opened.body.id],
    );
    expect(stored.rows[0]).toMatchObject({ status: "cancelled" });
    expect(stored.rows[0]?.closed_at).toBeTruthy();
    const audit = await database.query<{ reason: string }>(
      `SELECT reason FROM audit_events
        WHERE entity_id = $1 AND action = 'account.cancelled'`,
      [opened.body.id],
    );
    expect(audit.rows[0]?.reason).toBe("Mesa abierta por error");
  });

  it("divide, transfiere y une cuentas sin perder cantidades", async () => {
    database = await createServiceFixture();
    const accounts = createAccountsService(database);
    const terminal = actor(fixtureIds.terminalOne);
    const opened = await accounts.open(
      {
        serviceType: "table",
        tableId: fixtureIds.table,
        guestCount: 3,
      },
      "open-split",
      terminal,
    );
    const added = await accounts.addItem(
      opened.body.id,
      { productId: fixtureIds.product, quantity: 3, expectedVersion: 0 },
      "add-three",
      terminal,
    );
    const split = await accounts.split(
      opened.body.id,
      {
        expectedVersion: added.body.accountVersion,
        items: [{ itemId: added.body.item.id, quantity: 1 }],
        reason: "Pago separado",
      },
      "split-one",
      terminal,
    );
    const sourceAfterSplit = await accounts.get(opened.body.id, terminal);
    const destinationAfterSplit = await accounts.get(
      split.body.destinationAccountId,
      terminal,
    );
    expect(sourceAfterSplit.totalInCents).toBe(2_000);
    expect(destinationAfterSplit.totalInCents).toBe(1_000);
    expect((await accounts.listByTable(fixtureIds.table, terminal)).accounts).toHaveLength(2);

    const transferred = await accounts.transferItems(
      opened.body.id,
      {
        destinationAccountId: split.body.destinationAccountId,
        sourceExpectedVersion: split.body.sourceVersion,
        destinationExpectedVersion: split.body.destinationVersion,
        items: [{ itemId: added.body.item.id, quantity: 1 }],
        reason: "Mover consumo",
      },
      "transfer-one",
      terminal,
    );
    expect((await accounts.get(opened.body.id, terminal)).totalInCents).toBe(1_000);
    expect(
      (await accounts.get(split.body.destinationAccountId, terminal)).totalInCents,
    ).toBe(2_000);

    const merged = await accounts.merge(
      opened.body.id,
      {
        destinationAccountId: split.body.destinationAccountId,
        sourceExpectedVersion: transferred.body.sourceVersion,
        destinationExpectedVersion: transferred.body.destinationVersion,
        reason: "Reunir cuenta",
      },
      "merge-back",
      terminal,
    );
    expect(merged.body.destinationVersion).toBe(3);
    const finalAccount = await accounts.get(split.body.destinationAccountId, terminal);
    expect(finalAccount.totalInCents).toBe(3_000);
    expect(finalAccount.isPrimary).toBe(true);
    expect((await accounts.listByTable(fixtureIds.table, terminal)).accounts).toHaveLength(1);

    const transfers = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM account_item_transfers",
    );
    expect(transfers.rows[0]?.count).toBe("3");
  });

  it("rechaza una versión obsoleta y envía exactamente una ronda", async () => {
    database = await createServiceFixture();
    const accounts = createAccountsService(database);
    const firstTerminal = actor(fixtureIds.terminalOne);
    const secondTerminal = actor(fixtureIds.terminalTwo);
    const opened = await accounts.open(
      { serviceType: "quick", guestCount: 1, reference: "Mostrador 12" },
      "open-quick-12",
      firstTerminal,
    );
    const accountId = opened.body.id;

    const firstItem = await accounts.addItem(
      accountId,
      {
        productId: fixtureIds.product,
        quantity: 1,
        expectedVersion: 0,
        modifierIds: [fixtureIds.modifier],
      },
      "add-first",
      firstTerminal,
    );
    expect(firstItem.body.accountVersion).toBe(1);

    await expect(
      accounts.addItem(
        accountId,
        {
          productId: fixtureIds.product,
          quantity: 1,
          expectedVersion: 0,
        },
        "stale-second-terminal",
        secondTerminal,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    const secondItem = await accounts.addItem(
      accountId,
      {
        productId: fixtureIds.product,
        quantity: 2,
        expectedVersion: 1,
      },
      "add-second",
      secondTerminal,
    );
    expect(secondItem.body.accountVersion).toBe(2);

    const sent = await accounts.sendRound(
      accountId,
      { expectedVersion: 2 },
      "send-round-one",
      firstTerminal,
    );
    const replay = await accounts.sendRound(
      accountId,
      { expectedVersion: 2 },
      "send-round-one",
      secondTerminal,
    );

    expect(sent.body.sequence).toBe(1);
    expect(sent.body.items).toHaveLength(2);
    expect(sent.body.accountVersion).toBe(3);
    expect(replay.body).toEqual(sent.body);
    expect(replay.replayed).toBe(true);

    const account = await accounts.get(accountId, firstTerminal);
    expect(account.version).toBe(3);
    expect(account.totalInCents).toBe(3200);
    expect(account.items.map((item) => item.preparationState)).toEqual([
      "sent",
      "sent",
    ]);

    await expect(
      accounts.updateItem(
        accountId,
        firstItem.body.item.id,
        { quantity: 3, expectedVersion: 3 },
        "edit-after-send",
        firstTerminal,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    const rounds = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM order_rounds",
    );
    const events = await database.query<{ event_type: string }>(
      "SELECT event_type FROM outbox_events ORDER BY created_at, id",
    );
    expect(rounds.rows[0]?.count).toBe("1");
    expect(events.rows.map((event) => event.event_type).sort()).toEqual([
      "account.opened",
      "account.updated",
      "account.updated",
      "order.round.submitted",
      "production.ticket.created",
    ].sort());
    const productionIntent = await database.query<{ tickets: string; jobs: string }>(
      `SELECT
         (SELECT count(*)::text FROM production_tickets) AS tickets,
         (SELECT count(*)::text FROM print_jobs) AS jobs`,
    );
    expect(productionIntent.rows[0]).toEqual({ tickets: "1", jobs: "1" });
  });
});
