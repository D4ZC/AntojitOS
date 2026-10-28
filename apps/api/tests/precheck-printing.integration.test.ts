import { NotFoundException } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { AccountsService } from "../src/accounts/accounts.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import { IdempotencyService } from "../src/idempotency/idempotency.service.js";
import { OutboxService } from "../src/outbox/outbox.service.js";
import { ProductionService } from "../src/production/production.service.js";
import { PrecheckPrintingService } from "../src/sales/precheck-printing.service.js";
import type { AuthContext } from "../src/security/auth-context.js";
import { createServiceFixture, fixtureIds } from "./service-fixture.js";
import type { TestDatabase } from "./test-database.js";

let database: TestDatabase | undefined;
afterEach(async () => { await database?.close(); database = undefined; });
const actor: AuthContext = {
  sessionId: crypto.randomUUID(), siteId: fixtureIds.site, userId: fixtureIds.user,
  terminalId: fixtureIds.terminalOne, displayName: "Cajero", permissions: ["service.precheck.create"],
};

describe("impresión de precuenta sin cobro", () => {
  it("conserva el snapshot, enruta sólo a caja y no crea ventas ni pagos ni abre turno", async () => {
    database = await createServiceFixture();
    const audit = new AuditService(); const idempotency = new IdempotencyService(database); const outbox = new OutboxService();
    const production = new ProductionService(database, audit, idempotency, outbox);
    const accounts = new AccountsService(database, audit, idempotency, outbox, production);
    const printing = new PrecheckPrintingService(database, audit, idempotency, outbox);
    const opened = await accounts.open({ serviceType: "takeaway", guestCount: 1, customerName: "Ana" }, "open", actor);
    await accounts.addItem(opened.body.id, { productId: fixtureIds.product, quantity: 2, expectedVersion: 0,
      modifierIds: [fixtureIds.modifier], note: "Sin verdura" }, "item", actor);
    const precheck = (await accounts.createPrecheck(opened.body.id, { expectedVersion: 1 }, "precheck", actor)).body;
    const printed = await printing.print(precheck.id, "print", actor);
    expect((await printing.print(precheck.id, "print", actor)).replayed).toBe(true);
    expect((await printing.print(precheck.id, "print-again", actor)).body.jobId).toBe(printed.body.jobId);
    // Edits after generation must not alter the paper already requested.
    await accounts.updateItem(opened.body.id, (precheck.account.items[0]!).id,
      { expectedVersion: 1, quantity: 3 }, "edit", actor);
    const kitchen = await production.registerAgent({ siteCode: "PILOT", code: "KITCHEN-ONLY", displayName: "Cocina", centerCodes: ["KITCHEN"], registerCodes: [] });
    expect((await production.claimJob(kitchen.id, kitchen.token)).job).toBeNull();
    const cashPrinter = await production.registerAgent({ siteCode: "PILOT", code: "CASH-ONLY", displayName: "Caja", centerCodes: [], registerCodes: ["MAIN"] });
    const claimed = (await production.claimJob(cashPrinter.id, cashPrinter.token)).job!;
    expect(claimed).toMatchObject({ precheckId: precheck.id, kind: "precheck", receiptId: null,
      payload: { kind: "precheck", precheck: { account: { customerName: "Ana", items: [{ quantity: 2, note: "Sin verdura" }] } } } });
    await production.completeJob(claimed.id, claimed.claimToken, cashPrinter.id, cashPrinter.token);
    expect((await printing.print(precheck.id, "completed", actor)).body.status).toBe("completed");
    for (const table of ["sales_receipts", "payments", "cash_shifts"]) {
      expect((await database.query(`SELECT id FROM ${table}`)).rowCount).toBe(0);
    }
    expect((await accounts.get(opened.body.id, actor)).status).toBe("open");
    await database.query("UPDATE print_jobs SET status = 'failed' WHERE id = $1", [printed.body.jobId]);
    expect((await printing.print(precheck.id, "retry", actor)).body).toMatchObject({ jobId: printed.body.jobId, requeued: true, status: "queued" });
    const otherSite = crypto.randomUUID();
    await database.query("INSERT INTO sites (id, code, name) VALUES ($1, 'OTHER', 'Otra')", [otherSite]);
    await expect(printing.print(precheck.id, "wrong-site", { ...actor, siteId: otherSite })).rejects.toBeInstanceOf(NotFoundException);
  });
});
