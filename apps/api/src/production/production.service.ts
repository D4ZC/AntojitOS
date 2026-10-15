import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service.js";
import {
  DATABASE,
  type DatabasePort,
  type DatabaseRow,
  type DatabaseSession,
} from "../database/database.port.js";
import {
  IdempotencyService,
  requestHash,
} from "../idempotency/idempotency.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import type { AuthContext } from "../security/auth-context.js";
import {
  createOpaqueToken,
  hashDeviceToken,
  safeTokenMatches,
} from "../security/token.js";
import type { RegisterProductionAgentDto } from "./dto/register-production-agent.dto.js";
import type { ReprintTicketDto } from "./dto/reprint-ticket.dto.js";
import type { TransitionTicketDto } from "./dto/transition-ticket.dto.js";

interface RoutedItemRow extends DatabaseRow {
  item_id: string;
  product_name: string;
  quantity: number;
  note: string | null;
  production_center_id: string | null;
  center_code: string | null;
  center_name: string | null;
  modifier_name: string | null;
}

interface ServiceContextRow extends DatabaseRow {
  service_type: "table" | "quick" | "takeaway";
  table_name: string | null;
  reference: string | null;
}

interface CancellationItemRow extends RoutedItemRow {
  round_sequence: number;
}

interface TicketRow extends DatabaseRow {
  id: string;
  account_id: string;
  round_id: string;
  production_center_id: string;
  center_code: string;
  center_name: string;
  kind: "addition" | "cancellation";
  round_sequence: number;
  status: "pending" | "in_progress" | "ready" | "delivered" | "cancelled";
  version: number;
  service_type: "table" | "quick" | "takeaway";
  table_name: string | null;
  reference: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  ready_at: Date | string | null;
}

interface TicketItemRow extends DatabaseRow {
  ticket_id: string;
  id: string;
  order_item_id: string | null;
  product_name: string;
  quantity: number;
  note: string | null;
  modifiers: unknown;
}

interface AgentRow extends DatabaseRow {
  id: string;
  site_id: string;
  token_hash: string;
  status: "active" | "disabled";
}

interface PrintJobRow extends DatabaseRow {
  id: string;
  site_id: string;
  ticket_id: string | null;
  receipt_id: string | null;
  shift_close_id: string | null;
  kind:
    | "addition"
    | "cancellation"
    | "reprint"
    | "receipt"
    | "receipt_reprint"
    | "shift_close";
  status: "queued" | "claimed" | "completed" | "failed" | "cancelled";
  payload: Record<string, unknown> | string;
  attempts: number;
  max_attempts: number;
  claimed_by_agent_id: string | null;
  claim_token_hash: string | null;
  lease_expires_at: Date | string | null;
}

interface PlannedItem {
  id: string;
  productName: string;
  quantity: number;
  note: string | null;
  modifiers: string[];
}

interface PlannedCenter {
  id: string;
  code: string;
  name: string;
  items: Map<string, PlannedItem>;
}

const asDate = (value: Date | string): string => new Date(value).toISOString();

const parseJson = <Value>(value: Value | string): Value =>
  typeof value === "string" ? JSON.parse(value) as Value : value;

@Injectable()
export class ProductionService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabasePort,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  async planRound(
    transaction: DatabaseSession,
    input: {
      siteId: string;
      accountId: string;
      roundId: string;
      roundSequence: number;
    },
  ): Promise<Array<{ ticketId: string; centerId: string; jobId: string }>> {
    const [contextResult, routedResult] = await Promise.all([
      transaction.query<ServiceContextRow>(
        `SELECT accounts.service_type, accounts.reference, tables.name AS table_name
           FROM service_accounts accounts
           LEFT JOIN service_tables tables ON tables.id = accounts.table_id
          WHERE accounts.id = $1 AND accounts.site_id = $2`,
        [input.accountId, input.siteId],
      ),
      transaction.query<RoutedItemRow>(
        `SELECT
           items.id AS item_id, items.product_name, items.quantity, items.note,
           items.production_center_id, centers.code AS center_code,
           centers.name AS center_name, modifiers.modifier_name
         FROM order_items items
         LEFT JOIN production_centers centers
           ON centers.id = items.production_center_id AND centers.active
         LEFT JOIN order_item_modifiers modifiers
           ON modifiers.order_item_id = items.id
         WHERE items.round_id = $1 AND items.site_id = $2
         ORDER BY items.created_at, items.id, modifiers.id`,
        [input.roundId, input.siteId],
      ),
    ]);
    const context = contextResult.rows[0];
    if (!context) throw new NotFoundException("Cuenta inexistente");
    if (routedResult.rows.length === 0) {
      throw new ConflictException("La ronda no contiene artículos");
    }

    const centers = new Map<string, PlannedCenter>();
    for (const row of routedResult.rows) {
      if (!row.production_center_id || !row.center_code || !row.center_name) {
        throw new BadRequestException(
          `El producto ${row.product_name} no tiene un centro de producción activo`,
        );
      }
      const center = centers.get(row.production_center_id) ?? {
        id: row.production_center_id,
        code: row.center_code,
        name: row.center_name,
        items: new Map<string, PlannedItem>(),
      };
      const item = center.items.get(row.item_id) ?? {
        id: row.item_id,
        productName: row.product_name,
        quantity: row.quantity,
        note: row.note,
        modifiers: [],
      };
      if (row.modifier_name) item.modifiers.push(row.modifier_name);
      center.items.set(row.item_id, item);
      centers.set(row.production_center_id, center);
    }

    const serviceLabel = context.table_name ?? context.reference ?? (
      context.service_type === "takeaway" ? "Para llevar" : "Venta rápida"
    );
    const planned: Array<{ ticketId: string; centerId: string; jobId: string }> = [];

    for (const center of centers.values()) {
      const ticketId = randomUUID();
      const jobId = randomUUID();
      const items = [...center.items.values()];
      const payload = {
        ticketId,
        kind: "addition",
        center: { id: center.id, code: center.code, name: center.name },
        service: {
          accountId: input.accountId,
          type: context.service_type,
          label: serviceLabel,
        },
        roundSequence: input.roundSequence,
        items: items.map((item) => ({
          productName: item.productName,
          quantity: item.quantity,
          note: item.note,
          modifiers: item.modifiers,
        })),
      };
      await transaction.query(
        `INSERT INTO production_tickets (
          id, site_id, account_id, round_id, production_center_id,
          kind, round_sequence
        ) VALUES ($1, $2, $3, $4, $5, 'addition', $6)`,
        [ticketId, input.siteId, input.accountId, input.roundId, center.id, input.roundSequence],
      );
      for (const item of items) {
        await transaction.query(
          `INSERT INTO production_ticket_items (
            id, site_id, ticket_id, order_item_id, product_name,
            quantity, note, modifiers
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
          [
            randomUUID(),
            input.siteId,
            ticketId,
            item.id,
            item.productName,
            item.quantity,
            item.note,
            JSON.stringify(item.modifiers),
          ],
        );
      }
      await transaction.query(
        `INSERT INTO print_jobs (id, site_id, ticket_id, kind, payload)
         VALUES ($1, $2, $3, 'addition', $4::jsonb)`,
        [jobId, input.siteId, ticketId, JSON.stringify(payload)],
      );
      await this.outbox.enqueue(transaction, {
        id: randomUUID(),
        siteId: input.siteId,
        eventType: "production.ticket.created",
        aggregateType: "production_ticket",
        aggregateId: ticketId,
        payload,
      });
      planned.push({ ticketId, centerId: center.id, jobId });
    }

    return planned;
  }

  async planCancellation(
    transaction: DatabaseSession,
    input: {
      siteId: string;
      accountId: string;
      roundId: string;
      itemId: string;
      reason: string;
    },
  ): Promise<{ ticketId: string; centerId: string; jobId: string }> {
    const [contextResult, itemResult] = await Promise.all([
      transaction.query<ServiceContextRow>(
        `SELECT accounts.service_type, accounts.reference, tables.name AS table_name
           FROM service_accounts accounts
           LEFT JOIN service_tables tables ON tables.id = accounts.table_id
          WHERE accounts.id = $1 AND accounts.site_id = $2`,
        [input.accountId, input.siteId],
      ),
      transaction.query<CancellationItemRow>(
        `SELECT
           items.id AS item_id, items.product_name, items.quantity, items.note,
           items.production_center_id, centers.code AS center_code,
           centers.name AS center_name, modifiers.modifier_name,
           rounds.sequence AS round_sequence
         FROM order_items items
         JOIN order_rounds rounds ON rounds.id = items.round_id
         LEFT JOIN production_centers centers
           ON centers.id = items.production_center_id AND centers.active
         LEFT JOIN order_item_modifiers modifiers
           ON modifiers.order_item_id = items.id
         WHERE items.id = $1 AND items.account_id = $2
           AND items.round_id = $3 AND items.site_id = $4
         ORDER BY modifiers.id`,
        [input.itemId, input.accountId, input.roundId, input.siteId],
      ),
    ]);
    const context = contextResult.rows[0];
    const first = itemResult.rows[0];
    if (!context || !first) throw new NotFoundException("Artículo enviado inexistente");
    if (!first.production_center_id || !first.center_code || !first.center_name) {
      throw new BadRequestException(
        `El producto ${first.product_name} no tiene un centro de producción activo`,
      );
    }
    const modifiers = itemResult.rows
      .map((row) => row.modifier_name)
      .filter((name): name is string => Boolean(name));
    const serviceLabel = context.table_name ?? context.reference ?? (
      context.service_type === "takeaway" ? "Para llevar" : "Venta rápida"
    );
    const ticketId = randomUUID();
    const jobId = randomUUID();
    const payload = {
      ticketId,
      kind: "cancellation",
      center: {
        id: first.production_center_id,
        code: first.center_code,
        name: first.center_name,
      },
      service: {
        accountId: input.accountId,
        type: context.service_type,
        label: serviceLabel,
      },
      roundSequence: first.round_sequence,
      cancellationReason: input.reason,
      items: [{
        productName: first.product_name,
        quantity: first.quantity,
        note: first.note,
        modifiers,
      }],
    };
    await transaction.query(
      `INSERT INTO production_tickets (
        id, site_id, account_id, round_id, production_center_id,
        kind, round_sequence
      ) VALUES ($1, $2, $3, $4, $5, 'cancellation', $6)`,
      [
        ticketId,
        input.siteId,
        input.accountId,
        input.roundId,
        first.production_center_id,
        first.round_sequence,
      ],
    );
    await transaction.query(
      `INSERT INTO production_ticket_items (
        id, site_id, ticket_id, order_item_id, product_name,
        quantity, note, modifiers
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        randomUUID(),
        input.siteId,
        ticketId,
        input.itemId,
        first.product_name,
        first.quantity,
        input.reason,
        JSON.stringify(modifiers),
      ],
    );
    await transaction.query(
      `INSERT INTO print_jobs (id, site_id, ticket_id, kind, payload)
       VALUES ($1, $2, $3, 'cancellation', $4::jsonb)`,
      [jobId, input.siteId, ticketId, JSON.stringify(payload)],
    );
    await this.outbox.enqueue(transaction, {
      id: randomUUID(),
      siteId: input.siteId,
      eventType: "production.ticket.created",
      aggregateType: "production_ticket",
      aggregateId: ticketId,
      payload,
    });
    return { ticketId, centerId: first.production_center_id, jobId };
  }

  async listTickets(siteId: string) {
    const [ticketsResult, itemsResult] = await Promise.all([
      this.database.query<TicketRow>(
        `SELECT
           tickets.id, tickets.account_id, tickets.round_id,
           tickets.production_center_id, centers.code AS center_code,
           centers.name AS center_name, tickets.kind, tickets.round_sequence,
           tickets.status, tickets.version, accounts.service_type,
           accounts.reference, tables.name AS table_name, tickets.created_at,
           tickets.started_at, tickets.ready_at
         FROM production_tickets tickets
         JOIN production_centers centers ON centers.id = tickets.production_center_id
         JOIN service_accounts accounts ON accounts.id = tickets.account_id
         LEFT JOIN service_tables tables ON tables.id = accounts.table_id
         WHERE tickets.site_id = $1 AND tickets.status <> 'delivered'
         ORDER BY tickets.created_at, tickets.id`,
        [siteId],
      ),
      this.database.query<TicketItemRow>(
        `SELECT
           items.ticket_id, items.id, items.order_item_id, items.product_name,
           items.quantity, items.note, items.modifiers
         FROM production_ticket_items items
         JOIN production_tickets tickets ON tickets.id = items.ticket_id
         WHERE tickets.site_id = $1 AND tickets.status <> 'delivered'
         ORDER BY items.id`,
        [siteId],
      ),
    ]);

    return {
      tickets: ticketsResult.rows.map((ticket) => ({
        id: ticket.id,
        accountId: ticket.account_id,
        roundId: ticket.round_id,
        center: {
          id: ticket.production_center_id,
          code: ticket.center_code,
          name: ticket.center_name,
        },
        kind: ticket.kind,
        roundSequence: ticket.round_sequence,
        status: ticket.status,
        version: ticket.version,
        service: {
          type: ticket.service_type,
          label: ticket.table_name ?? ticket.reference ?? (
            ticket.service_type === "takeaway" ? "Para llevar" : "Venta rápida"
          ),
        },
        createdAt: asDate(ticket.created_at),
        startedAt: ticket.started_at ? asDate(ticket.started_at) : null,
        readyAt: ticket.ready_at ? asDate(ticket.ready_at) : null,
        items: itemsResult.rows
          .filter((item) => item.ticket_id === ticket.id)
          .map((item) => ({
            id: item.id,
            orderItemId: item.order_item_id,
            productName: item.product_name,
            quantity: item.quantity,
            note: item.note,
            modifiers: parseJson<string[]>(item.modifiers as string | string[]),
          })),
      })),
    };
  }

  transition(
    ticketId: string,
    input: TransitionTicketDto,
    key: string,
    actor: AuthContext,
  ) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: `production.ticket.transition:${ticketId}`,
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        const result = await transaction.query<TicketRow>(
          `SELECT id, status, version
             FROM production_tickets
            WHERE id = $1 AND site_id = $2 AND version = $3
            FOR UPDATE`,
          [ticketId, actor.siteId, input.expectedVersion],
        );
        const ticket = result.rows[0];
        if (!ticket) throw new ConflictException("La comanda cambió en otra terminal");
        const allowed: Record<string, string> = {
          pending: "in_progress",
          in_progress: "ready",
          ready: "delivered",
        };
        if (allowed[ticket.status] !== input.status) {
          throw new ConflictException(
            `No se puede cambiar una comanda ${ticket.status} a ${input.status}`,
          );
        }
        const nextVersion = ticket.version + 1;
        await transaction.query(
          `UPDATE production_tickets
              SET status = $3, version = $4, updated_at = now(),
                  started_at = CASE WHEN $3 = 'in_progress' THEN now() ELSE started_at END,
                  ready_at = CASE WHEN $3 = 'ready' THEN now() ELSE ready_at END,
                  delivered_at = CASE WHEN $3 = 'delivered' THEN now() ELSE delivered_at END
            WHERE id = $1 AND site_id = $2`,
          [ticketId, actor.siteId, input.status, nextVersion],
        );
        const body = { ticketId, status: input.status, version: nextVersion };
        await this.audit.append(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          actorUserId: actor.userId,
          terminalId: actor.terminalId,
          action: "production.ticket.transitioned",
          entityType: "production_ticket",
          entityId: ticketId,
          changes: body,
        });
        await this.outbox.enqueue(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          eventType: "production.ticket.updated",
          aggregateType: "production_ticket",
          aggregateId: ticketId,
          payload: body,
        });
        return { status: 200, body };
      },
    );
  }

  reprint(
    ticketId: string,
    input: ReprintTicketDto,
    key: string,
    actor: AuthContext,
  ) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: `production.ticket.reprint:${ticketId}`,
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        const originalResult = await transaction.query<PrintJobRow>(
          `SELECT jobs.*
             FROM print_jobs jobs
             JOIN production_tickets tickets ON tickets.id = jobs.ticket_id
            WHERE jobs.ticket_id = $1 AND jobs.site_id = $2
              AND jobs.kind IN ('addition', 'cancellation')
            ORDER BY jobs.created_at
            LIMIT 1
            FOR UPDATE`,
          [ticketId, actor.siteId],
        );
        const original = originalResult.rows[0];
        if (!original) throw new NotFoundException("Comanda imprimible inexistente");
        const jobId = randomUUID();
        const payload = {
          ...parseJson<Record<string, unknown>>(original.payload),
          kind: "reprint",
          reprint: { reason: input.reason, requestedBy: actor.displayName },
        };
        await transaction.query(
          `INSERT INTO print_jobs (
            id, site_id, ticket_id, kind, original_job_id, payload
          ) VALUES ($1, $2, $3, 'reprint', $4, $5::jsonb)`,
          [jobId, actor.siteId, ticketId, original.id, JSON.stringify(payload)],
        );
        await this.audit.append(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          actorUserId: actor.userId,
          terminalId: actor.terminalId,
          action: "production.ticket.reprint_requested",
          entityType: "production_ticket",
          entityId: ticketId,
          reason: input.reason,
          changes: { jobId, originalJobId: original.id },
        });
        await this.outbox.enqueue(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          eventType: "print.job.queued",
          aggregateType: "print_job",
          aggregateId: jobId,
          payload: { jobId, ticketId, kind: "reprint" },
        });
        return { status: 201, body: { jobId, ticketId } };
      },
    );
  }

  async registerAgent(input: RegisterProductionAgentDto) {
    const token = createOpaqueToken();
    const agentId = randomUUID();
    return this.database.transaction(async (transaction) => {
      const siteResult = await transaction.query<{ id: string }>(
        "SELECT id FROM sites WHERE code = $1",
        [input.siteCode],
      );
      const siteId = siteResult.rows[0]?.id;
      if (!siteId) throw new NotFoundException("Sucursal inexistente");
      const centersResult = await transaction.query<{ id: string; code: string }>(
        `SELECT id, code FROM production_centers
          WHERE site_id = $1 AND code = ANY($2::text[]) AND active`,
        [siteId, [...new Set(input.centerCodes)]],
      );
      if (centersResult.rows.length !== new Set(input.centerCodes).size) {
        throw new BadRequestException("Uno o más centros de producción no existen");
      }
      const registerCodes = [...new Set(input.registerCodes ?? [])];
      const registersResult = await transaction.query<{ id: string; code: string }>(
        `SELECT id, code FROM cash_registers
          WHERE site_id = $1 AND code = ANY($2::text[]) AND active`,
        [siteId, registerCodes],
      );
      if (registersResult.rows.length !== registerCodes.length) {
        throw new BadRequestException("Una o más cajas no existen");
      }
      try {
        await transaction.query(
          `INSERT INTO production_agents (
            id, site_id, code, display_name, token_hash
          ) VALUES ($1, $2, $3, $4, $5)`,
          [agentId, siteId, input.code, input.displayName, hashDeviceToken(token)],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new ConflictException("El código de agente ya está registrado");
        }
        throw error;
      }
      for (const center of centersResult.rows) {
        await transaction.query(
          `INSERT INTO production_agent_centers (agent_id, production_center_id)
           VALUES ($1, $2)`,
          [agentId, center.id],
        );
      }
      for (const register of registersResult.rows) {
        await transaction.query(
          `INSERT INTO production_agent_registers (agent_id, register_id)
           VALUES ($1, $2)`,
          [agentId, register.id],
        );
      }
      await this.audit.append(transaction, {
        id: randomUUID(),
        siteId,
        action: "production.agent.registered",
        entityType: "production_agent",
        entityId: agentId,
        changes: {
          code: input.code,
          centerCodes: input.centerCodes,
          registerCodes,
        },
      });
      return {
        id: agentId,
        code: input.code,
        displayName: input.displayName,
        centerCodes: input.centerCodes,
        registerCodes,
        token,
      };
    });
  }

  async claimJob(agentId: string | undefined, token: string | undefined) {
    return this.database.transaction(async (transaction) => {
      const agent = await this.resolveAgent(transaction, agentId, token);
      await transaction.query(
        `UPDATE print_job_attempts attempts
            SET status = 'lease_expired', finished_at = now(),
                error = 'La concesión expiró sin confirmación'
          WHERE attempts.status = 'claimed'
            AND EXISTS (
              SELECT 1 FROM print_jobs jobs
               WHERE jobs.id = attempts.job_id
                 AND jobs.status = 'claimed'
                 AND jobs.lease_expires_at < now()
            )`,
      );
      await transaction.query(
        `UPDATE print_jobs
            SET status = CASE
                  WHEN attempts >= max_attempts THEN 'failed'
                  ELSE 'queued'
                END,
                claimed_by_agent_id = NULL,
                claim_token_hash = NULL, lease_expires_at = NULL,
                available_at = now(), updated_at = now(),
                last_error = 'La concesión anterior expiró'
          WHERE status = 'claimed' AND lease_expires_at < now()`,
      );
      const candidateResult = await transaction.query<PrintJobRow>(
        `SELECT jobs.*
           FROM print_jobs jobs
           LEFT JOIN production_tickets tickets ON tickets.id = jobs.ticket_id
           LEFT JOIN production_agent_centers center_assignments
             ON center_assignments.production_center_id = tickets.production_center_id
            AND center_assignments.agent_id = $2
           LEFT JOIN sales_receipts receipts ON receipts.id = jobs.receipt_id
           LEFT JOIN cash_shifts receipt_shifts ON receipt_shifts.id = receipts.shift_id
           LEFT JOIN cash_shift_closes closes ON closes.id = jobs.shift_close_id
           LEFT JOIN cash_shifts close_shifts ON close_shifts.id = closes.shift_id
           LEFT JOIN production_agent_registers register_assignments
             ON register_assignments.agent_id = $2
            AND register_assignments.register_id = COALESCE(
              receipt_shifts.register_id,
              close_shifts.register_id
            )
          WHERE jobs.site_id = $1
            AND jobs.status = 'queued' AND jobs.available_at <= now()
            AND jobs.attempts < jobs.max_attempts
            AND (
              (jobs.ticket_id IS NOT NULL AND center_assignments.agent_id IS NOT NULL)
              OR
              ((jobs.receipt_id IS NOT NULL OR jobs.shift_close_id IS NOT NULL)
                AND register_assignments.agent_id IS NOT NULL)
            )
          ORDER BY jobs.created_at, jobs.id
          LIMIT 1
          FOR UPDATE OF jobs SKIP LOCKED`,
        [agent.site_id, agent.id],
      );
      const job = candidateResult.rows[0];
      await transaction.query(
        "UPDATE production_agents SET last_seen_at = now() WHERE id = $1",
        [agent.id],
      );
      if (!job) return { job: null };

      const claimToken = createOpaqueToken();
      const attemptNumber = job.attempts + 1;
      await transaction.query(
        `UPDATE print_jobs
            SET status = 'claimed', attempts = $2, claimed_by_agent_id = $3,
                claim_token_hash = $4, lease_expires_at = now() + interval '30 seconds',
                updated_at = now(), last_error = NULL
          WHERE id = $1`,
        [job.id, attemptNumber, agent.id, hashDeviceToken(claimToken)],
      );
      await transaction.query(
        `INSERT INTO print_job_attempts (
          id, site_id, job_id, agent_id, attempt_number, status
        ) VALUES ($1, $2, $3, $4, $5, 'claimed')`,
        [randomUUID(), agent.site_id, job.id, agent.id, attemptNumber],
      );
      return {
        job: {
          id: job.id,
          ticketId: job.ticket_id,
          receiptId: job.receipt_id,
          shiftCloseId: job.shift_close_id,
          kind: job.kind,
          attempt: attemptNumber,
          claimToken,
          payload: parseJson<Record<string, unknown>>(job.payload),
        },
      };
    });
  }

  async completeJob(
    jobId: string,
    claimToken: string,
    agentId: string | undefined,
    token: string | undefined,
  ) {
    return this.database.transaction(async (transaction) => {
      const agent = await this.resolveAgent(transaction, agentId, token);
      const job = await this.lockClaimedJob(transaction, jobId, claimToken, agent);
      await transaction.query(
        `UPDATE print_jobs
            SET status = 'completed', completed_at = now(), updated_at = now(),
                lease_expires_at = NULL, claim_token_hash = NULL, last_error = NULL
          WHERE id = $1`,
        [job.id],
      );
      await transaction.query(
        `UPDATE print_job_attempts
            SET status = 'completed', finished_at = now()
          WHERE job_id = $1 AND attempt_number = $2`,
        [job.id, job.attempts],
      );
      await this.outbox.enqueue(transaction, {
        id: randomUUID(),
        siteId: agent.site_id,
        eventType: "print.job.completed",
        aggregateType: "print_job",
        aggregateId: job.id,
        payload: { jobId: job.id, ticketId: job.ticket_id, attempt: job.attempts },
      });
      return { jobId: job.id, status: "completed" };
    });
  }

  async failJob(
    jobId: string,
    claimToken: string,
    failure: string,
    agentId: string | undefined,
    token: string | undefined,
  ) {
    return this.database.transaction(async (transaction) => {
      const agent = await this.resolveAgent(transaction, agentId, token);
      const job = await this.lockClaimedJob(transaction, jobId, claimToken, agent);
      const permanent = job.attempts >= job.max_attempts;
      const nextStatus = permanent ? "failed" : "queued";
      await transaction.query(
        `UPDATE print_jobs
            SET status = $2, available_at = now() + interval '5 seconds',
                claimed_by_agent_id = NULL, claim_token_hash = NULL,
                lease_expires_at = NULL, last_error = $3, updated_at = now()
          WHERE id = $1`,
        [job.id, nextStatus, failure],
      );
      await transaction.query(
        `UPDATE print_job_attempts
            SET status = 'failed', finished_at = now(), error = $3
          WHERE job_id = $1 AND attempt_number = $2`,
        [job.id, job.attempts, failure],
      );
      await this.outbox.enqueue(transaction, {
        id: randomUUID(),
        siteId: agent.site_id,
        eventType: permanent ? "print.job.failed" : "print.job.retry_scheduled",
        aggregateType: "print_job",
        aggregateId: job.id,
        payload: {
          jobId: job.id,
          ticketId: job.ticket_id,
          attempt: job.attempts,
          error: failure,
        },
      });
      return { jobId: job.id, status: nextStatus, willRetry: !permanent };
    });
  }

  private async resolveAgent(
    transaction: DatabaseSession,
    agentId: string | undefined,
    token: string | undefined,
  ): Promise<AgentRow> {
    if (!agentId || !token) throw new UnauthorizedException("Agente no autorizado");
    const result = await transaction.query<AgentRow>(
      `SELECT id, site_id, token_hash, status
         FROM production_agents WHERE id = $1`,
      [agentId],
    );
    const agent = result.rows[0];
    if (
      !agent ||
      agent.status !== "active" ||
      !safeTokenMatches(hashDeviceToken(token), agent.token_hash)
    ) {
      throw new UnauthorizedException("Agente no autorizado");
    }
    return agent;
  }

  private async lockClaimedJob(
    transaction: DatabaseSession,
    jobId: string,
    claimToken: string,
    agent: AgentRow,
  ): Promise<PrintJobRow> {
    const result = await transaction.query<PrintJobRow>(
      "SELECT * FROM print_jobs WHERE id = $1 AND site_id = $2 FOR UPDATE",
      [jobId, agent.site_id],
    );
    const job = result.rows[0];
    if (
      !job ||
      job.status !== "claimed" ||
      job.claimed_by_agent_id !== agent.id ||
      !job.claim_token_hash ||
      !safeTokenMatches(hashDeviceToken(claimToken), job.claim_token_hash)
    ) {
      throw new ConflictException("La concesión del trabajo ya no es válida");
    }
    if (!job.lease_expires_at || new Date(job.lease_expires_at).getTime() < Date.now()) {
      throw new ConflictException("La concesión del trabajo expiró");
    }
    return job;
  }
}
