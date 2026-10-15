import { BadRequestException, ConflictException } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { AccountsService } from "../src/accounts/accounts.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import { CashService } from "../src/cash/cash.service.js";
import { CatalogService } from "../src/catalog/catalog.service.js";
import { IdempotencyService } from "../src/idempotency/idempotency.service.js";
import { OutboxService } from "../src/outbox/outbox.service.js";
import { ProductionService } from "../src/production/production.service.js";
import { SalesService } from "../src/sales/sales.service.js";
import type { AuthContext } from "../src/security/auth-context.js";
import { createServiceFixture, fixtureIds } from "./service-fixture.js";
import type { TestDatabase } from "./test-database.js";

const actor = (): AuthContext => ({
  sessionId: crypto.randomUUID(),
  siteId: fixtureIds.site,
  userId: fixtureIds.user,
  terminalId: fixtureIds.terminalOne,
  displayName: "Administrador",
  permissions: [
    "cash.shift.read",
    "cash.shift.open",
    "sales.payment.capture",
    "sales.receipt.read",
  ],
});

const createServices = (database: TestDatabase) => {
  const audit = new AuditService();
  const idempotency = new IdempotencyService(database);
  const outbox = new OutboxService();
  const production = new ProductionService(database, audit, idempotency, outbox);
  const accounts = new AccountsService(database, audit, idempotency, outbox, production);
  const cash = new CashService(database, audit, idempotency, outbox);
  const sales = new SalesService(database, accounts, cash, audit, idempotency, outbox);
  return { accounts, cash, production, sales };
};

let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

describe("cobro y turno de caja", () => {
  it("abre un turno idempotente y registra el fondo sin convertirlo en venta", async () => {
    database = await createServiceFixture();
    const { cash } = createServices(database);
    const terminal = actor();

    const opened = await cash.openShift(
      { openingFloatInCents: 50_000 },
      "open-main-shift",
      terminal,
    );
    const replay = await cash.openShift(
      { openingFloatInCents: 50_000 },
      "open-main-shift",
      terminal,
    );
    const current = await cash.currentShift(terminal);

    expect(opened.body.shift).toMatchObject({
      status: "open",
      openingFloatInCents: 50_000,
    });
    expect(replay.replayed).toBe(true);
    expect(current.shift?.id).toBe(opened.body.shift.id);
    const movements = await database.query<{ type: string; amount_in_cents: number }>(
      "SELECT type, amount_in_cents FROM cash_movements",
    );
    expect(movements.rows).toEqual([
      expect.objectContaining({ type: "opening_float", amount_in_cents: 50_000 }),
    ]);
    expect((await database.query("SELECT id FROM sales_receipts")).rowCount).toBe(0);
  });

  it("cobra una cuenta con efectivo y tarjeta, registra propina/cambio y libera la mesa", async () => {
    database = await createServiceFixture();
    const { accounts, cash, production, sales } = createServices(database);
    const catalog = new CatalogService(database);
    const terminal = actor();
    await cash.openShift({ openingFloatInCents: 0 }, "open-for-sales", terminal);
    const opened = await accounts.open(
      { serviceType: "table", tableId: fixtureIds.table, guestCount: 2 },
      "open-sale-account",
      terminal,
    );
    const added = await accounts.addItem(
      opened.body.id,
      { productId: fixtureIds.product, quantity: 3, expectedVersion: 0 },
      "add-sale-items",
      terminal,
    );

    await expect(
      sales.checkout(
        opened.body.id,
        {
          expectedVersion: added.body.accountVersion,
          payments: [{
            methodCode: "CASH",
            amountInCents: 3_000,
            tipInCents: 0,
            tenderedInCents: 3_000,
          }],
        },
        "reject-pending-sale",
        terminal,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    const sent = await accounts.sendRound(
      opened.body.id,
      { expectedVersion: added.body.accountVersion },
      "send-sale-round",
      terminal,
    );
    await expect(
      sales.checkout(
        opened.body.id,
        {
          expectedVersion: sent.body.accountVersion,
          payments: [
            {
              methodCode: "CASH",
              amountInCents: 1_000,
              tipInCents: 0,
              tenderedInCents: 1_200,
            },
            {
              methodCode: "CARD",
              amountInCents: 2_000,
              tipInCents: 300,
            },
          ],
        },
        "reject-card-without-reference",
        terminal,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    const input = {
      expectedVersion: sent.body.accountVersion,
      payments: [
        {
          methodCode: "CASH" as const,
          amountInCents: 1_000,
          tipInCents: 0,
          tenderedInCents: 1_200,
        },
        {
          methodCode: "CARD" as const,
          amountInCents: 2_000,
          tipInCents: 300,
          reference: "AUTH-123",
        },
      ],
    };
    const receipt = await sales.checkout(
      opened.body.id,
      input,
      "capture-combined-sale",
      terminal,
    );
    const replay = await sales.checkout(
      opened.body.id,
      input,
      "capture-combined-sale",
      terminal,
    );

    expect(receipt.body).toMatchObject({
      folio: "T-000001",
      status: "issued",
      totals: {
        saleInCents: 3_000,
        tipInCents: 300,
        collectedInCents: 3_300,
        changeInCents: 200,
      },
    });
    expect(receipt.body.payments).toHaveLength(2);
    expect(replay.replayed).toBe(true);
    expect(await sales.getReceipt(receipt.body.id, terminal)).toEqual(receipt.body);
    await expect(
      sales.checkout(opened.body.id, input, "capture-sale-again", terminal),
    ).rejects.toBeInstanceOf(ConflictException);

    const layout = await catalog.serviceLayout(fixtureIds.site);
    expect(layout.areas[0]?.tables[0]).toMatchObject({
      state: "free",
      accountId: null,
      accountCount: 0,
    });
    const storedAccount = await database.query<{ status: string }>(
      "SELECT status FROM service_accounts WHERE id = $1",
      [opened.body.id],
    );
    expect(storedAccount.rows[0]?.status).toBe("closed");
    expect((await database.query("SELECT payment_id FROM payment_allocations")).rowCount).toBe(2);
    expect((await database.query("SELECT id FROM payment_tips")).rowCount).toBe(1);
    const cashMovement = await database.query<{ amount_in_cents: number }>(
      "SELECT amount_in_cents FROM cash_movements WHERE type = 'sale'",
    );
    expect(cashMovement.rows[0]?.amount_in_cents).toBe(1_000);

    const preliminary = await cash.currentReport(terminal);
    expect(preliminary).toMatchObject({
      sales: {
        receiptCount: 1,
        grossSaleInCents: 3_000,
        netSaleInCents: 3_000,
      },
      cash: { theoreticalInCents: 1_000 },
      openAccountCount: 0,
    });
    await cash.createMovement(
      { direction: "in", amountInCents: 500, reason: "Cambio adicional" },
      "cash-in",
      terminal,
    );
    await cash.createMovement(
      { direction: "out", amountInCents: 200, reason: "Compra urgente" },
      "cash-out",
      terminal,
    );
    const reprint = await sales.reprintReceipt(
      receipt.body.id,
      { reason: "Cliente solicita copia" },
      "receipt-copy",
      terminal,
    );
    expect(reprint.body.status).toBe("queued");

    const refunded = await sales.refundReceipt(
      receipt.body.id,
      { kind: "refund", reason: "Producto devuelto" },
      "refund-ticket",
      terminal,
    );
    const refundReplay = await sales.refundReceipt(
      receipt.body.id,
      { kind: "refund", reason: "Producto devuelto" },
      "refund-ticket",
      terminal,
    );
    expect(refunded.body).toMatchObject({
      folio: "T-000001",
      saleInCents: 3_000,
      tipInCents: 300,
    });
    expect(refundReplay.replayed).toBe(true);
    await expect(
      sales.refundReceipt(
        receipt.body.id,
        { kind: "refund", reason: "Intento duplicado" },
        "refund-ticket-again",
        terminal,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    const adjusted = await cash.currentReport(terminal);
    expect(adjusted).toMatchObject({
      sales: {
        refundCount: 1,
        refundedSaleInCents: 3_000,
        netSaleInCents: 0,
      },
      cash: { theoreticalInCents: 300 },
    });
    const closed = await cash.closeShift(
      {
        expectedVersion: 0,
        declarations: [
          { methodCode: "CASH", declaredInCents: 300 },
          { methodCode: "CARD", declaredInCents: 0 },
          { methodCode: "TRANSFER", declaredInCents: 0 },
        ],
      },
      "close-shift",
      terminal,
    );
    expect(closed.body).toMatchObject({
      status: "closed",
      declarations: [
        expect.objectContaining({ differenceInCents: 0 }),
        expect.objectContaining({ differenceInCents: 0 }),
        expect.objectContaining({ differenceInCents: 0 }),
      ],
    });
    expect((await cash.currentShift(terminal)).shift).toBeNull();
    expect((await database.query("SELECT id FROM cash_shift_closes")).rowCount).toBe(1);
    expect((await database.query("SELECT id FROM print_jobs")).rowCount).toBe(4);

    const agent = await production.registerAgent({
      siteCode: "PILOT",
      code: "PRINT-SALES",
      displayName: "Impresora de caja",
      centerCodes: ["KITCHEN"],
      registerCodes: ["MAIN"],
    });
    const printedKinds: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const claimed = await production.claimJob(agent.id, agent.token);
      expect(claimed.job).not.toBeNull();
      printedKinds.push(claimed.job!.kind);
      await production.completeJob(
        claimed.job!.id,
        claimed.job!.claimToken,
        agent.id,
        agent.token,
      );
    }
    expect(printedKinds).toEqual([
      "addition",
      "receipt",
      "receipt_reprint",
      "shift_close",
    ]);
  });
});
