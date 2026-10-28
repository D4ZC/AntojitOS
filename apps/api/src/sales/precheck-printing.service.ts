import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service.js";
import { DATABASE, type DatabasePort } from "../database/database.port.js";
import { IdempotencyService, requestHash } from "../idempotency/idempotency.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import type { AuthContext } from "../security/auth-context.js";

@Injectable()
export class PrecheckPrintingService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabasePort,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  print(precheckId: string, key: string, actor: AuthContext) {
    return this.idempotency.execute({
      siteId: actor.siteId, scope: `precheck.print:${precheckId}`, key,
      requestHash: requestHash({ precheckId }),
    }, async (transaction) => {
      const precheck = (await transaction.query<{ snapshot: Record<string, unknown> | string }>(
        `SELECT snapshot FROM account_prechecks WHERE id = $1 AND site_id = $2 FOR UPDATE`,
        [precheckId, actor.siteId],
      )).rows[0];
      if (!precheck) throw new NotFoundException("Precuenta inexistente");
      const original = (await transaction.query<{ id: string; status: string }>(
        "SELECT id, status FROM print_jobs WHERE precheck_id = $1 AND site_id = $2 FOR UPDATE",
        [precheckId, actor.siteId],
      )).rows[0];
      if (original?.status === "cancelled") throw new ConflictException("La impresión de esta precuenta está cancelada; genera otra precuenta");
      const created = !original;
      const requeued = original?.status === "failed";
      const jobId = original?.id ?? randomUUID();
      if (created) {
        const register = (await transaction.query<{ id: string }>(
          "SELECT id FROM cash_registers WHERE site_id = $1 AND active ORDER BY code LIMIT 1", [actor.siteId],
        )).rows[0];
        if (!register) throw new ConflictException("Configura una caja para imprimir la precuenta");
        const snapshot = typeof precheck.snapshot === "string" ? JSON.parse(precheck.snapshot) : precheck.snapshot;
        await transaction.query(
          `INSERT INTO print_jobs (id, site_id, precheck_id, register_id, kind, payload)
           VALUES ($1, $2, $3, $4, 'precheck', $5::jsonb)`,
          [jobId, actor.siteId, precheckId, register.id, JSON.stringify({ kind: "precheck", precheck: snapshot })],
        );
      } else if (requeued) {
        await transaction.query(
          `UPDATE print_jobs SET status = 'queued', available_at = now(),
             max_attempts = GREATEST(max_attempts, attempts + 5), claimed_by_agent_id = NULL,
             claim_token_hash = NULL, lease_expires_at = NULL, last_error = NULL,
             completed_at = NULL, updated_at = now() WHERE id = $1 AND site_id = $2`, [jobId, actor.siteId],
        );
      }
      const body = { jobId, precheckId, status: created || requeued ? "queued" : original!.status, created, requeued };
      if (created || requeued) {
        await this.audit.append(transaction, {
          id: randomUUID(), siteId: actor.siteId, actorUserId: actor.userId, terminalId: actor.terminalId,
          action: "account.precheck.print_requested", entityType: "account_precheck", entityId: precheckId, changes: body,
        });
        await this.outbox.enqueue(transaction, {
          id: randomUUID(), siteId: actor.siteId, eventType: "print.job.queued",
          aggregateType: "print_job", aggregateId: jobId, payload: body,
        });
      }
      return { status: created || requeued ? 201 : 200, body };
    });
  }
}
