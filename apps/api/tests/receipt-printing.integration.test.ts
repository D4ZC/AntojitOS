import { BadRequestException, ConflictException, NotFoundException, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterEach, describe, expect, it } from "vitest";
import { AccountsService } from "../src/accounts/accounts.service.js";
import { AppModule } from "../src/app.module.js";
import { AuditService } from "../src/audit/audit.service.js";
import { AuthService } from "../src/auth/auth.service.js";
import { CashService } from "../src/cash/cash.service.js";
import { DATABASE } from "../src/database/database.port.js";
import { IdempotencyService } from "../src/idempotency/idempotency.service.js";
import { OutboxService } from "../src/outbox/outbox.service.js";
import { ProductionService } from "../src/production/production.service.js";
import { SalesService } from "../src/sales/sales.service.js";
import type { AuthContext } from "../src/security/auth-context.js";
import { createServiceFixture, fixtureIds } from "./service-fixture.js";
import type { TestDatabase } from "./test-database.js";

const cashier: AuthContext = {
  sessionId: crypto.randomUUID(), siteId: fixtureIds.site, userId: fixtureIds.user,
  terminalId: fixtureIds.terminalOne, displayName: "Cajero",
  permissions: ["sales.payment.capture"],
};
const services = (database: TestDatabase) => {
  const audit = new AuditService();
  const idempotency = new IdempotencyService(database);
  const outbox = new OutboxService();
  const production = new ProductionService(database, audit, idempotency, outbox);
  const accounts = new AccountsService(database, audit, idempotency, outbox, production);
  const cash = new CashService(database, audit, idempotency, outbox);
  const sales = new SalesService(database, accounts, cash, audit, idempotency, outbox);
  return { production, accounts, cash, sales };
};
const prepare = async (database: TestDatabase) => {
  const all = services(database);
  await all.cash.openShift({ openingFloatInCents: 0 }, "print-cash", cashier);
  const account = await all.accounts.open({ serviceType: "quick", guestCount: 1, customerName: "Ana López" }, "print-account", cashier);
  await all.accounts.addItem(account.body.id, {
    productId: fixtureIds.product, quantity: 2, expectedVersion: 0,
    modifierIds: [fixtureIds.modifier], note: "Con todo, bien dorados",
  }, "print-item", cashier);
  await all.accounts.sendRound(account.body.id, { expectedVersion: 1 }, "print-round", cashier);
  await all.accounts.applyAdjustment(account.body.id, {
    expectedVersion: 2, kind: "discount", calculation: "fixed", value: 400, reason: "Promoción",
  }, "print-discount", cashier);
  const receipt = (await all.sales.checkout(account.body.id, {
    expectedVersion: 3,
    payments: [{ methodCode: "CASH", amountInCents: 2000, tipInCents: 300, tenderedInCents: 2500 }],
  }, "print-checkout", cashier)).body;
  return { ...all, receipt };
};
const registerCashPrinter = (production: ProductionService) => production.registerAgent({
  siteCode: "PILOT", code: "CASH-PRINT", displayName: "Bixolon caja", centerCodes: [], registerCodes: ["MAIN"],
});

let database: TestDatabase | undefined;
let app: NestFastifyApplication | undefined;
afterEach(async () => {
  if (app) await app.close();
  else await database?.close();
  app = undefined; database = undefined;
});

describe("impresión de tickets desde el POS", () => {
  it("reutiliza la impresión automática, conserva el snapshot completo y enruta sólo a caja", async () => {
    database = await createServiceFixture();
    const { production, sales, receipt } = await prepare(database);
    const original = await sales.receiptPrinting(receipt.id, cashier);
    expect(original).toMatchObject({
      receiptStatus: "issued", jobs: [{ kind: "receipt", status: "queued", attempts: 0 }],
      routing: { registerCode: "MAIN", configuredAgentCount: 0, onlineAgentCount: 0 },
    });
    const requested = await sales.printReceipt(receipt.id, "print-once", cashier);
    const again = await sales.printReceipt(receipt.id, "print-again", cashier);
    expect(requested.body).toMatchObject({ jobId: original.jobs[0]!.id, status: "queued", created: false, requeued: false });
    expect(again.body.jobId).toBe(requested.body.jobId);
    const agent = await registerCashPrinter(production);
    expect((await sales.receiptPrinting(receipt.id, cashier)).routing).toMatchObject({ configuredAgentCount: 1, onlineAgentCount: 0 });
    const claimed = await production.claimJob(agent.id, agent.token);
    expect(claimed.job).toMatchObject({ id: requested.body.jobId, kind: "receipt", receiptId: receipt.id });
    expect(claimed.job!.payload).toMatchObject({ receiptStatus: "issued", receipt: {
      account: { customerName: "Ana López", items: [{ note: "Con todo, bien dorados", modifiers: [{ name: "Extra" }] }],
        adjustments: [{ reason: "Promoción", appliedInCents: 400 }], totals: { discountInCents: 400 } },
      totals: { saleInCents: 2000, tipInCents: 300, changeInCents: 200 },
    } });
    expect(claimed.job!.payload.receipt).toEqual(receipt);
    expect((await sales.receiptPrinting(receipt.id, cashier)).routing.onlineAgentCount).toBe(1);
    await production.completeJob(claimed.job!.id, claimed.job!.claimToken, agent.id, agent.token);
    const completed = await sales.printReceipt(receipt.id, "already-sent", cashier);
    expect(completed.body).toMatchObject({ jobId: requested.body.jobId, status: "completed", created: false, requeued: false });
    expect((await production.claimJob(agent.id, agent.token)).job).toBeNull();
    // Kitchen production remains queued for its own agent, never for the cash printer.
    expect((await database.query("SELECT id FROM print_jobs WHERE kind = 'addition' AND status = 'queued'")).rowCount).toBe(1);
    await sales.reprintReceipt(receipt.id, { reason: "Copia del cliente" }, "explicit-copy", cashier);
    const copy = await production.claimJob(agent.id, agent.token);
    expect(copy.job).toMatchObject({ kind: "receipt_reprint", payload: { receipt, receiptStatus: "issued" } });
    expect((await database.query("SELECT id FROM sales_receipts")).rowCount).toBe(1);
    expect((await database.query("SELECT id FROM payments")).rowCount).toBe(1);
    expect((await sales.receiptPrinting(receipt.id, cashier)).jobs).toHaveLength(2);
  });

  it("recupera el mismo trabajo fallido y conserva los seis intentos sin cobrar otra vez", async () => {
    database = await createServiceFixture();
    const { production, sales, receipt } = await prepare(database);
    const agent = await registerCashPrinter(production);
    let originalId = "";
    for (let attempt = 1; attempt <= 5; attempt++) {
      await database.query("UPDATE print_jobs SET available_at = now() WHERE receipt_id = $1", [receipt.id]);
      const claimed = (await production.claimJob(agent.id, agent.token)).job!;
      originalId = claimed.id;
      expect(claimed.attempt).toBe(attempt);
      await production.failJob(claimed.id, claimed.claimToken, "Impresora desconectada", agent.id, agent.token);
    }
    expect((await sales.receiptPrinting(receipt.id, cashier)).jobs[0]).toMatchObject({
      id: originalId, status: "failed", attempts: 5, maxAttempts: 5, lastError: "Impresora desconectada",
    });
    const recovered = await sales.printReceipt(receipt.id, "recover-failed", cashier);
    expect(recovered.body).toMatchObject({ jobId: originalId, status: "queued", created: false, requeued: true });
    expect((await sales.printReceipt(receipt.id, "recover-failed", cashier)).replayed).toBe(true);
    expect((await sales.printReceipt(receipt.id, "recover-again", cashier)).body.requeued).toBe(false);
    expect((await sales.receiptPrinting(receipt.id, cashier)).jobs[0]).toMatchObject({ attempts: 5, maxAttempts: 10 });
    const sixth = (await production.claimJob(agent.id, agent.token)).job!;
    expect(sixth).toMatchObject({ id: originalId, attempt: 6, payload: { receipt } });
    await production.completeJob(sixth.id, sixth.claimToken, agent.id, agent.token);
    expect((await database.query("SELECT id FROM print_job_attempts WHERE job_id = $1", [originalId])).rowCount).toBe(6);
    expect((await database.query("SELECT id FROM audit_events WHERE action = 'sales.receipt.print_recovered'")).rowCount).toBe(1);
    expect((await database.query("SELECT id FROM print_jobs WHERE receipt_id = $1", [receipt.id])).rowCount).toBe(1);
    expect((await database.query("SELECT id FROM payments")).rowCount).toBe(1);
  });

  it("mantiene la concesión del agente y deja que el mecanismo existente recupere su vencimiento", async () => {
    database = await createServiceFixture();
    const { production, sales, receipt } = await prepare(database);
    const agent = await registerCashPrinter(production);
    const first = (await production.claimJob(agent.id, agent.token)).job!;
    await database.query("UPDATE print_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1", [first.id]);
    expect((await sales.printReceipt(receipt.id, "do-not-duplicate-lease", cashier)).body).toMatchObject({
      jobId: first.id, status: "claimed", created: false, requeued: false,
    });
    const next = (await production.claimJob(agent.id, agent.token)).job!;
    expect(next).toMatchObject({ id: first.id, attempt: 2 });
    await expect(production.completeJob(first.id, first.claimToken, agent.id, agent.token)).rejects.toBeInstanceOf(ConflictException);
    await production.completeJob(next.id, next.claimToken, agent.id, agent.token);
    expect((await database.query("SELECT id FROM print_jobs WHERE receipt_id = $1", [receipt.id])).rowCount).toBe(1);
  });

  it.each(["cancellation", "refund"] as const)("rotula %s al reimprimir y recuperar, sin cambiar el snapshot vendido", async (kind) => {
    database = await createServiceFixture();
    const { sales, receipt } = await prepare(database);
    await sales.refundReceipt(receipt.id, { kind, reason: "Corrección de venta" }, "change-receipt-status", cashier);
    const expectedStatus = kind === "cancellation" ? "cancelled" : "refunded";
    expect(await sales.getReceipt(receipt.id, cashier)).toMatchObject({ status: expectedStatus });
    expect((await sales.receiptPrinting(receipt.id, cashier)).receiptStatus).toBe(expectedStatus);
    await sales.reprintReceipt(receipt.id, { reason: "Copia de la corrección" }, "corrected-copy", cashier);
    await database.query("UPDATE print_jobs SET status = 'failed' WHERE receipt_id = $1 AND kind = 'receipt'", [receipt.id]);
    await sales.printReceipt(receipt.id, "recover-corrected", cashier);
    const jobs = await database.query<{ payload: { receiptStatus: string; receipt: unknown } }>(
      "SELECT payload FROM print_jobs WHERE receipt_id = $1 ORDER BY created_at", [receipt.id],
    );
    expect(jobs.rows).toHaveLength(2);
    for (const job of jobs.rows) {
      expect(job.payload.receiptStatus).toBe(expectedStatus);
      expect(job.payload.receipt).toEqual(receipt);
    }
    expect((await database.query<{ snapshot: unknown }>("SELECT snapshot FROM sales_receipts WHERE id = $1", [receipt.id])).rows[0]?.snapshot).toEqual(receipt);
    await expect(sales.reprintReceipt(receipt.id, { reason: " " }, "empty-reason", cashier)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("crea una sola impresión original ausente aunque dos solicitudes compitan", async () => {
    database = await createServiceFixture();
    const { sales, receipt } = await prepare(database);
    await database.query("DELETE FROM print_jobs WHERE receipt_id = $1 AND kind = 'receipt'", [receipt.id]);
    const results = await Promise.all([
      sales.printReceipt(receipt.id, "missing-one", cashier), sales.printReceipt(receipt.id, "missing-two", cashier),
    ]);
    expect(results[0]!.body.jobId).toBe(results[1]!.body.jobId);
    expect(results.filter((result) => result.body.created)).toHaveLength(1);
    expect((await database.query("SELECT id FROM print_jobs WHERE receipt_id = $1", [receipt.id])).rowCount).toBe(1);
    expect((await database.query("SELECT id FROM sales_receipts")).rowCount).toBe(1);
  });

  it("protege estado y recuperación con permiso de cajero, mantiene reimpresión separada y aísla sucursales", async () => {
    database = await createServiceFixture();
    const { sales, receipt } = await prepare(database);
    const otherSite = crypto.randomUUID();
    await database.query("INSERT INTO sites (id, code, name) VALUES ($1, 'OTHER', 'Otra')", [otherSite]);
    await expect(sales.receiptPrinting(receipt.id, { ...cashier, siteId: otherSite })).rejects.toBeInstanceOf(NotFoundException);
    await expect(sales.printReceipt(receipt.id, "foreign-ticket", { ...cashier, siteId: otherSite })).rejects.toBeInstanceOf(NotFoundException);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE).useValue(database)
      .overrideProvider(AuthService).useValue({ resolveToken: async (token: string) => {
        if (token === "cashier") return cashier;
        if (token === "restricted") return { ...cashier, permissions: [] };
        throw new UnauthorizedException();
      } }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    const base = `/v1/sales/receipts/${receipt.id}`;
    for (const [method, url] of [["GET", `${base}/printing`], ["POST", `${base}/print`]] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(401);
      expect((await app.inject({ method, url, headers: { authorization: "Bearer restricted" } })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: "GET", url: `${base}/printing`, headers: { authorization: "Bearer cashier" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `${base}/print`, headers: { authorization: "Bearer cashier" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `${base}/print`, headers: { authorization: "Bearer cashier", "idempotency-key": "http-original" }, payload: {} })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `${base}/reprints`, headers: { authorization: "Bearer cashier", "idempotency-key": "http-copy" }, payload: { reason: "Copia" } })).statusCode).toBe(403);
    const registered = await app.inject({ method: "POST", url: "/v1/production-agents/register",
      headers: { "x-bootstrap-token": process.env.BOOTSTRAP_TOKEN ?? "development-bootstrap-token" },
      payload: { siteCode: "PILOT", code: "HTTP-CASH", displayName: "Sólo caja", centerCodes: [], registerCodes: ["MAIN"] } });
    expect(registered.statusCode).toBe(201);
    const noRoute = await app.inject({ method: "POST", url: "/v1/production-agents/register",
      headers: { "x-bootstrap-token": process.env.BOOTSTRAP_TOKEN ?? "development-bootstrap-token" },
      payload: { siteCode: "PILOT", code: "HTTP-NONE", displayName: "Sin destinos", centerCodes: [], registerCodes: [] } });
    expect(noRoute.statusCode).toBe(400);
  });
});
