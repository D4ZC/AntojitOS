import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountsService } from "../src/accounts/accounts.service.js";
import { ScheduledOrdersWorker } from "../src/accounts/scheduled-orders.worker.js";
import { AuditService } from "../src/audit/audit.service.js";
import { CashService } from "../src/cash/cash.service.js";
import { IdempotencyService } from "../src/idempotency/idempotency.service.js";
import { OutboxService } from "../src/outbox/outbox.service.js";
import { ProductionService } from "../src/production/production.service.js";
import type { AuthContext } from "../src/security/auth-context.js";
import { createServiceFixture, fixtureIds } from "./service-fixture.js";
import type { TestDatabase } from "./test-database.js";

const operator: AuthContext = {
  sessionId: crypto.randomUUID(),
  siteId: fixtureIds.site,
  userId: fixtureIds.user,
  terminalId: fixtureIds.terminalOne,
  displayName: "Operador",
  permissions: ["service.account.open", "service.item.edit", "service.round.send"],
};
const manager = { ...operator, permissions: [...operator.permissions, "service.account.manage"] };
const future = () => new Date(Date.now() + 86_400_000).toISOString();

const services = (database: TestDatabase) => {
  const audit = new AuditService();
  const idempotency = new IdempotencyService(database);
  const outbox = new OutboxService();
  const production = new ProductionService(database, audit, idempotency, outbox);
  const accounts = new AccountsService(database, audit, idempotency, outbox, production);
  const worker = new ScheduledOrdersWorker(database, accounts);
  const cash = new CashService(database, audit, idempotency, outbox);
  return { accounts, production, worker, cash };
};

let database: TestDatabase | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await database?.close();
  database = undefined;
});

describe("datos del pedido, notas enviadas y programación durable", () => {
  it("conserva cliente y fecha al abrir, editar, listar y desprogramar con null", async () => {
    database = await createServiceFixture();
    const { accounts } = services(database);
    const scheduledFor = future();
    const opened = await accounts.open({
      serviceType: "takeaway", guestCount: 1, customerName: "  Ana López  ", scheduledFor,
    }, "details-open", operator);
    expect(opened.body).toMatchObject({ customerName: "Ana López", scheduledFor, scheduleDispatchedAt: null });
    expect((await accounts.listOpenCounter(operator)).accounts[0]).toMatchObject({
      customerName: "Ana López", scheduledFor, scheduleDispatchedAt: null,
    });

    const named = await accounts.updateDetails(opened.body.id, {
      expectedVersion: 0, customerName: "Ana",
    }, "rename-customer", operator);
    expect(named.body).toMatchObject({ customerName: "Ana", scheduledFor, accountVersion: 1 });
    expect((await accounts.get(opened.body.id, operator)).customerName).toBe("Ana");
    const cleared = await accounts.updateDetails(opened.body.id, {
      expectedVersion: 1, customerName: null, scheduledFor: null,
    }, "clear-details", operator);
    expect(cleared.body).toMatchObject({ customerName: null, scheduledFor: null, scheduleDispatchedAt: null });

    await expect(accounts.updateDetails(opened.body.id, {
      expectedVersion: 2, scheduledFor: "2020-01-01T12:00:00Z",
    }, "past-date", operator)).rejects.toBeInstanceOf(BadRequestException);
    await expect(accounts.open({
      serviceType: "quick", guestCount: 1, scheduledFor: "2099-01-01T12:00:00",
    }, "missing-timezone", operator)).rejects.toBeInstanceOf(BadRequestException);
    await expect(accounts.open({
      serviceType: "quick", guestCount: 1, customerName: "a".repeat(81),
    }, "long-customer", operator)).rejects.toBeInstanceOf(BadRequestException);
    expect((await accounts.get(opened.body.id, operator)).version).toBe(2);

    const table = await accounts.open({
      serviceType: "table", tableId: fixtureIds.table, guestCount: 1,
      customerName: "Cliente de mesa", scheduledFor,
    }, "table-details", operator);
    expect((await accounts.listByTable(fixtureIds.table, operator)).accounts[0]).toMatchObject({
      id: table.body.id, customerName: "Cliente de mesa", scheduledFor,
    });
  });

  it("permite al operador descartar su borrador con artículos en una operación auditada", async () => {
    database = await createServiceFixture();
    const { accounts } = services(database);
    const opened = await accounts.open({ serviceType: "quick", guestCount: 1 }, "draft-open", operator);
    const item = await accounts.addItem(opened.body.id, {
      productId: fixtureIds.product, quantity: 2, expectedVersion: 0,
    }, "draft-add", operator);
    const another = { ...operator, userId: fixtureIds.userTwo };
    await expect(accounts.cancelAccount(opened.body.id, {
      expectedVersion: 1, reason: "Ajeno",
    }, "foreign-cancel", another)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(accounts.updateDetails(opened.body.id, {
      expectedVersion: 1, customerName: "Ajeno",
    }, "foreign-details", another)).rejects.toBeInstanceOf(ForbiddenException);

    const input = { expectedVersion: 1, reason: "Borrador abandonado" };
    const cancelled = await accounts.cancelAccount(opened.body.id, input, "discard-draft", operator);
    const replay = await accounts.cancelAccount(opened.body.id, input, "discard-draft", operator);
    expect(cancelled.body.cancelledItemIds).toEqual([item.body.item.id]);
    expect(replay.replayed).toBe(true);
    expect((await accounts.listOpenCounter(operator)).accounts).toHaveLength(0);
    const account = await accounts.get(opened.body.id, operator);
    expect(account).toMatchObject({ status: "cancelled", version: 2, totalInCents: 0 });
    expect(account.items[0]?.preparationState).toBe("cancelled");
    const audit = await database.query<{ changes: { cancelledItemIds: string[] }; reason: string }>(
      "SELECT changes, reason FROM audit_events WHERE action = 'account.cancelled' AND entity_id = $1",
      [opened.body.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ reason: "Borrador abandonado", changes: { cancelledItemIds: [item.body.item.id] } });
    expect((await database.query("SELECT id FROM production_tickets")).rowCount).toBe(0);
  });

  it("rechaza descartar cuentas con artículos enviados o descuentos activos", async () => {
    database = await createServiceFixture();
    const { accounts } = services(database);
    const sent = await accounts.open({ serviceType: "quick", guestCount: 1 }, "sent-open", operator);
    await accounts.addItem(sent.body.id, { productId: fixtureIds.product, quantity: 1, expectedVersion: 0 }, "sent-add", operator);
    await accounts.sendRound(sent.body.id, { expectedVersion: 1 }, "sent-send", operator);
    await expect(accounts.cancelAccount(sent.body.id, { expectedVersion: 2, reason: "Descartar" }, "sent-discard", operator))
      .rejects.toBeInstanceOf(ConflictException);
    const discounted = await accounts.open({ serviceType: "quick", guestCount: 1 }, "discount-open", operator);
    await accounts.addItem(discounted.body.id, { productId: fixtureIds.product, quantity: 1, expectedVersion: 0 }, "discount-add", operator);
    await accounts.applyAdjustment(discounted.body.id, {
      kind: "discount", calculation: "fixed", value: 100, expectedVersion: 1, reason: "Promoción",
    }, "discount-apply", manager);
    await expect(accounts.cancelAccount(discounted.body.id, { expectedVersion: 2, reason: "Descartar" }, "discount-discard", operator))
      .rejects.toBeInstanceOf(ConflictException);
    expect((await accounts.get(discounted.body.id, operator)).items[0]?.preparationState).toBe("pending");
    const table = await accounts.open({ serviceType: "table", tableId: fixtureIds.table, guestCount: 1 }, "table-open", operator);
    await expect(accounts.cancelAccount(table.body.id, { expectedVersion: 0, reason: "Mesa" }, "table-discard", operator))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it("despacha vencidos sin tablet y una sola vez aunque concurran dos procesos", async () => {
    database = await createServiceFixture();
    const { accounts, worker } = services(database);
    const opened = await accounts.open({
      serviceType: "takeaway", guestCount: 1, scheduledFor: future(), customerName: "Luis",
    }, "schedule-open", operator);
    await accounts.addItem(opened.body.id, {
      productId: fixtureIds.product, quantity: 2, expectedVersion: 0, note: "Con todo",
    }, "schedule-add", operator);
    await expect(accounts.sendRound(opened.body.id, { expectedVersion: 1 }, "send-too-early", operator))
      .rejects.toBeInstanceOf(ConflictException);
    await worker.dispatchDue();
    expect((await database.query("SELECT id FROM order_rounds")).rowCount).toBe(0);
    await database.query("UPDATE service_accounts SET scheduled_for = now() - interval '1 minute' WHERE id = $1", [opened.body.id]);
    expect((await accounts.get(opened.body.id, operator)).scheduledFor).toBeTruthy();
    const restarted = services(database);
    const results = await Promise.all([
      accounts.dispatchScheduledAccount(opened.body.id),
      restarted.accounts.dispatchScheduledAccount(opened.body.id),
    ]);
    expect(results.sort()).toEqual([false, true]);
    await restarted.worker.dispatchDue();
    const account = await accounts.get(opened.body.id, operator);
    expect(account).toMatchObject({ version: 2, customerName: "Luis", items: [expect.objectContaining({ preparationState: "sent", note: "Con todo" })] });
    expect(account.scheduleDispatchedAt).toBeTruthy();
    expect(account.scheduledFor).toBeTruthy();
    expect((await database.query("SELECT id FROM order_rounds")).rowCount).toBe(1);
    expect((await database.query("SELECT id FROM production_tickets")).rowCount).toBe(1);
    expect((await database.query("SELECT id FROM print_jobs WHERE kind = 'addition'")).rowCount).toBe(1);
  });

  it("revierte un fallo de producción, conserva el error y reintenta tras reiniciar", async () => {
    database = await createServiceFixture();
    const { accounts, worker } = services(database);
    const opened = await accounts.open({ serviceType: "quick", guestCount: 1, scheduledFor: future() }, "retry-open", operator);
    await accounts.addItem(opened.body.id, { productId: fixtureIds.product, quantity: 1, expectedVersion: 0 }, "retry-add", operator);
    await database.query("UPDATE service_accounts SET scheduled_for = now() - interval '1 minute' WHERE id = $1", [opened.body.id]);
    await database.query("UPDATE production_centers SET active = false WHERE id = $1", [fixtureIds.productionCenter]);
    vi.spyOn(worker["logger"], "error").mockImplementation(() => {});
    await worker.dispatchDue();
    const failed = await accounts.get(opened.body.id, operator);
    expect(failed).toMatchObject({ version: 1, scheduleDispatchedAt: null, items: [expect.objectContaining({ preparationState: "pending" })] });
    expect(failed.scheduleError).toContain("centro de producción activo");
    expect((await accounts.listOpenCounter(operator)).accounts[0]?.scheduleError).toBe(failed.scheduleError);
    expect((await database.query("SELECT id FROM order_rounds")).rowCount).toBe(0);
    expect((await database.query("SELECT id FROM print_jobs")).rowCount).toBe(0);
    await database.query("UPDATE production_centers SET active = true WHERE id = $1", [fixtureIds.productionCenter]);
    await database.query("UPDATE service_accounts SET schedule_retry_after = now() - interval '1 second' WHERE id = $1", [opened.body.id]);
    await services(database).worker.dispatchDue();
    expect((await accounts.get(opened.body.id, operator))).toMatchObject({ version: 2, scheduleError: null });
    expect((await database.query("SELECT id FROM print_jobs")).rowCount).toBe(1);
  });

  it("no envía pedidos cancelados o desprogramados y bloquea mover artículos programados", async () => {
    database = await createServiceFixture();
    const { accounts, worker } = services(database);
    const scheduled = await accounts.open({ serviceType: "quick", guestCount: 1, scheduledFor: future() }, "move-open", manager);
    const added = await accounts.addItem(scheduled.body.id, { productId: fixtureIds.product, quantity: 2, expectedVersion: 0 }, "move-add", manager);
    const target = await accounts.open({ serviceType: "quick", guestCount: 1 }, "move-target", manager);
    const selection = { items: [{ itemId: added.body.item.id, quantity: 1 }], reason: "Mover" };
    await expect(accounts.split(scheduled.body.id, { ...selection, expectedVersion: 1 }, "scheduled-split", manager)).rejects.toBeInstanceOf(ConflictException);
    const pair = { sourceExpectedVersion: 1, destinationExpectedVersion: 0, destinationAccountId: target.body.id, reason: "Mover" };
    await expect(accounts.transferItems(scheduled.body.id, { ...pair, items: selection.items }, "scheduled-transfer", manager)).rejects.toBeInstanceOf(ConflictException);
    await expect(accounts.merge(scheduled.body.id, pair, "scheduled-merge", manager)).rejects.toBeInstanceOf(ConflictException);
    await accounts.updateDetails(scheduled.body.id, { expectedVersion: 1, scheduledFor: null }, "unschedule", manager);
    await worker.dispatchDue();
    expect((await accounts.get(scheduled.body.id, manager)).items[0]?.preparationState).toBe("pending");
    await accounts.updateDetails(scheduled.body.id, { expectedVersion: 2, scheduledFor: future() }, "reschedule", manager);
    await accounts.cancelAccount(scheduled.body.id, { expectedVersion: 3, reason: "Ya no vendrá" }, "cancel-scheduled", manager);
    await database.query("UPDATE service_accounts SET scheduled_for = now() - interval '1 minute' WHERE id = $1", [scheduled.body.id]);
    await worker.dispatchDue();
    expect((await database.query("SELECT id FROM order_rounds")).rowCount).toBe(0);
  });

  it("actualiza notas enviadas y entregadas, avisa cocina e imprime sin duplicar producción", async () => {
    database = await createServiceFixture();
    const { accounts, production } = services(database);
    const opened = await accounts.open({ serviceType: "quick", guestCount: 1 }, "note-open", operator);
    const added = await accounts.addItem(opened.body.id, {
      productId: fixtureIds.product, quantity: 2, expectedVersion: 0, note: "Dorados",
    }, "note-add", operator);
    const sent = await accounts.sendRound(opened.body.id, { expectedVersion: 1 }, "note-send", operator);
    const ticketId = sent.body.production[0]!.ticketId;
    const input = { quantity: 2, expectedVersion: 2, note: "Sin crema" };
    await accounts.updateItem(opened.body.id, added.body.item.id, input, "note-update", operator);
    expect((await accounts.updateItem(opened.body.id, added.body.item.id, input, "note-update", operator)).replayed).toBe(true);
    expect((await production.listTickets(fixtureIds.site)).tickets[0]?.items[0]?.note).toBe("Sin crema");
    await expect(accounts.updateItem(opened.body.id, added.body.item.id, {
      quantity: 3, expectedVersion: 3, note: "Otra",
    }, "change-sent-qty", operator)).rejects.toBeInstanceOf(ConflictException);
    await accounts.updateItem(opened.body.id, added.body.item.id, { quantity: 2, expectedVersion: 3 }, "keep-note", operator);
    expect((await accounts.get(opened.body.id, operator)).items[0]?.note).toBe("Sin crema");
    await production.transition(ticketId, { expectedVersion: 0, status: "in_progress" }, "note-start", operator);
    await production.transition(ticketId, { expectedVersion: 1, status: "ready" }, "note-ready", operator);
    await production.transition(ticketId, { expectedVersion: 2, status: "delivered" }, "note-deliver", operator);
    // Delivered KDS tickets currently keep the item as sent. Also cover accounts
    // containing the supported fulfilled state (for example imported records).
    await database.query("UPDATE order_items SET preparation_state = 'fulfilled' WHERE id = $1", [added.body.item.id]);
    await accounts.updateItem(opened.body.id, added.body.item.id, { quantity: 2, expectedVersion: 4, note: null }, "clear-sent-note", operator);
    const account = await accounts.get(opened.body.id, operator);
    expect(account.items[0]).toMatchObject({ preparationState: "fulfilled", quantity: 2, note: null });
    const jobs = await database.query<{ payload: { kind: string; items: Array<{ note: string | null }>; previousNote: string | null } }>(
      "SELECT payload FROM print_jobs WHERE kind = 'note_update' ORDER BY created_at, id",
    );
    expect(jobs.rows).toHaveLength(2);
    expect(jobs.rows.map((row) => row.payload.items[0]?.note)).toEqual(["Sin crema", null]);
    expect((await database.query("SELECT id FROM production_tickets")).rowCount).toBe(1);
    expect((await database.query("SELECT id FROM order_rounds")).rowCount).toBe(1);
    expect((await database.query("SELECT id FROM outbox_events WHERE event_type = 'production.ticket.updated'")).rowCount).toBe(5);
  });

  it("deja cerrar caja con pedidos futuros sin producción, y cuenta los ordinarios o vencidos", async () => {
    database = await createServiceFixture();
    const { accounts, cash } = services(database);
    await cash.openShift({ openingFloatInCents: 0 }, "cash-schedule-open", operator);
    const scheduled = await accounts.open({ serviceType: "takeaway", guestCount: 1, scheduledFor: future() }, "cash-future", operator);
    await accounts.addItem(scheduled.body.id, { productId: fixtureIds.product, quantity: 1, expectedVersion: 0 }, "cash-add", operator);
    expect((await cash.currentReport(operator)).openAccountCount).toBe(0);
    const ordinary = await accounts.open({ serviceType: "quick", guestCount: 1 }, "cash-ordinary", operator);
    expect((await cash.currentReport(operator)).openAccountCount).toBe(1);
    await accounts.cancelAccount(ordinary.body.id, { expectedVersion: 0, reason: "Vacía" }, "cash-discard", operator);
    await database.query("UPDATE service_accounts SET scheduled_for = now() - interval '1 minute' WHERE id = $1", [scheduled.body.id]);
    expect((await cash.currentReport(operator)).openAccountCount).toBe(1);
    await accounts.updateDetails(scheduled.body.id, { expectedVersion: 1, scheduledFor: future() }, "cash-reschedule", operator);
    const closed = await cash.closeShift({ expectedVersion: 0, declarations: [
      { methodCode: "CASH", declaredInCents: 0 }, { methodCode: "CARD", declaredInCents: 0 }, { methodCode: "TRANSFER", declaredInCents: 0 },
    ] }, "cash-close", operator);
    expect(closed.body.status).toBe("closed");
    expect((await accounts.get(scheduled.body.id, operator)).status).toBe("open");
  });
});
