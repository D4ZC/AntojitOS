import { ConflictException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { AccountsService } from "../src/accounts/accounts.service.js";
import { AuditService } from "../src/audit/audit.service.js";
import { AuthService } from "../src/auth/auth.service.js";
import { DATABASE } from "../src/database/database.port.js";
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
      printStatus: "queued",
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
    expect((await production.listAccountTickets(queue.tickets[0]!.accountId, fixtureIds.site)).tickets)
      .toMatchObject([{ id: ticketId, status: "delivered" }]);
    await expect(
      production.transition(
        ticketId,
        { status: "ready", expectedVersion: 3 },
        "invalid-backwards",
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("imprime al enviar y reutiliza la impresión pendiente o reclamada antes de crear una copia", async () => {
    database = await createServiceFixture();
    const { accounts, production } = services(database);
    const { accountId, ticketId } = await createProductionIntent(accounts);
    const replayedSend = await accounts.sendRound(
      accountId, { expectedVersion: 1 }, "send-for-production", actor,
    );
    expect(replayedSend.replayed).toBe(true);
    const automatic = replayedSend.body.production[0]!;
    const queued = await production.print(ticketId, "manual-queued", actor);
    expect(queued.body).toEqual({
      ticketId, jobId: automatic.jobId, status: "queued", created: false, requeued: false,
    });
    expect((await database.query("SELECT id FROM print_jobs")).rowCount).toBe(1);
    const agent = await production.registerAgent({
      siteCode: "PILOT", code: "MANUAL-PRINT", displayName: "Caja principal",
      centerCodes: ["KITCHEN"],
    });
    const claimed = (await production.claimJob(agent.id, agent.token)).job!;
    expect((await production.print(ticketId, "manual-claimed", actor)).body).toMatchObject({
      jobId: automatic.jobId, status: "claimed", created: false, requeued: false,
    });
    await production.completeJob(claimed.id, claimed.claimToken, agent.id, agent.token);
    const copy = await production.print(ticketId, "manual-copy", actor);
    expect(copy.body).toMatchObject({ ticketId, status: "queued", created: true, requeued: false });
    expect(copy.body.jobId).not.toBe(automatic.jobId);
    expect((await production.print(ticketId, "manual-copy", actor)).replayed).toBe(true);
    expect((await production.print(ticketId, "manual-copy-other-terminal", {
      ...actor, terminalId: fixtureIds.terminalTwo,
    })).body).toMatchObject({ jobId: copy.body.jobId, created: false });
    const copyClaimed = (await production.claimJob(agent.id, agent.token)).job!;
    expect(copyClaimed).toMatchObject({
      id: copy.body.jobId, kind: "reprint",
      payload: {
        reprint: { reason: "Impresión manual de comanda", requestedBy: "Administrador" },
        items: [{ note: "Bien dorados", modifiers: ["Extra"] }],
      },
    });
    expect((await database.query("SELECT id FROM print_jobs")).rowCount).toBe(2);
    expect((await database.query(
      "SELECT id FROM audit_events WHERE action = 'production.ticket.reprint_requested'",
    )).rowCount).toBe(1);
    await database.query(
      "INSERT INTO sites (id, code, name) VALUES ('10000000-0000-4000-8000-000000009999', 'OTHER', 'Otra sucursal')",
    );
    await expect(production.print(ticketId, "wrong-site", {
      ...actor, siteId: "10000000-0000-4000-8000-000000009999",
    })).rejects.toBeInstanceOf(NotFoundException);
    await expect(production.listAccountTickets(accountId, "10000000-0000-4000-8000-000000009999"))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it("recupera la impresión original agotada conservando intentos e identidad", async () => {
    database = await createServiceFixture();
    const { accounts, production } = services(database);
    const { accountId, ticketId } = await createProductionIntent(accounts);
    const agent = await production.registerAgent({
      siteCode: "PILOT", code: "FAILED-PRINT", displayName: "Caja principal",
      centerCodes: ["KITCHEN"],
    });
    let originalId = "";
    for (let attempt = 1; attempt <= 5; attempt++) {
      await database.query("UPDATE print_jobs SET available_at = now() WHERE ticket_id = $1", [ticketId]);
      const claimed = (await production.claimJob(agent.id, agent.token)).job!;
      originalId = claimed.id;
      await production.failJob(claimed.id, claimed.claimToken, "Sin papel", agent.id, agent.token);
    }
    expect((await production.listAccountTickets(accountId, fixtureIds.site)).tickets[0])
      .toMatchObject({ printStatus: "failed", printLastError: "Sin papel" });
    const recovered = await production.print(ticketId, "manual-recover", actor);
    expect(recovered.body).toEqual({
      ticketId, jobId: originalId, status: "queued", created: false, requeued: true,
    });
    expect((await production.print(ticketId, "manual-recover", actor)).replayed).toBe(true);
    const sixth = (await production.claimJob(agent.id, agent.token)).job!;
    expect(sixth).toMatchObject({ id: originalId, attempt: 6 });
    await production.completeJob(sixth.id, sixth.claimToken, agent.id, agent.token);
    expect((await database.query("SELECT id FROM print_jobs")).rowCount).toBe(1);
    expect((await database.query("SELECT id FROM print_job_attempts")).rowCount).toBe(6);
    expect((await database.query("SELECT max_attempts FROM print_jobs")).rows[0]).toEqual({ max_attempts: 10 });
    expect((await database.query(
      "SELECT id FROM audit_events WHERE action = 'production.ticket.print_recovered'",
    )).rowCount).toBe(1);
  });

  it.each(["note_update", "reprint"] as const)("recupera %s fallido y las copias usan las notas vigentes", async (kind) => {
    database = await createServiceFixture();
    const { accounts, production } = services(database);
    const { accountId, ticketId } = await createProductionIntent(accounts);
    const agent = await production.registerAgent({
      siteCode: "PILOT", code: "EXTRA-PRINT", displayName: "Caja principal",
      centerCodes: ["KITCHEN"],
    });
    const original = (await production.claimJob(agent.id, agent.token)).job!;
    await production.completeJob(original.id, original.claimToken, agent.id, agent.token);
    const itemId = (await accounts.get(accountId, actor)).items[0]!.id;
    await accounts.updateItem(accountId, itemId, {
      expectedVersion: 2, quantity: 2, note: "Sin crema",
    }, "edit-printed-note", actor);
    const note = (await production.claimJob(agent.id, agent.token)).job!;
    let target = note;
    if (kind === "reprint") {
      await production.completeJob(note.id, note.claimToken, agent.id, agent.token);
      await production.print(ticketId, "new-copy-updated-note", actor);
      target = (await production.claimJob(agent.id, agent.token)).job!;
      expect(target.payload.items).toMatchObject([{ note: "Sin crema" }]);
    }
    expect(target.kind).toBe(kind);
    await database.query("UPDATE print_jobs SET max_attempts = attempts WHERE id = $1", [target.id]);
    await production.failJob(target.id, target.claimToken, "Impresora apagada", agent.id, agent.token);
    const before = (await database.query("SELECT id FROM print_jobs")).rowCount;
    expect((await production.print(ticketId, "recover-last-job", actor)).body).toMatchObject({
      jobId: target.id, created: false, requeued: true,
    });
    const retry = (await production.claimJob(agent.id, agent.token)).job!;
    expect(retry).toMatchObject({ id: target.id, kind, attempt: 2 });
    expect((await database.query("SELECT id FROM print_jobs")).rowCount).toBe(before);
  });

  it("crea una copia cuando una impresión posterior completada ya sustituyó al fallo histórico", async () => {
    database = await createServiceFixture();
    const { accounts, production } = services(database);
    const { ticketId } = await createProductionIntent(accounts);
    const agent = await production.registerAgent({
      siteCode: "PILOT", code: "HISTORICAL-FAILURE", displayName: "Caja principal",
      centerCodes: ["KITCHEN"],
    });
    const original = (await production.claimJob(agent.id, agent.token)).job!;
    await database.query("UPDATE print_jobs SET max_attempts = 1 WHERE id = $1", [original.id]);
    await production.failJob(original.id, original.claimToken, "Atasco", agent.id, agent.token);
    const replacement = await production.reprint(ticketId, { reason: "Copia después del atasco" }, "replacement", actor);
    const copy = (await production.claimJob(agent.id, agent.token)).job!;
    expect(copy.id).toBe(replacement.body.jobId);
    await production.completeJob(copy.id, copy.claimToken, agent.id, agent.token);
    expect((await production.print(ticketId, "new-copy-after-replacement", actor)).body)
      .toMatchObject({ created: true, requeued: false, status: "queued" });
    expect((await database.query("SELECT status FROM print_jobs WHERE id = $1", [original.id])).rows[0])
      .toEqual({ status: "failed" });
    expect((await database.query("SELECT id FROM print_jobs")).rowCount).toBe(3);
  });

  it("permite al cajero consultar e imprimir comandas con sus permisos existentes", async () => {
    database = await createServiceFixture();
    const { accounts } = services(database);
    const { accountId, ticketId } = await createProductionIntent(accounts);
    const cashier = { ...actor, permissions: ["service.account.read", "service.round.send"] };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE).useValue(database)
      .overrideProvider(AuthService).useValue({ resolveToken: async () => cashier })
      .compile();
    const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix("api");
    try {
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      const headers = { authorization: "Bearer cashier-test-session" };
      const list = await app.inject({
        method: "GET", url: `/api/v1/accounts/${accountId}/production-tickets`, headers,
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().tickets).toMatchObject([{ id: ticketId, printStatus: "queued" }]);
      const printUrl = `/api/v1/production/tickets/${ticketId}/print`;
      expect((await app.inject({ method: "POST", url: printUrl, headers })).statusCode).toBe(400);
      const printed = await app.inject({
        method: "POST", url: printUrl,
        headers: { ...headers, "idempotency-key": "cashier-manual-print" },
      });
      expect(printed.statusCode).toBe(201);
      expect(printed.json()).toMatchObject({ ticketId, status: "queued", created: false });
      cashier.permissions = ["service.account.read"];
      expect((await app.inject({
        method: "POST", url: printUrl,
        headers: { ...headers, "idempotency-key": "not-allowed" },
      })).statusCode).toBe(403);
    } finally {
      await app.close();
      database = undefined;
    }
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
