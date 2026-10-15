import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
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
