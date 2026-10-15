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
  snapshot: unknown;
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
      `SELECT snapshot FROM sales_receipts
        WHERE id = $1 AND site_id = $2`,
      [receiptId, actor.siteId],
    );
    const receipt = result.rows[0]?.snapshot;
    if (!receipt) throw new NotFoundException("Ticket inexistente");
    return receipt;
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
