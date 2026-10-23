import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AccountsService } from "../accounts/accounts.service.js";
import { AuditService } from "../audit/audit.service.js";
import { DATABASE, type DatabasePort, type DatabaseRow, type DatabaseSession } from "../database/database.port.js";
import { IdempotencyService, requestHash } from "../idempotency/idempotency.service.js";
import type { AuthContext } from "../security/auth-context.js";
import type {
  CreateDeliveryAssignmentDto, CreateDeliveryDriverDto, DeliveryVersionDto,
  RefreshDeliveryAssignmentDto, UpdateDeliveryStatusDto,
} from "./dto/delivery.dto.js";

type DeliveryStatus = UpdateDeliveryStatusDto["status"];
type Account = Awaited<ReturnType<AccountsService["readAccount"]>>;

export interface DriverRow extends DatabaseRow {
  id: string;
  name: string;
  phone: string | null;
  active: boolean;
}

interface AssignmentRow extends DatabaseRow {
  id: string;
  site_id: string;
  account_id: string;
  driver_id: string;
  driver_name: string;
  driver_phone: string | null;
  status: DeliveryStatus;
  version: number;
  account_version: number;
  current_account_version: number;
  current_account_status: string;
  current_account_has_active_items: boolean;
  current_receipt_status: string | null;
  customer_name: string | null;
  phone: string | null;
  address: string;
  notes: string | null;
  snapshot: ReturnType<typeof accountSnapshot>;
  share_expires_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const text = (value: unknown, maximum: number, label: string, required = false): string | null => {
  if (value == null && !required) return null;
  if (typeof value !== "string" || value.length > maximum || (required && !value.trim())) {
    throw new BadRequestException(`${label} debe tener ${required ? "entre 1 y" : "hasta"} ${maximum} caracteres`);
  }
  return value.trim() || null;
};

const accountSnapshot = (account: Account) => ({
  accountId: account.id,
  label: account.reference || account.tableName || `Pedido ${account.id.slice(0, 8)}`,
  customerName: account.customerName,
  accountVersion: account.version,
  reference: account.reference,
  serviceType: account.serviceType,
  accountStatus: account.status,
  scheduledFor: account.scheduledFor,
  scheduleDispatchedAt: account.scheduleDispatchedAt,
  totalInCents: account.totalInCents,
  items: account.items.filter((item) => item.preparationState !== "cancelled").map((item) => ({
    id: item.id,
    productName: item.productName,
    quantity: item.quantity,
    note: item.note,
    preparationState: item.preparationState,
    lineTotalInCents: item.lineTotalInCents,
    modifiers: item.modifiers.map((modifier) => modifier.quantity > 1 ? `${modifier.name} ×${modifier.quantity}` : modifier.name),
  })),
});

const selectAssignments = `SELECT a.*, d.name AS driver_name, d.phone AS driver_phone,
  accounts.version AS current_account_version, accounts.status AS current_account_status,
  receipts.status AS current_receipt_status,
  EXISTS (
    SELECT 1 FROM order_items items
      WHERE items.account_id = accounts.id AND items.site_id = a.site_id
        AND items.preparation_state <> 'cancelled'
  ) AS current_account_has_active_items
  FROM delivery_assignments a
  JOIN delivery_drivers d ON d.id = a.driver_id AND d.site_id = a.site_id
  JOIN service_accounts accounts ON accounts.id = a.account_id AND accounts.site_id = a.site_id
  LEFT JOIN sales_receipts receipts ON receipts.account_id = accounts.id AND receipts.site_id = a.site_id`;

const date = (value: Date | string) => new Date(value).toISOString();
const cannotDeliver = (row: AssignmentRow) => ["cancelled", "merged"].includes(row.current_account_status)
  || ["cancelled", "refunded"].includes(row.current_receipt_status ?? "")
  || !row.current_account_has_active_items;
const cancelledSaleMessage = "La cuenta o venta está cancelada o reembolsada y no se puede repartir";
const unavailableMessage = (row: AssignmentRow) => row.current_account_has_active_items
  ? cancelledSaleMessage : "La cuenta ya no tiene artículos para repartir; cancela este reparto";
const changed = (row: AssignmentRow) => row.account_version !== row.current_account_version
  || cannotDeliver(row);
const present = (row: AssignmentRow) => ({
  id: row.id,
  accountId: row.account_id,
  driverId: row.driver_id,
  driverName: row.driver_name,
  driverPhone: row.driver_phone,
  status: row.status,
  version: row.version,
  accountVersion: row.account_version,
  accountChanged: changed(row),
  accountUnavailable: cannotDeliver(row),
  customerName: row.customer_name,
  phone: row.phone,
  address: row.address,
  notes: row.notes,
  snapshot: row.snapshot,
  shareExpiresAt: row.share_expires_at ? date(row.share_expires_at) : null,
  createdAt: date(row.created_at),
  updatedAt: date(row.updated_at),
});

@Injectable()
export class DeliveryService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabasePort,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(AccountsService) private readonly accounts: AccountsService,
  ) {}

  private requireManage(actor: AuthContext) {
    if (!actor.permissions.includes("delivery.manage")) throw new ForbiddenException("Permiso insuficiente");
  }

  async drivers(actor: AuthContext) {
    this.requireManage(actor);
    const result = await this.database.query<DriverRow>(
      "SELECT id, name, phone, active FROM delivery_drivers WHERE site_id = $1 AND active = true ORDER BY name, id",
      [actor.siteId],
    );
    return { drivers: result.rows };
  }

  createDriver(input: CreateDeliveryDriverDto, key: string, actor: AuthContext) {
    this.requireManage(actor);
    const name = text(input.name, 80, "El nombre", true)!;
    const phone = text(input.phone, 40, "El teléfono");
    return this.idempotency.execute({
      siteId: actor.siteId, scope: "delivery.driver.create", key, requestHash: requestHash(input),
    }, async (transaction) => {
      const id = randomUUID();
      await transaction.query(
        "INSERT INTO delivery_drivers (id, site_id, name, phone) VALUES ($1, $2, $3, $4)",
        [id, actor.siteId, name, phone],
      );
      await this.record(transaction, actor, "delivery.driver.created", "delivery_driver", id, { name, phone });
      return { status: 201, body: { driver: { id, name, phone, active: true } } };
    });
  }

  async assignments(actor: AuthContext) {
    this.requireManage(actor);
    const result = await this.database.query<AssignmentRow>(
      `${selectAssignments} WHERE a.site_id = $1
       ORDER BY CASE WHEN a.status IN ('assigned', 'out_for_delivery') THEN 0 ELSE 1 END,
       a.created_at DESC, a.id LIMIT 200`,
      [actor.siteId],
    );
    return { assignments: result.rows.map(present) };
  }

  createAssignment(input: CreateDeliveryAssignmentDto, key: string, actor: AuthContext) {
    this.requireManage(actor);
    const customerName = text(input.customerName, 80, "El cliente");
    const phone = text(input.phone, 40, "El teléfono");
    const address = text(input.address, 500, "La dirección", true)!;
    const notes = text(input.notes, 1000, "Las indicaciones");
    return this.idempotency.execute({
      siteId: actor.siteId, scope: "delivery.assignment.create", key, requestHash: requestHash(input),
    }, async (transaction) => {
      const account = await this.lockAccount(transaction, input.accountId, input.expectedAccountVersion, actor.siteId);
      const driver = await transaction.query<DriverRow>(
        "SELECT id, name, phone, active FROM delivery_drivers WHERE id = $1 AND site_id = $2 AND active = true",
        [input.driverId, actor.siteId],
      );
      if (!driver.rows[0]) throw new NotFoundException("Repartidor inexistente");
      const existing = await transaction.query(
        "SELECT id FROM delivery_assignments WHERE account_id = $1 AND site_id = $2 AND status IN ('assigned', 'out_for_delivery')",
        [input.accountId, actor.siteId],
      );
      if (existing.rowCount) throw new ConflictException("La comanda ya tiene un reparto activo; cancélalo para reasignarla");
      const id = randomUUID();
      await transaction.query(
        `INSERT INTO delivery_assignments (
          id, site_id, account_id, driver_id, account_version, customer_name, phone, address, notes,
          snapshot, created_by_user_id, created_on_terminal_id, customer_name_follows_account
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)`,
        [id, actor.siteId, account.id, input.driverId, account.version,
          customerName ?? account.customerName, phone, address, notes,
          JSON.stringify(accountSnapshot(account)), actor.userId, actor.terminalId,
          customerName === null || customerName === account.customerName],
      );
      await this.record(transaction, actor, "delivery.assigned", "delivery_assignment", id, {
        accountId: account.id, accountVersion: account.version, driverId: input.driverId,
      });
      return { status: 201, body: { assignment: present(await this.readAssignment(transaction, id, actor.siteId)) } };
    });
  }

  updateStatus(id: string, input: UpdateDeliveryStatusDto, key: string, actor: AuthContext) {
    this.requireManage(actor);
    return this.idempotency.execute({
      siteId: actor.siteId, scope: `delivery.status:${id}`, key, requestHash: requestHash(input),
    }, async (transaction) => {
      const assignment = await this.lockAssignment(transaction, id, actor.siteId, input.expectedVersion);
      const allowed: Record<DeliveryStatus, DeliveryStatus[]> = {
        assigned: ["out_for_delivery", "delivered", "cancelled"],
        out_for_delivery: ["delivered", "cancelled"], delivered: [], cancelled: [],
      };
      if (!allowed[assignment.status].includes(input.status)) throw new ConflictException("El cambio de estado de reparto no es válido");
      if (input.status !== "cancelled" && cannotDeliver(assignment)) {
        throw new ConflictException(unavailableMessage(assignment));
      }
      if (input.status !== "cancelled" && changed(assignment)) {
        throw new ConflictException("La comanda cambió; actualiza el reparto y comparte un enlace nuevo");
      }
      await transaction.query(
        `UPDATE delivery_assignments SET status = $3, version = version + 1, updated_at = now(),
          share_token_hash = CASE WHEN $3 = 'cancelled' THEN NULL ELSE share_token_hash END,
          share_expires_at = CASE WHEN $3 = 'cancelled' THEN NULL ELSE share_expires_at END
          WHERE id = $1 AND site_id = $2`,
        [id, actor.siteId, input.status],
      );
      await this.record(transaction, actor, "delivery.status.updated", "delivery_assignment", id, {
        previousStatus: assignment.status, status: input.status,
      });
      return { status: 200, body: { assignment: present(await this.readAssignment(transaction, id, actor.siteId)) } };
    });
  }

  refresh(id: string, input: RefreshDeliveryAssignmentDto, key: string, actor: AuthContext) {
    this.requireManage(actor);
    return this.idempotency.execute({
      siteId: actor.siteId, scope: `delivery.refresh:${id}`, key, requestHash: requestHash(input),
    }, async (transaction) => {
      const assignment = await this.lockAssignment(transaction, id, actor.siteId, input.expectedVersion);
      if (assignment.status === "cancelled") {
        throw new ConflictException("No se puede actualizar un reparto cancelado");
      }
      const account = await this.lockAccount(transaction, assignment.account_id, input.expectedAccountVersion, actor.siteId);
      await transaction.query(
        `UPDATE delivery_assignments SET snapshot = $3::jsonb, account_version = $4,
          customer_name = CASE WHEN customer_name_follows_account THEN $5 ELSE customer_name END,
          version = version + 1, updated_at = now(), share_token_hash = NULL, share_expires_at = NULL
          WHERE id = $1 AND site_id = $2`,
        [id, actor.siteId, JSON.stringify(accountSnapshot(account)), account.version, account.customerName],
      );
      await this.record(transaction, actor, "delivery.snapshot.updated", "delivery_assignment", id, {
        accountVersion: account.version,
      });
      return { status: 200, body: { assignment: present(await this.readAssignment(transaction, id, actor.siteId)) } };
    });
  }

  // Deliberately not stored in idempotency responses: only the hash reaches the database.
  async share(id: string, input: DeliveryVersionDto, actor: AuthContext) {
    this.requireManage(actor);
    return this.database.transaction(async (transaction) => {
      const assignment = await this.lockAssignment(transaction, id, actor.siteId, input.expectedVersion);
      if (assignment.status === "cancelled") throw new ConflictException("El reparto está cancelado");
      if (cannotDeliver(assignment)) throw new ConflictException(unavailableMessage(assignment));
      if (changed(assignment)) throw new ConflictException("La comanda cambió; actualiza el reparto antes de compartir");
      const token = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const result = await transaction.query<{ version: number; share_expires_at: Date | string }>(
        `UPDATE delivery_assignments SET share_token_hash = $3,
          share_expires_at = now() + interval '72 hours', version = version + 1, updated_at = now()
          WHERE id = $1 AND site_id = $2 RETURNING version, share_expires_at`,
        [id, actor.siteId, tokenHash],
      );
      await this.record(transaction, actor, "delivery.link.rotated", "delivery_assignment", id, {});
      return { token, expiresAt: date(result.rows[0]!.share_expires_at), version: result.rows[0]!.version };
    });
  }

  async shared(token: string | undefined) {
    // A fixed-length opaque capability grants access to exactly one assignment.
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new NotFoundException("Enlace de reparto inválido o vencido");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const result = await this.database.query<AssignmentRow>(
      `${selectAssignments} WHERE a.share_token_hash = $1 AND a.share_expires_at > now()
       AND a.status <> 'cancelled'`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (row && cannotDeliver(row)) throw new NotFoundException(unavailableMessage(row));
    if (!row || changed(row)) throw new NotFoundException("Enlace de reparto inválido, vencido o actualizado; solicita uno nuevo");
    return { assignment: {
      id: row.id,
      driverName: row.driver_name,
      status: row.status,
      version: row.version,
      customerName: row.customer_name,
      phone: row.phone,
      address: row.address,
      notes: row.notes,
      snapshot: row.snapshot,
      expiresAt: date(row.share_expires_at!),
      updatedAt: date(row.updated_at),
    } };
  }

  private async lockAccount(transaction: DatabaseSession, id: string, expectedVersion: number, siteId: string) {
    const locked = await transaction.query(
      "SELECT id FROM service_accounts WHERE id = $1 AND site_id = $2 FOR UPDATE",
      [id, siteId],
    );
    if (!locked.rowCount) throw new NotFoundException("Cuenta inexistente");
    const receipt = await this.lockReceipt(transaction, id, siteId);
    if (receipt && ["cancelled", "refunded"].includes(receipt.status)) {
      throw new ConflictException(cancelledSaleMessage);
    }
    const account = await this.accounts.readAccount(transaction, id, siteId);
    if (account.version !== expectedVersion) throw new ConflictException("La cuenta cambió; vuelve a cargarla");
    if (["cancelled", "merged"].includes(account.status)) throw new ConflictException(cancelledSaleMessage);
    if (!account.items.some((item) => item.preparationState !== "cancelled")) {
      throw new ConflictException("No se puede repartir una comanda vacía");
    }
    return account;
  }

  private async lockAssignment(transaction: DatabaseSession, id: string, siteId: string, expectedVersion: number) {
    const locked = await transaction.query<{ account_id: string }>(
      "SELECT account_id FROM delivery_assignments WHERE id = $1 AND site_id = $2 FOR UPDATE",
      [id, siteId],
    );
    if (!locked.rowCount) throw new NotFoundException("Reparto inexistente");
    const accountId = locked.rows[0]!.account_id;
    // Account edits and receipt cancellations must serialize with sharing and
    // dispatching a delivery, while cancellation of the delivery remains allowed.
    await transaction.query(
      "SELECT id FROM service_accounts WHERE id = $1 AND site_id = $2 FOR UPDATE",
      [accountId, siteId],
    );
    await this.lockReceipt(transaction, accountId, siteId);
    const row = await this.readAssignment(transaction, id, siteId);
    if (row.version !== expectedVersion) throw new ConflictException("El reparto cambió; vuelve a cargarlo");
    return row;
  }

  private async lockReceipt(transaction: DatabaseSession, accountId: string, siteId: string) {
    return (await transaction.query<{ status: string }>(
      "SELECT status FROM sales_receipts WHERE account_id = $1 AND site_id = $2 FOR UPDATE",
      [accountId, siteId],
    )).rows[0];
  }

  private async readAssignment(transaction: DatabaseSession, id: string, siteId: string) {
    const result = await transaction.query<AssignmentRow>(
      `${selectAssignments} WHERE a.id = $1 AND a.site_id = $2`, [id, siteId],
    );
    if (!result.rows[0]) throw new NotFoundException("Reparto inexistente");
    return result.rows[0];
  }

  private record(transaction: DatabaseSession, actor: AuthContext, action: string, entityType: string, id: string, changes: Record<string, unknown>) {
    return this.audit.append(transaction, {
      id: randomUUID(), siteId: actor.siteId, actorUserId: actor.userId, terminalId: actor.terminalId,
      action, entityType, entityId: id, changes,
    });
  }
}
