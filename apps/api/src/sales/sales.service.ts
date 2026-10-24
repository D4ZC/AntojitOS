import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AccountsService } from "../accounts/accounts.service.js";
import { AuditService } from "../audit/audit.service.js";
import { CashService } from "../cash/cash.service.js";
import {
  DATABASE,
  type DatabasePort,
  type DatabaseRow,
  type DatabaseSession,
} from "../database/database.port.js";
import { IdempotencyService, requestHash } from "../idempotency/idempotency.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import type { AuthContext } from "../security/auth-context.js";
import type {
  CheckoutAccountDto,
  CheckoutTenderDto,
} from "./dto/checkout-account.dto.js";
import type { RefundReceiptDto } from "./dto/refund-receipt.dto.js";
import type { ReprintReceiptDto } from "./dto/reprint-receipt.dto.js";

interface PaymentMethodRow extends DatabaseRow {
  id: string;
  code: "CASH" | "CARD" | "TRANSFER";
  name: string;
  supports_change: boolean;
  requires_reference: boolean;
  display_order: number;
}

interface AccountLockRow extends DatabaseRow {
  id: string;
  table_id: string | null;
  version: number;
  account_group_id: string;
  is_primary: boolean;
}

interface SequenceRow extends DatabaseRow {
  value: number | string;
}

interface ReceiptRow extends DatabaseRow {
  snapshot: Record<string, unknown> | string;
  status: "issued" | "cancelled" | "refunded";
}

type ReceiptPrintStatus = "queued" | "claimed" | "completed" | "failed" | "cancelled";
interface ReceiptPrintJobRow extends DatabaseRow {
  id: string;
  kind: "receipt" | "receipt_reprint";
  status: ReceiptPrintStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: Date | string;
  completed_at: Date | string | null;
}

interface ReceiptSummaryRow extends DatabaseRow {
  id: string;
  folio: string;
  status: "issued" | "cancelled" | "refunded";
  total_in_cents: number;
  tip_in_cents: number;
  issued_at: Date | string;
  account_label: string;
}

interface RefundableReceiptRow extends DatabaseRow {
  id: string;
  shift_id: string;
  folio: string;
  status: "issued" | "cancelled" | "refunded";
  total_in_cents: number;
  tip_in_cents: number;
  snapshot: unknown;
}

interface RefundPaymentRow extends DatabaseRow {
  id: string;
  payment_method_id: string;
  method_code: "CASH" | "CARD" | "TRANSFER";
  method_name: string;
  sale_in_cents: number | string;
  tip_in_cents: number | string;
}

interface ValidatedTender {
  id: string;
  method: PaymentMethodRow;
  amountInCents: number;
  tipInCents: number;
  totalInCents: number;
  tenderedInCents: number | null;
  changeInCents: number;
  reference: string | null;
}

@Injectable()
export class SalesService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabasePort,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(CashService) private readonly cash: CashService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  async paymentMethods(actor: AuthContext) {
    const result = await this.database.query<PaymentMethodRow>(
      `SELECT id, code, name, supports_change, requires_reference, display_order
         FROM payment_methods
        WHERE site_id = $1 AND active
        ORDER BY display_order, name`,
      [actor.siteId],
    );
    return {
      paymentMethods: result.rows.map((method) => ({
        id: method.id,
        code: method.code,
        name: method.name,
        supportsChange: method.supports_change,
        requiresReference: method.requires_reference,
      })),
    };
  }

  async getReceipt(receiptId: string, actor: AuthContext) {
    const result = await this.database.query<ReceiptRow>(
      `SELECT snapshot, status FROM sales_receipts
        WHERE id = $1 AND site_id = $2`,
      [receiptId, actor.siteId],
    );
    const receipt = result.rows[0];
    if (!receipt) throw new NotFoundException("Ticket inexistente");
    const snapshot = typeof receipt.snapshot === "string" ? JSON.parse(receipt.snapshot) as Record<string, unknown> : receipt.snapshot;
    return { ...snapshot, status: receipt.status };
  }

  async recentReceipts(actor: AuthContext) {
    const result = await this.database.query<ReceiptSummaryRow>(
      `SELECT receipts.id, receipts.folio, receipts.status,
              receipts.total_in_cents, receipts.tip_in_cents, receipts.issued_at,
              COALESCE(tables.name, accounts.reference,
                CASE accounts.service_type
                  WHEN 'takeaway' THEN 'Para llevar'
                  ELSE 'Venta rápida'
                END
              ) AS account_label
         FROM sales_receipts receipts
         JOIN service_accounts accounts ON accounts.id = receipts.account_id
         LEFT JOIN service_tables tables ON tables.id = accounts.table_id
        WHERE receipts.site_id = $1
        ORDER BY receipts.issued_at DESC, receipts.id DESC
        LIMIT 30`,
      [actor.siteId],
    );
    return {
      receipts: result.rows.map((receipt) => ({
        id: receipt.id,
        folio: receipt.folio,
        status: receipt.status,
        totalInCents: receipt.total_in_cents,
        tipInCents: receipt.tip_in_cents,
        issuedAt: new Date(receipt.issued_at).toISOString(),
        accountLabel: receipt.account_label,
      })),
    };
  }

  async receiptPrinting(receiptId: string, actor: AuthContext) {
    const receipt = await this.database.query<{
      register_code: string; register_name: string;
      configured_agent_count: number; online_agent_count: number;
      receipt_status: "issued" | "cancelled" | "refunded";
    }>(
      `SELECT registers.code AS register_code, registers.name AS register_name,
              receipts.status AS receipt_status,
              count(agents.id)::integer AS configured_agent_count,
              count(agents.id) FILTER (
                WHERE agents.last_seen_at >= now() - interval '60 seconds'
              )::integer AS online_agent_count
         FROM sales_receipts receipts
         JOIN cash_shifts shifts ON shifts.id = receipts.shift_id AND shifts.site_id = receipts.site_id
         JOIN cash_registers registers ON registers.id = shifts.register_id AND registers.site_id = receipts.site_id
         LEFT JOIN production_agent_registers assignments ON assignments.register_id = registers.id
         LEFT JOIN production_agents agents ON agents.id = assignments.agent_id
           AND agents.site_id = receipts.site_id AND agents.status = 'active'
        WHERE receipts.id = $1 AND receipts.site_id = $2
        GROUP BY registers.id, receipts.status`,
      [receiptId, actor.siteId],
    );
    const routing = receipt.rows[0];
    if (!routing) throw new NotFoundException("Ticket inexistente");
    const jobs = await this.database.query<ReceiptPrintJobRow>(
      `SELECT id, kind, status, attempts, max_attempts, last_error, created_at, completed_at
         FROM print_jobs WHERE receipt_id = $1 AND site_id = $2
           AND kind IN ('receipt', 'receipt_reprint')
        ORDER BY created_at DESC, id DESC`,
      [receiptId, actor.siteId],
    );
    return {
      receiptId,
      receiptStatus: routing.receipt_status,
      jobs: jobs.rows.map((job) => ({
        id: job.id, kind: job.kind, status: job.status, attempts: job.attempts,
        maxAttempts: job.max_attempts, lastError: job.last_error,
        createdAt: new Date(job.created_at).toISOString(),
        completedAt: job.completed_at ? new Date(job.completed_at).toISOString() : null,
      })),
      routing: {
        registerCode: routing.register_code, registerName: routing.register_name,
        configuredAgentCount: routing.configured_agent_count,
        onlineAgentCount: routing.online_agent_count,
      },
    };
  }

  printReceipt(receiptId: string, key: string, actor: AuthContext) {
    return this.idempotency.execute({
      siteId: actor.siteId, scope: `sales.receipt.print:${receiptId}`, key,
      requestHash: requestHash({ receiptId }),
    }, async (transaction) => {
      const receipt = (await transaction.query<ReceiptRow>(
        `SELECT snapshot, status FROM sales_receipts WHERE id = $1 AND site_id = $2 FOR UPDATE`,
        [receiptId, actor.siteId],
      )).rows[0];
      if (!receipt) throw new NotFoundException("Ticket inexistente");
      const original = (await transaction.query<ReceiptPrintJobRow>(
        `SELECT id, status FROM print_jobs
          WHERE receipt_id = $1 AND site_id = $2 AND kind = 'receipt' FOR UPDATE`,
        [receiptId, actor.siteId],
      )).rows[0];
      if (original?.status === "cancelled") {
        throw new ConflictException("La impresión original está cancelada; solicita una reimpresión con motivo");
      }
      const jobId = original?.id ?? randomUUID();
      const created = !original;
      const requeued = original?.status === "failed";
      if (created) {
        await transaction.query(
          `INSERT INTO print_jobs (id, site_id, receipt_id, kind, payload)
            VALUES ($1, $2, $3, 'receipt', $4::jsonb)`,
          [jobId, actor.siteId, receiptId, JSON.stringify({
            kind: "receipt", receipt: receipt.snapshot, receiptStatus: receipt.status,
          })],
        );
      } else if (requeued) {
        // Keep the job identity and attempt history, granting another five
        // attempts. Claimed jobs always keep their existing lease mechanism.
        await transaction.query(
          `UPDATE print_jobs SET status = 'queued', available_at = now(),
              max_attempts = GREATEST(max_attempts, attempts + 5),
              claimed_by_agent_id = NULL, claim_token_hash = NULL, lease_expires_at = NULL,
              last_error = NULL, completed_at = NULL, updated_at = now(),
              payload = jsonb_set(payload, '{receiptStatus}', to_jsonb($3::text), true)
            WHERE id = $1 AND site_id = $2`,
          [jobId, actor.siteId, receipt.status],
        );
      }
      const body = {
        jobId, receiptId,
        status: created || requeued ? "queued" as const : original!.status,
        created, requeued,
      };
      if (created || requeued) {
        await this.audit.append(transaction, {
          id: randomUUID(), siteId: actor.siteId, actorUserId: actor.userId,
          terminalId: actor.terminalId,
          action: requeued ? "sales.receipt.print_recovered" : "sales.receipt.print_requested",
          entityType: "sales_receipt", entityId: receiptId, changes: body,
        });
        await this.outbox.enqueue(transaction, {
          id: randomUUID(), siteId: actor.siteId, eventType: "print.job.queued",
          aggregateType: "print_job", aggregateId: jobId, payload: body,
        });
      }
      return { status: created || requeued ? 201 : 200, body };
    });
  }

  reprintReceipt(
    receiptId: string,
    input: ReprintReceiptDto,
    key: string,
    actor: AuthContext,
  ) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: `sales.receipt.reprint:${receiptId}`,
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        const receiptResult = await transaction.query<ReceiptRow>(
          `SELECT snapshot, status FROM sales_receipts
            WHERE id = $1 AND site_id = $2 FOR UPDATE`,
          [receiptId, actor.siteId],
        );
        const snapshot = receiptResult.rows[0]?.snapshot;
        if (!snapshot) throw new NotFoundException("Ticket inexistente");
        const jobId = randomUUID();
        const reason = input.reason.trim();
        if (!reason) throw new BadRequestException("Captura el motivo de la reimpresión");
        await transaction.query(
          `INSERT INTO print_jobs (
             id, site_id, receipt_id, kind, payload
           ) VALUES ($1, $2, $3, 'receipt_reprint', $4::jsonb)`,
          [
            jobId,
            actor.siteId,
            receiptId,
            JSON.stringify({
              kind: "receipt_reprint",
              receipt: snapshot,
              receiptStatus: receiptResult.rows[0]!.status,
              reprint: { reason, requestedBy: actor.displayName },
            }),
          ],
        );
        const body = { jobId, receiptId, status: "queued" as const };
        await this.audit.append(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          actorUserId: actor.userId,
          terminalId: actor.terminalId,
          action: "sales.receipt.reprint_requested",
          entityType: "sales_receipt",
          entityId: receiptId,
          changes: { ...body, reason },
        });
        await this.outbox.enqueue(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          eventType: "sales.receipt.reprint_requested",
          aggregateType: "sales_receipt",
          aggregateId: receiptId,
          payload: body,
        });
        return { status: 201, body };
      },
    );
  }

  refundReceipt(
    receiptId: string,
    input: RefundReceiptDto,
    key: string,
    actor: AuthContext,
  ) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: `sales.receipt.refund:${receiptId}`,
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        const receiptResult = await transaction.query<RefundableReceiptRow>(
          `SELECT id, shift_id, folio, status, total_in_cents,
                  tip_in_cents, snapshot
             FROM sales_receipts
            WHERE id = $1 AND site_id = $2
            FOR UPDATE`,
          [receiptId, actor.siteId],
        );
        const receipt = receiptResult.rows[0];
        if (!receipt) throw new NotFoundException("Ticket inexistente");
        if (receipt.status !== "issued") {
          throw new ConflictException("El ticket ya fue cancelado o devuelto");
        }
        const shift = await this.cash.lockOpenShift(transaction, actor.siteId);
        const payments = await transaction.query<RefundPaymentRow>(
          `SELECT payments.id, payments.payment_method_id,
                  methods.code AS method_code, methods.name AS method_name,
                  allocations.amount_in_cents AS sale_in_cents,
                  COALESCE(tips.amount_in_cents, 0) AS tip_in_cents
             FROM payments
             JOIN payment_methods methods ON methods.id = payments.payment_method_id
             JOIN payment_allocations allocations ON allocations.payment_id = payments.id
             LEFT JOIN payment_tips tips ON tips.payment_id = payments.id
            WHERE payments.receipt_id = $1 AND payments.site_id = $2
            ORDER BY methods.display_order, payments.id
            FOR UPDATE OF payments`,
          [receiptId, actor.siteId],
        );
        if (payments.rowCount === 0) {
          throw new ConflictException("El ticket no tiene pagos para devolver");
        }
        const reason = input.reason.trim();
        const refundId = randomUUID();
        const createdAt = new Date().toISOString();
        const paymentSnapshots = payments.rows.map((payment) => {
          const saleInCents = Number(payment.sale_in_cents);
          const tipInCents = Number(payment.tip_in_cents);
          return {
            paymentId: payment.id,
            method: { code: payment.method_code, name: payment.method_name },
            saleInCents,
            tipInCents,
            totalInCents: saleInCents + tipInCents,
          };
        });
        const body = {
          id: refundId,
          receiptId,
          folio: receipt.folio,
          kind: input.kind,
          reason,
          createdAt,
          shiftId: shift.id,
          saleInCents: receipt.total_in_cents,
          tipInCents: receipt.tip_in_cents,
          payments: paymentSnapshots,
        };
        await transaction.query(
          `INSERT INTO sales_refunds (
             id, site_id, receipt_id, shift_id, kind, sale_in_cents,
             tip_in_cents, reason, snapshot, created_by_user_id,
             created_on_terminal_id, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)`,
          [
            refundId,
            actor.siteId,
            receiptId,
            shift.id,
            input.kind,
            receipt.total_in_cents,
            receipt.tip_in_cents,
            reason,
            JSON.stringify({ refund: body, originalReceipt: receipt.snapshot }),
            actor.userId,
            actor.terminalId,
            createdAt,
          ],
        );
        for (const [index, payment] of payments.rows.entries()) {
          const snapshot = paymentSnapshots[index]!;
          await transaction.query(
            `INSERT INTO refund_payments (
               id, site_id, refund_id, payment_id, payment_method_id,
               sale_in_cents, tip_in_cents, total_in_cents
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              randomUUID(),
              actor.siteId,
              refundId,
              payment.id,
              payment.payment_method_id,
              snapshot.saleInCents,
              snapshot.tipInCents,
              snapshot.totalInCents,
            ],
          );
          await transaction.query(
            `UPDATE payments SET status = 'refunded' WHERE id = $1`,
            [payment.id],
          );
          if (payment.method_code === "CASH") {
            await transaction.query(
              `INSERT INTO cash_movements (
                 id, site_id, shift_id, type, direction, amount_in_cents,
                 refund_id, reason, created_by_user_id,
                 created_on_terminal_id, created_at
               ) VALUES ($1, $2, $3, 'cash_out', 'out', $4, $5, $6, $7, $8, $9)`,
              [
                randomUUID(),
                actor.siteId,
                shift.id,
                snapshot.totalInCents,
                refundId,
                `${input.kind === "cancellation" ? "Cancelación" : "Devolución"} ${receipt.folio}: ${reason}`,
                actor.userId,
                actor.terminalId,
                createdAt,
              ],
            );
          }
        }
        await transaction.query(
          `UPDATE sales_receipts
              SET status = $3
            WHERE id = $1 AND site_id = $2`,
          [
            receiptId,
            actor.siteId,
            input.kind === "cancellation" ? "cancelled" : "refunded",
          ],
        );
        await this.audit.append(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          actorUserId: actor.userId,
          terminalId: actor.terminalId,
          action: input.kind === "cancellation"
            ? "sales.receipt.cancelled"
            : "sales.receipt.refunded",
          entityType: "sales_receipt",
          entityId: receiptId,
          changes: body,
        });
        await this.outbox.enqueue(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          eventType: input.kind === "cancellation"
            ? "sales.receipt.cancelled"
            : "sales.receipt.refunded",
          aggregateType: "sales_receipt",
          aggregateId: receiptId,
          payload: body,
        });
        return { status: 201, body };
      },
    );
  }

  checkout(
    accountId: string,
    input: CheckoutAccountDto,
    key: string,
    actor: AuthContext,
  ) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: `sales.checkout:${accountId}`,
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        const locked = await transaction.query<AccountLockRow>(
          `SELECT id, table_id, version, account_group_id, is_primary
             FROM service_accounts
            WHERE id = $1 AND site_id = $2 AND version = $3 AND status = 'open'
            FOR UPDATE`,
          [accountId, actor.siteId, input.expectedVersion],
        );
        const account = locked.rows[0];
        if (!account) {
          throw new ConflictException(
            "La cuenta cambió, ya fue cobrada o dejó de estar disponible",
          );
        }
        const pending = await transaction.query<{ id: string }>(
          `SELECT id FROM order_items
            WHERE account_id = $1 AND site_id = $2
              AND preparation_state = 'pending'
            LIMIT 1 FOR UPDATE`,
          [accountId, actor.siteId],
        );
        if (pending.rowCount > 0) {
          throw new ConflictException(
            "Envía o cancela los artículos pendientes antes de cobrar",
          );
        }

        const snapshot = await this.accounts.readAccount(
          transaction,
          accountId,
          actor.siteId,
        );
        if (snapshot.totalInCents <= 0) {
          throw new BadRequestException("La cuenta no tiene saldo por cobrar");
        }
        const shift = await this.cash.lockOpenShift(transaction, actor.siteId);
        const tenders = await this.validateTenders(
          transaction,
          actor.siteId,
          input.payments,
          snapshot.totalInCents,
        );
        const tipInCents = tenders.reduce((total, tender) => total + tender.tipInCents, 0);
        const changeInCents = tenders.reduce(
          (total, tender) => total + tender.changeInCents,
          0,
        );

        await transaction.query(
          `INSERT INTO document_sequences (site_id, document_type, next_value)
           VALUES ($1, 'RECEIPT', 1)
           ON CONFLICT (site_id, document_type) DO NOTHING`,
          [actor.siteId],
        );
        const sequence = await transaction.query<SequenceRow>(
          `UPDATE document_sequences
              SET next_value = next_value + 1
            WHERE site_id = $1 AND document_type = 'RECEIPT'
          RETURNING next_value - 1 AS value`,
          [actor.siteId],
        );
        const folioNumber = Number(sequence.rows[0]?.value);
        if (!Number.isSafeInteger(folioNumber) || folioNumber <= 0) {
          throw new Error("No fue posible asignar el folio del ticket");
        }
        const folio = `T-${String(folioNumber).padStart(6, "0")}`;
        const receiptId = randomUUID();
        const issuedAt = new Date().toISOString();
        const paymentSnapshots = tenders.map((tender) => ({
          id: tender.id,
          method: {
            id: tender.method.id,
            code: tender.method.code,
            name: tender.method.name,
          },
          amountInCents: tender.amountInCents,
          tipInCents: tender.tipInCents,
          totalInCents: tender.totalInCents,
          tenderedInCents: tender.tenderedInCents,
          changeInCents: tender.changeInCents,
          reference: tender.reference,
        }));
        const body = {
          id: receiptId,
          folio,
          status: "issued" as const,
          issuedAt,
          shift: {
            id: shift.id,
            register: {
              id: shift.register_id,
              code: shift.register_code,
              name: shift.register_name,
            },
          },
          account: snapshot,
          payments: paymentSnapshots,
          totals: {
            saleInCents: snapshot.totalInCents,
            tipInCents,
            collectedInCents: snapshot.totalInCents + tipInCents,
            changeInCents,
          },
        };

        await transaction.query(
          `INSERT INTO sales_receipts (
             id, site_id, account_id, shift_id, folio_number, folio,
             subtotal_in_cents, discount_in_cents, tax_in_cents,
             total_in_cents, tip_in_cents, change_in_cents, snapshot,
             issued_by_user_id, issued_on_terminal_id, issued_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             $13::jsonb, $14, $15, $16
           )`,
          [
            receiptId,
            actor.siteId,
            accountId,
            shift.id,
            folioNumber,
            folio,
            snapshot.totals.subtotalInCents,
            snapshot.totals.discountInCents,
            snapshot.totals.taxInCents,
            snapshot.totalInCents,
            tipInCents,
            changeInCents,
            JSON.stringify(body),
            actor.userId,
            actor.terminalId,
            issuedAt,
          ],
        );

        await transaction.query(
          `INSERT INTO print_jobs (
             id, site_id, receipt_id, kind, payload
           ) VALUES ($1, $2, $3, 'receipt', $4::jsonb)`,
          [
            randomUUID(),
            actor.siteId,
            receiptId,
            JSON.stringify({ kind: "receipt", receipt: body, receiptStatus: "issued" }),
          ],
        );

        for (const tender of tenders) {
          await transaction.query(
            `INSERT INTO payments (
               id, site_id, receipt_id, shift_id, payment_method_id,
               amount_in_cents, tendered_in_cents, change_in_cents, reference,
               captured_by_user_id, captured_on_terminal_id, captured_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              tender.id,
              actor.siteId,
              receiptId,
              shift.id,
              tender.method.id,
              tender.totalInCents,
              tender.tenderedInCents,
              tender.changeInCents,
              tender.reference,
              actor.userId,
              actor.terminalId,
              issuedAt,
            ],
          );
          await transaction.query(
            `INSERT INTO payment_allocations (payment_id, account_id, amount_in_cents)
             VALUES ($1, $2, $3)`,
            [tender.id, accountId, tender.amountInCents],
          );
          if (tender.tipInCents > 0) {
            await transaction.query(
              `INSERT INTO payment_tips (id, site_id, payment_id, amount_in_cents)
               VALUES ($1, $2, $3, $4)`,
              [randomUUID(), actor.siteId, tender.id, tender.tipInCents],
            );
          }
          if (tender.method.code === "CASH") {
            await transaction.query(
              `INSERT INTO cash_movements (
                 id, site_id, shift_id, type, direction, amount_in_cents,
                 payment_id, reason, created_by_user_id, created_on_terminal_id,
                 created_at
               ) VALUES (
                 $1, $2, $3, 'sale', 'in', $4, $5, $6, $7, $8, $9
               )`,
              [
                randomUUID(),
                actor.siteId,
                shift.id,
                tender.totalInCents,
                tender.id,
                `Cobro ${folio}`,
                actor.userId,
                actor.terminalId,
                issuedAt,
              ],
            );
          }
        }

        let promotedAccountId: string | null = null;
        if (account.is_primary) {
          const sibling = await transaction.query<{ id: string }>(
            `SELECT id FROM service_accounts
              WHERE site_id = $1 AND account_group_id = $2 AND id <> $3
                AND status IN ('open', 'awaiting_payment')
              ORDER BY opened_at, id
              LIMIT 1 FOR UPDATE`,
            [actor.siteId, account.account_group_id, account.id],
          );
          promotedAccountId = sibling.rows[0]?.id ?? null;
        }
        const accountVersion = account.version + 1;
        await transaction.query(
          `UPDATE service_accounts
              SET status = 'closed', is_primary = false, version = $3,
                  closed_at = $4, updated_at = $4
            WHERE id = $1 AND site_id = $2`,
          [accountId, actor.siteId, accountVersion, issuedAt],
        );
        if (promotedAccountId) {
          await transaction.query(
            `UPDATE service_accounts
                SET is_primary = true, updated_at = $3
              WHERE id = $1 AND site_id = $2`,
            [promotedAccountId, actor.siteId, issuedAt],
          );
        }

        await this.audit.append(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          actorUserId: actor.userId,
          terminalId: actor.terminalId,
          action: "sale.completed",
          entityType: "sales_receipt",
          entityId: receiptId,
          changes: {
            receiptId,
            folio,
            accountId,
            accountVersion,
            shiftId: shift.id,
            totalInCents: snapshot.totalInCents,
            tipInCents,
            changeInCents,
            paymentIds: tenders.map((tender) => tender.id),
          },
        });
        await this.outbox.enqueue(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          eventType: "sale.completed",
          aggregateType: "sales_receipt",
          aggregateId: receiptId,
          payload: {
            receiptId,
            folio,
            accountId,
            shiftId: shift.id,
            totalInCents: snapshot.totalInCents,
            tipInCents,
          },
        });
        return { status: 201, body };
      },
    );
  }

  private async validateTenders(
    transaction: DatabaseSession,
    siteId: string,
    inputs: CheckoutTenderDto[],
    saleTotalInCents: number,
  ): Promise<ValidatedTender[]> {
    const codes = inputs.map((payment) => payment.methodCode);
    if (new Set(codes).size !== codes.length) {
      throw new BadRequestException("No repitas una forma de pago");
    }
    const methods = await transaction.query<PaymentMethodRow>(
      `SELECT id, code, name, supports_change, requires_reference, display_order
         FROM payment_methods
        WHERE site_id = $1 AND active AND code = ANY($2::text[])`,
      [siteId, codes],
    );
    if (methods.rowCount !== codes.length) {
      throw new BadRequestException("Forma de pago inválida o inactiva");
    }
    const methodsByCode = new Map(methods.rows.map((method) => [method.code, method]));
    const allocated = inputs.reduce((total, payment) => total + payment.amountInCents, 0);
    if (allocated !== saleTotalInCents) {
      throw new BadRequestException(
        "Las formas de pago deben cubrir exactamente el total de la cuenta",
      );
    }

    return inputs.map((input) => {
      const method = methodsByCode.get(input.methodCode)!;
      const totalInCents = input.amountInCents + input.tipInCents;
      const reference = input.reference?.trim() || null;
      if (method.requires_reference && !reference) {
        throw new BadRequestException(`Captura la referencia de ${method.name}`);
      }
      if (!method.supports_change && input.tenderedInCents !== undefined) {
        throw new BadRequestException(`${method.name} no recibe efectivo`);
      }
      const tenderedInCents = method.supports_change
        ? input.tenderedInCents ?? totalInCents
        : null;
      if (tenderedInCents !== null && tenderedInCents < totalInCents) {
        throw new BadRequestException("El efectivo recibido no cubre el cobro y la propina");
      }
      return {
        id: randomUUID(),
        method,
        amountInCents: input.amountInCents,
        tipInCents: input.tipInCents,
        totalInCents,
        tenderedInCents,
        changeInCents: tenderedInCents === null ? 0 : tenderedInCents - totalInCents,
        reference,
      };
    });
  }
}
