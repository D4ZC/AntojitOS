import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service.js";
import {
  DATABASE,
  type DatabasePort,
  type DatabaseRow,
  type DatabaseSession,
} from "../database/database.port.js";
import { IdempotencyService, requestHash } from "../idempotency/idempotency.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import type { AuthContext } from "../security/auth-context.js";
import type { CloseCashShiftDto } from "./dto/close-cash-shift.dto.js";
import type { CreateCashMovementDto } from "./dto/create-cash-movement.dto.js";
import type { OpenCashShiftDto } from "./dto/open-cash-shift.dto.js";

interface RegisterRow extends DatabaseRow {
  id: string;
  code: string;
  name: string;
}

export interface OpenCashShiftRow extends DatabaseRow {
  id: string;
  register_id: string;
  register_code: string;
  register_name: string;
  status: "open";
  version: number;
  opening_float_in_cents: number;
  opened_by_user_id: string;
  opened_by_name: string;
  opened_at: Date | string;
}

interface AggregateRow extends DatabaseRow {
  receipt_count: number | string;
  gross_sale_in_cents: number | string;
  subtotal_in_cents: number | string;
  discount_in_cents: number | string;
  tax_in_cents: number | string;
  tip_in_cents: number | string;
}

interface RefundAggregateRow extends DatabaseRow {
  refund_count: number | string;
  refunded_sale_in_cents: number | string;
  refunded_tip_in_cents: number | string;
}

interface PaymentReportRow extends DatabaseRow {
  id: string;
  code: "CASH" | "CARD" | "TRANSFER";
  name: string;
  sale_in_cents: number | string;
  tip_in_cents: number | string;
  refunded_sale_in_cents: number | string;
  refunded_tip_in_cents: number | string;
}

interface MovementRow extends DatabaseRow {
  id: string;
  type: "opening_float" | "sale" | "cash_in" | "cash_out";
  direction: "in" | "out";
  amount_in_cents: number;
  reason: string | null;
  created_by_name: string;
  created_at: Date | string;
}

const shiftBody = (shift: OpenCashShiftRow) => ({
  id: shift.id,
  status: shift.status,
  version: shift.version,
  openingFloatInCents: shift.opening_float_in_cents,
  openedBy: {
    id: shift.opened_by_user_id,
    displayName: shift.opened_by_name,
  },
  openedAt: new Date(shift.opened_at).toISOString(),
});

@Injectable()
export class CashService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabasePort,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  async currentShift(actor: AuthContext) {
    const register = await this.defaultRegister(this.database, actor.siteId);
    const result = await this.database.query<OpenCashShiftRow>(
      `SELECT
         shifts.id, shifts.register_id, registers.code AS register_code,
         registers.name AS register_name, shifts.status, shifts.version,
         shifts.opening_float_in_cents, shifts.opened_by_user_id,
         users.display_name AS opened_by_name, shifts.opened_at
       FROM cash_shifts shifts
       JOIN cash_registers registers ON registers.id = shifts.register_id
       JOIN app_users users ON users.id = shifts.opened_by_user_id
       WHERE shifts.site_id = $1 AND shifts.register_id = $2
         AND shifts.status = 'open'
       ORDER BY shifts.opened_at DESC
       LIMIT 1`,
      [actor.siteId, register.id],
    );
    const shift = result.rows[0];
    return {
      register: { id: register.id, code: register.code, name: register.name },
      shift: shift ? shiftBody(shift) : null,
    };
  }

  openShift(input: OpenCashShiftDto, key: string, actor: AuthContext) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: "cash.shift.open",
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        const register = await this.defaultRegister(transaction, actor.siteId, true);
        const existing = await transaction.query(
          `SELECT id FROM cash_shifts
            WHERE register_id = $1 AND status IN ('open', 'counting')
            LIMIT 1 FOR UPDATE`,
          [register.id],
        );
        if (existing.rowCount > 0) {
          throw new ConflictException("La caja ya tiene un turno abierto");
        }

        const shiftId = randomUUID();
        const inserted = await transaction.query<OpenCashShiftRow>(
          `INSERT INTO cash_shifts (
             id, site_id, register_id, opening_float_in_cents,
             opened_by_user_id, opened_on_terminal_id
           ) VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING
             id, register_id, $7::text AS register_code,
             $8::text AS register_name, status, version,
             opening_float_in_cents, opened_by_user_id,
             $9::text AS opened_by_name, opened_at`,
          [
            shiftId,
            actor.siteId,
            register.id,
            input.openingFloatInCents,
            actor.userId,
            actor.terminalId,
            register.code,
            register.name,
            actor.displayName,
          ],
        );
        const shift = inserted.rows[0];
        if (!shift) throw new Error("PostgreSQL no devolvió el turno abierto");

        if (input.openingFloatInCents > 0) {
          await transaction.query(
            `INSERT INTO cash_movements (
               id, site_id, shift_id, type, direction, amount_in_cents,
               reason, created_by_user_id, created_on_terminal_id
             ) VALUES ($1, $2, $3, 'opening_float', 'in', $4, $5, $6, $7)`,
            [
              randomUUID(),
              actor.siteId,
              shiftId,
              input.openingFloatInCents,
              "Fondo inicial",
              actor.userId,
              actor.terminalId,
            ],
          );
        }

        const body = {
          register: { id: register.id, code: register.code, name: register.name },
          shift: shiftBody(shift),
        };
        await this.audit.append(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          actorUserId: actor.userId,
          terminalId: actor.terminalId,
          action: "cash_shift.opened",
          entityType: "cash_shift",
          entityId: shiftId,
          changes: body,
        });
        await this.outbox.enqueue(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          eventType: "cash.shift.opened",
          aggregateType: "cash_shift",
          aggregateId: shiftId,
          payload: body,
        });
        return { status: 201, body };
      },
    );
  }

  async currentReport(actor: AuthContext) {
    const shift = await this.findOpenShift(this.database, actor.siteId);
    if (!shift) throw new ConflictException("No existe un turno de caja abierto");
    return this.buildReport(this.database, shift, actor.siteId);
  }

  createMovement(input: CreateCashMovementDto, key: string, actor: AuthContext) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: "cash.movement.create",
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        const shift = await this.lockOpenShift(transaction, actor.siteId);
        const reason = input.reason.trim();
        if (!reason) throw new BadRequestException("Captura el motivo del movimiento");
        const movementId = randomUUID();
        const type = input.direction === "in" ? "cash_in" : "cash_out";
        const inserted = await transaction.query<{ created_at: Date | string }>(
          `INSERT INTO cash_movements (
             id, site_id, shift_id, type, direction, amount_in_cents,
             reason, created_by_user_id, created_on_terminal_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING created_at`,
          [
            movementId,
            actor.siteId,
            shift.id,
            type,
            input.direction,
            input.amountInCents,
            reason,
            actor.userId,
            actor.terminalId,
          ],
        );
        const body = {
          id: movementId,
          shiftId: shift.id,
          type,
          direction: input.direction,
          amountInCents: input.amountInCents,
          reason,
          createdAt: new Date(inserted.rows[0]!.created_at).toISOString(),
        };
        await this.audit.append(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          actorUserId: actor.userId,
          terminalId: actor.terminalId,
          action: "cash.movement.created",
          entityType: "cash_movement",
          entityId: movementId,
          changes: body,
        });
        await this.outbox.enqueue(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          eventType: "cash.movement.created",
          aggregateType: "cash_shift",
          aggregateId: shift.id,
          payload: body,
        });
        return { status: 201, body };
      },
    );
  }

  closeShift(input: CloseCashShiftDto, key: string, actor: AuthContext) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: "cash.shift.close",
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        const locked = await transaction.query<OpenCashShiftRow>(
          `SELECT
             shifts.id, shifts.register_id, registers.code AS register_code,
             registers.name AS register_name, shifts.status, shifts.version,
             shifts.opening_float_in_cents, shifts.opened_by_user_id,
             users.display_name AS opened_by_name, shifts.opened_at
           FROM cash_shifts shifts
           JOIN cash_registers registers ON registers.id = shifts.register_id
           JOIN app_users users ON users.id = shifts.opened_by_user_id
           WHERE shifts.site_id = $1 AND shifts.status = 'open'
             AND shifts.version = $2
           ORDER BY shifts.opened_at DESC
           LIMIT 1 FOR UPDATE`,
          [actor.siteId, input.expectedVersion],
        );
        const shift = locked.rows[0];
        if (!shift) {
          throw new ConflictException("El turno cambió o ya fue cerrado");
        }
        const report = await this.buildReport(transaction, shift, actor.siteId);
        if (report.openAccountCount > 0) {
          throw new ConflictException(
            `No puedes cerrar caja: quedan ${report.openAccountCount} cuentas abiertas`,
          );
        }
        const codes = input.declarations.map((item) => item.methodCode);
        if (new Set(codes).size !== codes.length) {
          throw new BadRequestException("No repitas una forma de pago en la declaración");
        }
        const expectedCodes = report.paymentMethods.map((method) => method.code).sort();
        if ([...codes].sort().join(",") !== expectedCodes.join(",")) {
          throw new BadRequestException("Declara todas las formas de pago configuradas");
        }

        const declarations = report.paymentMethods.map((method) => {
          const declared = input.declarations.find(
            (item) => item.methodCode === method.code,
          )!;
          const theoreticalInCents = method.code === "CASH"
            ? report.cash.theoreticalInCents
            : method.netInCents;
          return {
            method,
            theoreticalInCents,
            declaredInCents: declared.declaredInCents,
            differenceInCents: declared.declaredInCents - theoreticalInCents,
          };
        });
        const closeId = randomUUID();
        const closedAt = new Date().toISOString();
        const body = {
          id: closeId,
          status: "closed" as const,
          closedAt,
          shift: { ...report.shift, status: "closed" as const, version: shift.version + 1 },
          report,
          declarations: declarations.map(({ method, ...values }) => ({
            method: { id: method.id, code: method.code, name: method.name },
            ...values,
          })),
        };
        await transaction.query(
          `INSERT INTO cash_shift_closes (
             id, site_id, shift_id, snapshot, closed_by_user_id,
             closed_on_terminal_id, closed_at
           ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
          [
            closeId,
            actor.siteId,
            shift.id,
            JSON.stringify(body),
            actor.userId,
            actor.terminalId,
            closedAt,
          ],
        );
        for (const declaration of declarations) {
          await transaction.query(
            `INSERT INTO cash_shift_declarations (
               id, site_id, close_id, payment_method_id, theoretical_in_cents,
               declared_in_cents, difference_in_cents
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              randomUUID(),
              actor.siteId,
              closeId,
              declaration.method.id,
              declaration.theoreticalInCents,
              declaration.declaredInCents,
              declaration.differenceInCents,
            ],
          );
        }
        await transaction.query(
          `UPDATE cash_shifts
              SET status = 'closed', version = version + 1,
                  closed_by_user_id = $3, closed_on_terminal_id = $4,
                  closed_at = $5, updated_at = $5
            WHERE id = $1 AND site_id = $2`,
          [shift.id, actor.siteId, actor.userId, actor.terminalId, closedAt],
        );
        await transaction.query(
          `INSERT INTO print_jobs (
             id, site_id, shift_close_id, kind, payload
           ) VALUES ($1, $2, $3, 'shift_close', $4::jsonb)`,
          [
            randomUUID(),
            actor.siteId,
            closeId,
            JSON.stringify({ kind: "shift_close", close: body }),
          ],
        );
        await this.audit.append(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          actorUserId: actor.userId,
          terminalId: actor.terminalId,
          action: "cash_shift.closed",
          entityType: "cash_shift",
          entityId: shift.id,
          changes: body,
        });
        await this.outbox.enqueue(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          eventType: "cash.shift.closed",
          aggregateType: "cash_shift",
          aggregateId: shift.id,
          payload: { closeId, shiftId: shift.id, declarations: body.declarations },
        });
        return { status: 201, body };
      },
    );
  }

  async lockOpenShift(
    transaction: DatabaseSession,
    siteId: string,
  ): Promise<OpenCashShiftRow> {
    const result = await transaction.query<OpenCashShiftRow>(
      `SELECT
         shifts.id, shifts.register_id, registers.code AS register_code,
         registers.name AS register_name, shifts.status, shifts.version,
         shifts.opening_float_in_cents, shifts.opened_by_user_id,
         users.display_name AS opened_by_name, shifts.opened_at
       FROM cash_shifts shifts
       JOIN cash_registers registers ON registers.id = shifts.register_id
       JOIN app_users users ON users.id = shifts.opened_by_user_id
       WHERE shifts.site_id = $1 AND shifts.status = 'open'
       ORDER BY shifts.opened_at DESC
       LIMIT 1 FOR UPDATE`,
      [siteId],
    );
    const shift = result.rows[0];
    if (!shift) {
      throw new ConflictException("Abre un turno de caja antes de cobrar");
    }
    return shift;
  }

  private async findOpenShift(
    session: DatabaseSession,
    siteId: string,
  ): Promise<OpenCashShiftRow | null> {
    const result = await session.query<OpenCashShiftRow>(
      `SELECT
         shifts.id, shifts.register_id, registers.code AS register_code,
         registers.name AS register_name, shifts.status, shifts.version,
         shifts.opening_float_in_cents, shifts.opened_by_user_id,
         users.display_name AS opened_by_name, shifts.opened_at
       FROM cash_shifts shifts
       JOIN cash_registers registers ON registers.id = shifts.register_id
       JOIN app_users users ON users.id = shifts.opened_by_user_id
       WHERE shifts.site_id = $1 AND shifts.status = 'open'
       ORDER BY shifts.opened_at DESC
       LIMIT 1`,
      [siteId],
    );
    return result.rows[0] ?? null;
  }

  private async buildReport(
    session: DatabaseSession,
    shift: OpenCashShiftRow,
    siteId: string,
  ) {
    const [salesResult, refundsResult, paymentResult, movementResult, openResult] =
      await Promise.all([
        session.query<AggregateRow>(
          `SELECT
             count(*) AS receipt_count,
             COALESCE(sum(total_in_cents), 0) AS gross_sale_in_cents,
             COALESCE(sum(subtotal_in_cents), 0) AS subtotal_in_cents,
             COALESCE(sum(discount_in_cents), 0) AS discount_in_cents,
             COALESCE(sum(tax_in_cents), 0) AS tax_in_cents,
             COALESCE(sum(tip_in_cents), 0) AS tip_in_cents
           FROM sales_receipts WHERE shift_id = $1 AND site_id = $2`,
          [shift.id, siteId],
        ),
        session.query<RefundAggregateRow>(
          `SELECT
             count(*) AS refund_count,
             COALESCE(sum(sale_in_cents), 0) AS refunded_sale_in_cents,
             COALESCE(sum(tip_in_cents), 0) AS refunded_tip_in_cents
           FROM sales_refunds WHERE shift_id = $1 AND site_id = $2`,
          [shift.id, siteId],
        ),
        session.query<PaymentReportRow>(
          `SELECT methods.id, methods.code, methods.name,
             COALESCE((
               SELECT sum(allocations.amount_in_cents)
                 FROM payments payments
                 JOIN payment_allocations allocations ON allocations.payment_id = payments.id
                WHERE payments.shift_id = $1 AND payments.payment_method_id = methods.id
             ), 0) AS sale_in_cents,
             COALESCE((
               SELECT sum(tips.amount_in_cents)
                 FROM payments payments
                 JOIN payment_tips tips ON tips.payment_id = payments.id
                WHERE payments.shift_id = $1 AND payments.payment_method_id = methods.id
             ), 0) AS tip_in_cents,
             COALESCE((
               SELECT sum(refund_payments.sale_in_cents)
                 FROM refund_payments
                 JOIN sales_refunds refunds ON refunds.id = refund_payments.refund_id
                WHERE refunds.shift_id = $1
                  AND refund_payments.payment_method_id = methods.id
             ), 0) AS refunded_sale_in_cents,
             COALESCE((
               SELECT sum(refund_payments.tip_in_cents)
                 FROM refund_payments
                 JOIN sales_refunds refunds ON refunds.id = refund_payments.refund_id
                WHERE refunds.shift_id = $1
                  AND refund_payments.payment_method_id = methods.id
             ), 0) AS refunded_tip_in_cents
           FROM payment_methods methods
          WHERE methods.site_id = $2 AND methods.active
          ORDER BY methods.display_order, methods.name`,
          [shift.id, siteId],
        ),
        session.query<MovementRow>(
          `SELECT movements.id, movements.type, movements.direction,
                  movements.amount_in_cents, movements.reason,
                  users.display_name AS created_by_name, movements.created_at
             FROM cash_movements movements
             JOIN app_users users ON users.id = movements.created_by_user_id
            WHERE movements.shift_id = $1 AND movements.site_id = $2
            ORDER BY movements.created_at, movements.id`,
          [shift.id, siteId],
        ),
        session.query<{ count: number | string }>(
          `SELECT count(*) AS count FROM service_accounts
            WHERE site_id = $1 AND status IN ('open', 'awaiting_payment')`,
          [siteId],
        ),
      ]);
    const sales = salesResult.rows[0]!;
    const refunds = refundsResult.rows[0]!;
    const movements = movementResult.rows.map((movement) => ({
      id: movement.id,
      type: movement.type,
      direction: movement.direction,
      amountInCents: Number(movement.amount_in_cents),
      reason: movement.reason,
      createdBy: movement.created_by_name,
      createdAt: new Date(movement.created_at).toISOString(),
    }));
    const paymentMethods = paymentResult.rows.map((method) => {
      const saleInCents = Number(method.sale_in_cents);
      const tipInCents = Number(method.tip_in_cents);
      const refundedSaleInCents = Number(method.refunded_sale_in_cents);
      const refundedTipInCents = Number(method.refunded_tip_in_cents);
      return {
        id: method.id,
        code: method.code,
        name: method.name,
        saleInCents,
        tipInCents,
        refundedSaleInCents,
        refundedTipInCents,
        netInCents:
          saleInCents + tipInCents - refundedSaleInCents - refundedTipInCents,
      };
    });
    const cashInCents = movements
      .filter((movement) => movement.direction === "in")
      .reduce((sum, movement) => sum + movement.amountInCents, 0);
    const cashOutInCents = movements
      .filter((movement) => movement.direction === "out")
      .reduce((sum, movement) => sum + movement.amountInCents, 0);
    const grossSaleInCents = Number(sales.gross_sale_in_cents);
    const refundedSaleInCents = Number(refunds.refunded_sale_in_cents);
    const receiptCount = Number(sales.receipt_count);
    return {
      register: {
        id: shift.register_id,
        code: shift.register_code,
        name: shift.register_name,
      },
      shift: shiftBody(shift),
      sales: {
        receiptCount,
        refundCount: Number(refunds.refund_count),
        subtotalInCents: Number(sales.subtotal_in_cents),
        discountInCents: Number(sales.discount_in_cents),
        taxInCents: Number(sales.tax_in_cents),
        grossSaleInCents,
        refundedSaleInCents,
        netSaleInCents: grossSaleInCents - refundedSaleInCents,
        tipInCents: Number(sales.tip_in_cents),
        refundedTipInCents: Number(refunds.refunded_tip_in_cents),
        averageTicketInCents:
          receiptCount === 0 ? 0 : Math.round(grossSaleInCents / receiptCount),
      },
      paymentMethods,
      cash: {
        totalInCents: cashInCents,
        totalOutCents: cashOutInCents,
        theoreticalInCents: cashInCents - cashOutInCents,
      },
      movements,
      openAccountCount: Number(openResult.rows[0]?.count ?? 0),
    };
  }

  private async defaultRegister(
    session: DatabaseSession,
    siteId: string,
    lock = false,
  ): Promise<RegisterRow> {
    const result = await session.query<RegisterRow>(
      `SELECT id, code, name
         FROM cash_registers
        WHERE site_id = $1 AND active
        ORDER BY code, id
        LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [siteId],
    );
    const register = result.rows[0];
    if (!register) throw new NotFoundException("No existe una caja activa");
    return register;
  }
}
