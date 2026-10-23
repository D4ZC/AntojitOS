import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service.js";
import { DATABASE, type DatabasePort, type DatabaseRow, type DatabaseSession } from "../database/database.port.js";
import { IdempotencyService, requestHash } from "../idempotency/idempotency.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import type { AuthContext } from "../security/auth-context.js";
import type { AccountingSummaryQueryDto, CreateBillDto, CreateSupplierDto, CreateSupplierPaymentDto, UpdateSupplierDto, VoidBillDto, VoidSupplierPaymentDto } from "./dto/accounting.dto.js";

interface SupplierRow extends DatabaseRow {
  id: string; name: string; contact_name: string | null; phone: string | null;
  tax_id: string | null; notes: string | null; active: boolean; version: number;
  created_at: Date | string;
}
interface BillRow extends DatabaseRow {
  id: string; supplier_id: string | null; supplier_name: string | null; description: string;
  amount_in_cents: number; issued_on: string; due_on: string | null;
  reference: string | null; version: number; created_at: Date | string;
  voided_at: Date | string | null; void_reason: string | null;
}
interface PaymentRow extends DatabaseRow {
  id: string; bill_id: string; amount_in_cents: number; method_code: string;
  paid_on: string; reference: string | null; source: string; cash_movement_id: string | null;
  reversal_cash_movement_id: string | null; voided_at: Date | string | null;
  void_reason: string | null; created_at: Date | string;
}

const supplierBody = (row: SupplierRow) => ({
  id: row.id, name: row.name, contactName: row.contact_name, phone: row.phone,
  taxId: row.tax_id, notes: row.notes, active: row.active, version: row.version,
  createdAt: new Date(row.created_at).toISOString(),
});
const paymentBody = (row: PaymentRow) => ({
  id: row.id, amountInCents: row.amount_in_cents, methodCode: row.method_code,
  paidOn: row.paid_on, reference: row.reference, source: row.source,
  cashMovementId: row.cash_movement_id, reversalCashMovementId: row.reversal_cash_movement_id,
  voidedAt: row.voided_at ? new Date(row.voided_at).toISOString() : null,
  voidReason: row.void_reason, createdAt: new Date(row.created_at).toISOString(),
});
const todayInMexico = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

@Injectable()
export class AccountingService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabasePort,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  async suppliers(actor: AuthContext) {
    const rows = await this.database.query<SupplierRow>(
      `SELECT * FROM accounting_suppliers WHERE site_id = $1 ORDER BY active DESC, name, id`,
      [actor.siteId],
    );
    return { suppliers: rows.rows.map(supplierBody) };
  }

  createSupplier(input: CreateSupplierDto, key: string, actor: AuthContext) {
    return this.mutate("supplier.create", input, key, actor, async (session) => {
      const row = await session.query<SupplierRow>(
        `INSERT INTO accounting_suppliers (id, site_id, name, contact_name, phone, tax_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [randomUUID(), actor.siteId, this.text(input.name, 160, true),
          this.text(input.contactName, 160), this.text(input.phone, 60),
          this.text(input.taxId, 40), this.text(input.notes, 1000)],
      );
      const supplier = supplierBody(row.rows[0]!);
      await this.record(session, actor, "supplier.created", supplier.id, supplier);
      return { status: 201, body: { supplier } };
    });
  }

  updateSupplier(id: string, input: UpdateSupplierDto, key: string, actor: AuthContext) {
    return this.mutate("supplier.update", { id, ...input }, key, actor, async (session) => {
      const old = (await session.query<SupplierRow>(
        "SELECT * FROM accounting_suppliers WHERE site_id = $1 AND id = $2 FOR UPDATE",
        [actor.siteId, id],
      )).rows[0];
      if (!old) throw new NotFoundException("No existe el proveedor");
      this.version(old.version, input.expectedVersion);
      if (input.active !== undefined && typeof input.active !== "boolean") {
        throw new BadRequestException("Estado de proveedor inválido");
      }
      const row = await session.query<SupplierRow>(
        `UPDATE accounting_suppliers SET name = $3, contact_name = $4, phone = $5,
          tax_id = $6, notes = $7, active = $8, version = version + 1, updated_at = now()
         WHERE site_id = $1 AND id = $2 RETURNING *`,
        [actor.siteId, id,
          input.name === undefined ? old.name : this.text(input.name, 160, true),
          input.contactName === undefined ? old.contact_name : this.text(input.contactName, 160),
          input.phone === undefined ? old.phone : this.text(input.phone, 60),
          input.taxId === undefined ? old.tax_id : this.text(input.taxId, 40),
          input.notes === undefined ? old.notes : this.text(input.notes, 1000),
          input.active ?? old.active],
      );
      const supplier = supplierBody(row.rows[0]!);
      await this.record(session, actor, "supplier.updated", id, { before: supplierBody(old), after: supplier });
      return { status: 200, body: { supplier } };
    });
  }

  async bills(actor: AuthContext) {
    return { bills: await this.readBills(this.database, actor.siteId) };
  }

  createBill(input: CreateBillDto, key: string, actor: AuthContext) {
    return this.mutate("bill.create", input, key, actor, async (session) => {
      this.money(input.amountInCents);
      this.date(input.issuedOn);
      if (input.dueOn !== undefined && input.dueOn !== null) {
        this.date(input.dueOn);
        if (input.dueOn < input.issuedOn) throw new BadRequestException("El vencimiento debe ser igual o posterior a la fecha del cargo");
      }
      if (input.supplierId) {
        const supplier = (await session.query<SupplierRow>(
          "SELECT * FROM accounting_suppliers WHERE site_id = $1 AND id = $2 FOR UPDATE",
          [actor.siteId, input.supplierId],
        )).rows[0];
        if (!supplier) throw new NotFoundException("No existe el proveedor");
        if (!supplier.active) throw new ConflictException("El proveedor está inactivo");
      }
      const id = randomUUID();
      await session.query(
        `INSERT INTO accounting_bills (id, site_id, supplier_id, description, amount_in_cents,
          issued_on, due_on, reference, created_by_user_id, created_on_terminal_id)
         VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8, $9, $10)`,
        [id, actor.siteId, input.supplierId ?? null, this.text(input.description, 240, true),
          input.amountInCents, input.issuedOn, input.dueOn ?? null,
          this.text(input.reference, 160), actor.userId, actor.terminalId],
      );
      const bill = (await this.readBills(session, actor.siteId, id))[0]!;
      await this.record(session, actor, "bill.created", id, bill);
      return { status: 201, body: { bill } };
    });
  }

  payBill(id: string, input: CreateSupplierPaymentDto, key: string, actor: AuthContext) {
    return this.mutate("bill.pay", { id, ...input }, key, actor, async (session) => {
      this.money(input.amountInCents);
      this.date(input.paidOn);
      if (input.paidOn > todayInMexico()) throw new BadRequestException("Registra un pago ya realizado, con fecha de hoy o anterior");
      if (!["CASH", "CARD", "TRANSFER"].includes(input.methodCode)
        || !["business_cash", "external"].includes(input.source)) {
        throw new BadRequestException("Forma de pago u origen inválido");
      }
      const bill = await this.lockBill(session, id, input.expectedVersion, actor);
      if (bill.voided_at) throw new ConflictException("No puedes registrar pagos de un cargo anulado");
      const total = (await session.query<{ paid: string }>(
        `SELECT COALESCE(sum(amount_in_cents), 0)::text AS paid
         FROM accounting_supplier_payments WHERE bill_id = $1 AND site_id = $2 AND voided_at IS NULL`,
        [id, actor.siteId],
      )).rows[0]!;
      if (input.amountInCents > bill.amount_in_cents - Number(total.paid)) {
        throw new ConflictException("El pago supera el saldo pendiente");
      }
      let cashMovementId: string | null = null;
      if (input.source === "business_cash") {
        if (input.methodCode !== "CASH") throw new BadRequestException("Sólo el efectivo puede salir de caja");
        if (input.paidOn !== todayInMexico()) throw new BadRequestException("Los pagos desde caja deben registrarse con la fecha de hoy");
        const shift = await this.lockCashShift(session, actor);
        cashMovementId = await this.cashMovement(session, actor, shift.id, "out", input.amountInCents,
          `Pago: ${bill.supplier_name ?? "Gasto general"} · ${bill.description}`);
      }
      await session.query(
        `INSERT INTO accounting_supplier_payments (id, site_id, bill_id, amount_in_cents,
          method_code, source, paid_on, reference, cash_movement_id, created_by_user_id, created_on_terminal_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11)`,
        [randomUUID(), actor.siteId, id, input.amountInCents, input.methodCode, input.source,
          input.paidOn, this.text(input.reference, 160), cashMovementId, actor.userId, actor.terminalId],
      );
      await this.bumpBill(session, id, actor.siteId);
      const updated = (await this.readBills(session, actor.siteId, id))[0]!;
      await this.record(session, actor, "bill.payment_recorded", id, updated);
      return { status: 201, body: { bill: updated } };
    });
  }

  voidBill(id: string, input: VoidBillDto, key: string, actor: AuthContext) {
    return this.mutate("bill.void", { id, ...input }, key, actor, async (session) => {
      const current = await this.lockBill(session, id, input.expectedVersion, actor);
      if (current.voided_at) throw new ConflictException("El cargo ya fue anulado");
      const reason = this.text(input.reason, 240, true)!;
      const activePayments = await session.query(
        "SELECT id FROM accounting_supplier_payments WHERE site_id = $1 AND bill_id = $2 AND voided_at IS NULL LIMIT 1",
        [actor.siteId, id],
      );
      if (activePayments.rowCount > 0) throw new ConflictException("Anula primero los pagos activos de este cargo");
      await session.query(
        `UPDATE accounting_bills SET voided_at = now(), voided_by_user_id = $3, void_reason = $4,
          version = version + 1, updated_at = now() WHERE id = $1 AND site_id = $2`,
        [id, actor.siteId, actor.userId, reason],
      );
      const bill = (await this.readBills(session, actor.siteId, id))[0]!;
      await this.record(session, actor, "bill.voided", id, { before: current, bill }, reason);
      return { status: 201, body: { bill } };
    });
  }

  voidPayment(id: string, paymentId: string, input: VoidSupplierPaymentDto, key: string, actor: AuthContext) {
    return this.mutate("bill.payment.void", { id, paymentId, ...input }, key, actor, async (session) => {
      await this.lockBill(session, id, input.expectedVersion, actor);
      const reason = this.text(input.reason, 240, true)!;
      const payment = (await session.query<PaymentRow>(
        `SELECT *, paid_on::text FROM accounting_supplier_payments
         WHERE id = $1 AND bill_id = $2 AND site_id = $3 FOR UPDATE`,
        [paymentId, id, actor.siteId],
      )).rows[0];
      if (!payment) throw new NotFoundException("No existe el pago en este cargo");
      if (payment.voided_at) throw new ConflictException("El pago ya fue anulado");
      let reversalId: string | null = null;
      if (payment.cash_movement_id) {
        const movement = (await session.query<{ shift_id: string }>(
          "SELECT shift_id FROM cash_movements WHERE id = $1 AND site_id = $2",
          [payment.cash_movement_id, actor.siteId],
        )).rows[0]!;
        const shift = await this.lockCashShift(session, actor, movement.shift_id);
        reversalId = await this.cashMovement(session, actor, shift.id, "in", payment.amount_in_cents,
          `Anulación de pago a proveedor: ${reason}`);
      }
      await session.query(
        `UPDATE accounting_supplier_payments SET voided_at = now(), voided_by_user_id = $4,
          void_reason = $5, reversal_cash_movement_id = $6 WHERE id = $1 AND bill_id = $2 AND site_id = $3`,
        [paymentId, id, actor.siteId, actor.userId, reason, reversalId],
      );
      await this.bumpBill(session, id, actor.siteId);
      const bill = (await this.readBills(session, actor.siteId, id))[0]!;
      await this.record(session, actor, "bill.payment_voided", id, { paymentId, bill }, reason);
      return { status: 201, body: { bill } };
    });
  }

  async summary(input: AccountingSummaryQueryDto, actor: AuthContext) {
    const today = todayInMexico();
    const from = input.from ?? `${today.slice(0, 7)}-01`;
    const to = input.to ?? today;
    this.date(from); this.date(to);
    if (from > to) throw new BadRequestException("La fecha inicial debe ser igual o anterior a la final");
    const params = [actor.siteId, from, to];
    const [sales, refunds, payments, cash, pending] = await Promise.all([
      this.database.query<{ amount: string; count: string }>(
        `SELECT COALESCE(sum(total_in_cents),0)::text AS amount, count(*)::text AS count
         FROM sales_receipts WHERE site_id = $1
          AND (issued_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN $2::date AND $3::date`, params),
      this.database.query<{ amount: string }>(
        `SELECT COALESCE(sum(sale_in_cents),0)::text AS amount FROM sales_refunds
         WHERE site_id = $1 AND (created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN $2::date AND $3::date`, params),
      this.database.query<{ amount: string }>(
        // Anulaciones corrigen el registro histórico de paid_on; no son un egreso negativo del día de anulación.
        `SELECT COALESCE(sum(amount_in_cents),0)::text AS amount FROM accounting_supplier_payments
         WHERE site_id = $1 AND voided_at IS NULL AND paid_on BETWEEN $2::date AND $3::date`, params),
      this.database.query<{ amount: string }>(
        `SELECT COALESCE(sum(m.amount_in_cents),0)::text AS amount FROM cash_movements m
         WHERE m.site_id = $1 AND m.type = 'cash_out' AND m.refund_id IS NULL AND m.payment_id IS NULL
          AND (m.created_at AT TIME ZONE 'America/Mexico_City')::date BETWEEN $2::date AND $3::date
          AND NOT EXISTS (SELECT 1 FROM accounting_supplier_payments p
            WHERE p.cash_movement_id = m.id OR p.reversal_cash_movement_id = m.id)`, params),
      this.database.query<{ amount: string }>(
        `SELECT (COALESCE((SELECT sum(amount_in_cents) FROM accounting_bills WHERE site_id = $1 AND voided_at IS NULL),0)
          - COALESCE((SELECT sum(amount_in_cents) FROM accounting_supplier_payments WHERE site_id = $1 AND voided_at IS NULL),0))::text AS amount`,
        [actor.siteId]),
    ]);
    const grossInCents = Number(sales.rows[0]!.amount);
    const refundedInCents = Number(refunds.rows[0]!.amount);
    const supplierPaymentsInCents = Number(payments.rows[0]!.amount);
    const manualCashOutInCents = Number(cash.rows[0]!.amount);
    const totalInCents = supplierPaymentsInCents + manualCashOutInCents;
    const netInCents = grossInCents - refundedInCents;
    return { from, to,
      sales: { grossInCents, refundedInCents, netInCents, receiptCount: Number(sales.rows[0]!.count) },
      expenses: { supplierPaymentsInCents, manualCashOutInCents, totalInCents },
      balanceInCents: netInCents - totalInCents, outstandingInCents: Number(pending.rows[0]!.amount),
    };
  }

  private async readBills(session: DatabaseSession, siteId: string, id?: string) {
    const rows = await session.query<BillRow>(
      `SELECT b.*, b.issued_on::text, b.due_on::text, s.name AS supplier_name
       FROM accounting_bills b LEFT JOIN accounting_suppliers s ON s.id = b.supplier_id AND s.site_id = b.site_id
       WHERE b.site_id = $1 AND ($2::uuid IS NULL OR b.id = $2) ORDER BY b.issued_on DESC, b.created_at DESC, b.id`,
      [siteId, id ?? null],
    );
    const payments = await session.query<PaymentRow>(
      `SELECT *, paid_on::text FROM accounting_supplier_payments
       WHERE site_id = $1 AND ($2::uuid IS NULL OR bill_id = $2) ORDER BY created_at, id`,
      [siteId, id ?? null],
    );
    return rows.rows.map((bill) => {
      const history = payments.rows.filter((payment) => payment.bill_id === bill.id);
      const paidInCents = history.filter((payment) => !payment.voided_at)
        .reduce((sum, payment) => sum + payment.amount_in_cents, 0);
      return { id: bill.id, supplierId: bill.supplier_id, supplierName: bill.supplier_name,
        description: bill.description, amountInCents: bill.amount_in_cents,
        paidInCents, outstandingInCents: bill.voided_at ? 0 : bill.amount_in_cents - paidInCents,
        issuedOn: bill.issued_on, dueOn: bill.due_on, reference: bill.reference,
        version: bill.version, createdAt: new Date(bill.created_at).toISOString(),
        voidedAt: bill.voided_at ? new Date(bill.voided_at).toISOString() : null, voidReason: bill.void_reason,
        payments: history.map(paymentBody) };
    });
  }

  private async lockBill(session: DatabaseSession, id: string, expectedVersion: number, actor: AuthContext) {
    const row = (await session.query<BillRow>(
      `SELECT b.*, s.name AS supplier_name FROM accounting_bills b
       LEFT JOIN accounting_suppliers s ON s.id = b.supplier_id AND s.site_id = b.site_id
       WHERE b.site_id = $1 AND b.id = $2 FOR UPDATE OF b`, [actor.siteId, id],
    )).rows[0];
    if (!row) throw new NotFoundException("No existe el cargo");
    this.version(row.version, expectedVersion);
    return row;
  }

  private async lockCashShift(session: DatabaseSession, actor: AuthContext, shiftId?: string) {
    const shift = (await session.query<{ id: string }>(
      `SELECT id FROM cash_shifts WHERE site_id = $1 AND opened_on_terminal_id = $2
       AND status = 'open' AND ($3::uuid IS NULL OR id = $3) ORDER BY opened_at DESC LIMIT 1 FOR UPDATE`,
      [actor.siteId, actor.terminalId, shiftId ?? null],
    )).rows[0];
    if (!shift) throw new ConflictException(shiftId
      ? "Para anular este pago, su turno de caja debe seguir abierto en esta terminal"
      : "Abre un turno de caja en esta terminal o registra el pago fuera de caja");
    return shift;
  }

  private async cashMovement(session: DatabaseSession, actor: AuthContext, shiftId: string,
    direction: "in" | "out", amount: number, reason: string) {
    const id = randomUUID();
    await session.query(
      `INSERT INTO cash_movements (id, site_id, shift_id, type, direction, amount_in_cents,
        reason, created_by_user_id, created_on_terminal_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, actor.siteId, shiftId, direction === "out" ? "cash_out" : "cash_in",
        direction, amount, reason, actor.userId, actor.terminalId],
    );
    return id;
  }

  private bumpBill(session: DatabaseSession, id: string, siteId: string) {
    return session.query("UPDATE accounting_bills SET version = version + 1, updated_at = now() WHERE id = $1 AND site_id = $2", [id, siteId]);
  }

  private mutate<Body extends Record<string, unknown>>(scope: string, input: unknown, key: string,
    actor: AuthContext, work: (session: DatabaseSession) => Promise<{ status: number; body: Body }>) {
    return this.idempotency.execute({ siteId: actor.siteId, scope: `accounting.${scope}`, key, requestHash: requestHash(input) }, work);
  }

  private async record(session: DatabaseSession, actor: AuthContext, action: string, id: string,
    changes: Record<string, unknown>, reason?: string) {
    await this.audit.append(session, { id: randomUUID(), siteId: actor.siteId, actorUserId: actor.userId,
      terminalId: actor.terminalId, action: `accounting.${action}`, entityType: "accounting", entityId: id,
      changes, ...(reason ? { reason } : {}) });
    await this.outbox.enqueue(session, { id: randomUUID(), siteId: actor.siteId,
      eventType: "accounting.changed", aggregateType: "accounting", aggregateId: id, payload: { action, id } });
  }

  private text(value: string | null | undefined, maximum: number, required = false): string | null {
    if (value !== undefined && value !== null && typeof value !== "string") throw new BadRequestException("Texto inválido");
    const text = value?.trim() ?? "";
    if (text.length > maximum || (required && !text)) throw new BadRequestException("Captura un texto válido dentro de la longitud permitida");
    return text || null;
  }

  private money(value: number) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 100_000_000) throw new BadRequestException("Importe inválido");
  }

  private version(actual: number, expected: number) {
    if (!Number.isSafeInteger(expected) || expected < 0) throw new BadRequestException("Versión inválida");
    if (actual !== expected) throw new ConflictException("El registro cambió; actualiza antes de continuar");
  }

  private date(value: string) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) throw new BadRequestException("Fecha inválida: usa AAAA-MM-DD");
    const parsed = new Date(`${value}T12:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new BadRequestException("La fecha no existe");
  }
}
