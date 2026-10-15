import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { AccountsService } from "../src/accounts/accounts.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import { IdempotencyService } from "../src/idempotency/idempotency.service.js";
import { OutboxService } from "../src/outbox/outbox.service.js";
import { ProductionService } from "../src/production/production.service.js";
import type { AuthContext } from "../src/security/auth-context.js";
import { createServiceFixture, fixtureIds } from "./service-fixture.js";
import type { TestDatabase } from "./test-database.js";

const actor: AuthContext = {
  sessionId: "20000000-0000-4000-8000-000000000001",
  siteId: fixtureIds.site,
  userId: fixtureIds.user,
  terminalId: fixtureIds.terminalOne,
  displayName: "Administrador",
  permissions: [
    "service.account.open",
    "service.account.read",
    "service.item.add",
    "service.item.edit",
    "service.round.send",
    "production.ticket.read",
    "production.ticket.update",
    "production.job.reprint",
  ],
};

const services = (database: TestDatabase) => {
  const audit = new AuditService();
  const idempotency = new IdempotencyService(database);
  const outbox = new OutboxService();
  const production = new ProductionService(database, audit, idempotency, outbox);
  const accounts = new AccountsService(
    database,
    audit,
    idempotency,
    outbox,
    production,
  );
  return { accounts, production };
};

const createProductionIntent = async (
  accounts: AccountsService,
): Promise<{ accountId: string; ticketId: string }> => {
  const opened = await accounts.open(
    { serviceType: "table", tableId: fixtureIds.table, guestCount: 2 },
    "open-for-production",
    actor,
  );
  await accounts.addItem(
    opened.body.id,
    {
      productId: fixtureIds.product,
      quantity: 2,
      expectedVersion: 0,
      modifierIds: [fixtureIds.modifier],
      note: "Bien dorados",
    },
    "add-for-production",
    actor,
  );
  const sent = await accounts.sendRound(
    opened.body.id,
    { expectedVersion: 1 },
    "send-for-production",
    actor,
  );
  const planned = sent.body.production[0];
  if (!planned) throw new Error("No se creó la intención de producción");
  return { accountId: opened.body.id, ticketId: planned.ticketId };
};

let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

describe("producción e impresión durable", () => {
  it("separa la comanda, progresa en KDS y conserva instantáneas", async () => {
    database = await createServiceFixture();
    const { accounts, production } = services(database);
    const { ticketId } = await createProductionIntent(accounts);

    const queue = await production.listTickets(fixtureIds.site);
    expect(queue.tickets).toHaveLength(1);
    expect(queue.tickets[0]).toMatchObject({
      id: ticketId,
      center: { code: "KITCHEN", name: "Cocina" },
      kind: "addition",
      status: "pending",
      service: { label: "Mesa 1" },
      items: [{
        productName: "Taco de prueba",
        quantity: 2,
        note: "Bien dorados",
        modifiers: ["Extra"],
      }],
    });

    const started = await production.transition(
      ticketId,
      { status: "in_progress", expectedVersion: 0 },
      "start-ticket",
      actor,
    );
    const replay = await production.transition(
      ticketId,
      { status: "in_progress", expectedVersion: 0 },
      "start-ticket",
      actor,
    );
    expect(started.body.version).toBe(1);
    expect(replay.replayed).toBe(true);

    await production.transition(
      ticketId,
      { status: "ready", expectedVersion: 1 },
      "ready-ticket",
      actor,
    );
    await production.transition(
      ticketId,
      { status: "delivered", expectedVersion: 2 },
      "deliver-ticket",
      actor,
    );
    expect((await production.listTickets(fixtureIds.site)).tickets).toEqual([]);
    await expect(
      production.transition(
        ticketId,
        { status: "ready", expectedVersion: 3 },
        "invalid-backwards",
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("reintenta una impresión fallida sin duplicar la intención", async () => {
    database = await createServiceFixture();
    const { accounts, production } = services(database);
    await createProductionIntent(accounts);
    const agent = await production.registerAgent({
      siteCode: "PILOT",
      code: "PRINT-01",
      displayName: "Agente de prueba",
      centerCodes: ["KITCHEN"],
    });

    await expect(
      production.claimJob(agent.id, "token-equivocado"),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const firstClaim = await production.claimJob(agent.id, agent.token);
    expect(firstClaim.job).toMatchObject({
      kind: "addition",
      attempt: 1,
      payload: {
        center: { code: "KITCHEN" },
        service: { label: "Mesa 1" },
        items: [{ productName: "Taco de prueba", quantity: 2 }],
      },
    });
    if (!firstClaim.job) throw new Error("No se reclamó el trabajo");
    const failed = await production.failJob(
      firstClaim.job.id,
      firstClaim.job.claimToken,
      "Impresora apagada",
      agent.id,
      agent.token,
    );
    expect(failed).toMatchObject({ status: "queued", willRetry: true });

    await database.query(
      "UPDATE print_jobs SET available_at = now() WHERE id = $1",
      [firstClaim.job.id],
    );
    const secondClaim = await production.claimJob(agent.id, agent.token);
    expect(secondClaim.job).toMatchObject({
      id: firstClaim.job.id,
      attempt: 2,
    });
    if (!secondClaim.job) throw new Error("No se reintentó el trabajo");
    await production.completeJob(
      secondClaim.job.id,
      secondClaim.job.claimToken,
      agent.id,
      agent.token,
    );

    expect((await production.claimJob(agent.id, agent.token)).job).toBeNull();
    const counts = await database.query<{ jobs: string; attempts: string }>(
      `SELECT
         (SELECT count(*)::text FROM print_jobs) AS jobs,
         (SELECT count(*)::text FROM print_job_attempts) AS attempts`,
    );
    expect(counts.rows[0]).toEqual({ jobs: "1", attempts: "2" });
    const attempts = await database.query<{ status: string }>(
      "SELECT status FROM print_job_attempts ORDER BY attempt_number",
    );
    expect(attempts.rows.map((attempt) => attempt.status)).toEqual([
      "failed",
      "completed",
    ]);
  });

  it("crea una reimpresión separada y auditada", async () => {
    database = await createServiceFixture();
    const { accounts, production } = services(database);
    const { ticketId } = await createProductionIntent(accounts);

    const requested = await production.reprint(
      ticketId,
      { reason: "Papel atascado" },
      "reprint-paper-jam",
      actor,
    );
    const replay = await production.reprint(
      ticketId,
      { reason: "Papel atascado" },
      "reprint-paper-jam",
      actor,
    );
    expect(replay.body).toEqual(requested.body);
    expect(replay.replayed).toBe(true);

    const jobs = await database.query<{ kind: string; original_job_id: string | null }>(
      "SELECT kind, original_job_id FROM print_jobs ORDER BY created_at, id",
    );
    expect(jobs.rows).toHaveLength(2);
    expect(jobs.rows.map((job) => job.kind).sort()).toEqual(["addition", "reprint"]);
    expect(jobs.rows.find((job) => job.kind === "reprint")?.original_job_id).toBeTruthy();
    const audit = await database.query<{ reason: string }>(
      `SELECT reason FROM audit_events
        WHERE action = 'production.ticket.reprint_requested'`,
    );
    expect(audit.rows[0]?.reason).toBe("Papel atascado");
  });

  it("genera una comanda diferenciada al cancelar un artículo enviado", async () => {
    database = await createServiceFixture();
    const { accounts, production } = services(database);
    const { accountId } = await createProductionIntent(accounts);
    const before = await accounts.get(accountId, actor);
    const item = before.items[0];
    if (!item) throw new Error("La cuenta no contiene el artículo esperado");

    const cancelled = await accounts.cancelItem(
      accountId,
      item.id,
      { expectedVersion: 2, reason: "Cliente cambió de opinión" },
      "cancel-sent-item",
      actor,
    );
    expect(cancelled.body).toMatchObject({
      state: "cancelled",
      previousState: "sent",
      accountVersion: 3,
      production: expect.objectContaining({ ticketId: expect.any(String) }),
    });

    const after = await accounts.get(accountId, actor);
    expect(after.totalInCents).toBe(0);
    expect(after.items[0]?.preparationState).toBe("cancelled");
    const queue = await production.listTickets(fixtureIds.site);
    expect(queue.tickets).toHaveLength(2);
    expect(queue.tickets.find((ticket) => ticket.kind === "cancellation")).toMatchObject({
      center: { code: "KITCHEN" },
      items: [{
        productName: "Taco de prueba",
        quantity: 2,
        note: "Cliente cambió de opinión",
      }],
    });
    const jobs = await database.query<{ kind: string }>(
      "SELECT kind FROM print_jobs ORDER BY created_at, id",
    );
    expect(jobs.rows.map((job) => job.kind).sort()).toEqual([
      "addition",
      "cancellation",
    ]);
  });
});
