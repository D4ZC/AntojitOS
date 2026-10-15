import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { calculateSaleTotals } from "@antojit-os/domain";
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
import { ProductionService } from "../production/production.service.js";
import type { AuthContext } from "../security/auth-context.js";
import type { AddOrderItemDto } from "./dto/add-order-item.dto.js";
import type { ApplyAccountAdjustmentDto } from "./dto/apply-account-adjustment.dto.js";
import type { CancelAccountDto } from "./dto/cancel-account.dto.js";
import type { CancelOrderItemDto } from "./dto/cancel-order-item.dto.js";
import type { CreatePrecheckDto } from "./dto/create-precheck.dto.js";
import type { MergeAccountDto } from "./dto/merge-account.dto.js";
import type { OpenAccountDto } from "./dto/open-account.dto.js";
import type { SendRoundDto } from "./dto/send-round.dto.js";
import type { SplitAccountDto } from "./dto/split-account.dto.js";
import type { TransferAccountItemsDto } from "./dto/transfer-account-items.dto.js";
import type { UpdateAccountContextDto } from "./dto/update-account-context.dto.js";
import type { UpdateOrderItemDto } from "./dto/update-order-item.dto.js";
import type { VoidAccountAdjustmentDto } from "./dto/void-account-adjustment.dto.js";

interface AccountRow extends DatabaseRow {
  id: string;
  site_id: string;
  table_id: string | null;
  table_name: string | null;
  service_type: "table" | "quick" | "takeaway";
  status: string;
  reference: string | null;
  guest_count: number;
  version: number;
  responsible_user_id: string;
  responsible_user_name: string | null;
  account_group_id: string;
  is_primary: boolean;
  opened_at: Date | string;
}

interface ItemRow extends DatabaseRow {
  id: string;
  product_id: string;
  product_name: string;
  product_code: string;
  unit_price_in_cents: number;
  tax_rate_basis_points: number;
  tax_included: boolean;
  quantity: number;
  note: string | null;
  preparation_state: string;
  round_id: string | null;
  modifier_total_in_cents: number;
}

interface ItemModifierRow extends DatabaseRow {
  order_item_id: string;
  id: string;
  modifier_id: string;
  modifier_name: string;
  price_delta_in_cents: number;
  quantity: number;
}

interface ProductRow extends DatabaseRow {
  id: string;
  code: string;
  name: string;
  production_center_id: string | null;
  price_in_cents: number;
  rate_basis_points: number;
  price_includes_tax: boolean;
}

interface ModifierRow extends DatabaseRow {
  group_id: string;
  group_name: string;
  minimum_selections: number;
  maximum_selections: number;
  modifier_id: string;
  modifier_name: string;
  price_delta_in_cents: number;
  available: boolean;
}

interface RoundItemRow extends DatabaseRow {
  id: string;
  product_name: string;
  quantity: number;
  note: string | null;
  production_center_id: string | null;
}

interface AdjustmentRow extends DatabaseRow {
  id: string;
  kind: "discount" | "courtesy";
  calculation: "percentage" | "fixed";
  value: number;
  reason: string;
  created_at: Date | string;
}

interface TransferableItemRow extends DatabaseRow {
  id: string;
  quantity: number;
}

const assertAccountMutable = (account: AccountRow | undefined): AccountRow => {
  if (!account) {
    throw new ConflictException(
      "La cuenta cambió, está cerrada o pertenece a otra sucursal",
    );
  }
  return account;
};

@Injectable()
export class AccountsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabasePort,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(ProductionService) private readonly production: ProductionService,
  ) {}

  async get(accountId: string, actor: AuthContext) {
    return this.readAccount(this.database, accountId, actor.siteId);
  }

  private async readAccount(
    session: DatabaseSession,
    accountId: string,
    siteId: string,
  ) {
    const accountResult = await session.query<AccountRow>(
      `SELECT
         accounts.id, accounts.site_id, accounts.table_id, tables.name AS table_name,
         accounts.service_type, accounts.status, accounts.reference,
         accounts.guest_count, accounts.version, accounts.opened_at,
         accounts.responsible_user_id, users.display_name AS responsible_user_name,
         accounts.account_group_id, accounts.is_primary
       FROM service_accounts accounts
       LEFT JOIN service_tables tables ON tables.id = accounts.table_id
       JOIN app_users users ON users.id = accounts.responsible_user_id
       WHERE accounts.id = $1 AND accounts.site_id = $2`,
      [accountId, siteId],
    );
    const account = accountResult.rows[0];
    if (!account) throw new NotFoundException("Cuenta inexistente");

    const [itemsResult, modifiersResult, adjustmentsResult] = await Promise.all([
      session.query<ItemRow>(
        `SELECT
           items.id, items.product_id, items.product_name, items.product_code,
           items.unit_price_in_cents, items.tax_rate_basis_points,
           items.tax_included, items.quantity, items.note,
           items.preparation_state, items.round_id,
           COALESCE(sum(modifiers.price_delta_in_cents * modifiers.quantity), 0)::integer
             AS modifier_total_in_cents
         FROM order_items items
         LEFT JOIN order_item_modifiers modifiers ON modifiers.order_item_id = items.id
         WHERE items.account_id = $1 AND items.site_id = $2
         GROUP BY items.id
         ORDER BY items.created_at, items.id`,
        [accountId, siteId],
      ),
      session.query<ItemModifierRow>(
        `SELECT
           order_item_id, id, modifier_id, modifier_name,
           price_delta_in_cents, quantity
         FROM order_item_modifiers
         WHERE order_item_id IN (
           SELECT id FROM order_items WHERE account_id = $1 AND site_id = $2
         )
         ORDER BY id`,
        [accountId, siteId],
      ),
      session.query<AdjustmentRow>(
        `SELECT id, kind, calculation, value, reason, created_at
           FROM account_adjustments
          WHERE account_id = $1 AND site_id = $2 AND status = 'active'
          ORDER BY created_at, id`,
        [accountId, siteId],
      ),
    ]);

    const itemSnapshots = itemsResult.rows.map((item) => ({
      id: item.id,
      productId: item.product_id,
      productName: item.product_name,
      productCode: item.product_code,
      unitPriceInCents: item.unit_price_in_cents,
      modifierTotalInCents: item.modifier_total_in_cents,
      taxRateBasisPoints: item.tax_rate_basis_points,
      taxIncluded: item.tax_included,
      quantity: item.quantity,
      note: item.note,
      preparationState: item.preparation_state,
      roundId: item.round_id,
      modifiers: modifiersResult.rows
        .filter((modifier) => modifier.order_item_id === item.id)
        .map((modifier) => ({
          id: modifier.id,
          modifierId: modifier.modifier_id,
          name: modifier.modifier_name,
          priceDeltaInCents: modifier.price_delta_in_cents,
          quantity: modifier.quantity,
        })),
    }));
    const totals = calculateSaleTotals(
      itemSnapshots.map((item) => ({
        id: item.id,
        unitPriceInCents: item.unitPriceInCents,
        modifierTotalInCents: item.modifierTotalInCents,
        quantity: item.quantity,
        taxRateBasisPoints: item.taxRateBasisPoints,
        taxIncluded: item.taxIncluded,
        cancelled: item.preparationState === "cancelled",
      })),
      adjustmentsResult.rows.map((adjustment) => ({
        id: adjustment.id,
        kind: adjustment.kind,
        calculation: adjustment.calculation,
        value: adjustment.value,
      })),
    );
    const calculatedLines = new Map(totals.lines.map((line) => [line.id, line]));
    const items = itemSnapshots.map((item) => {
      const calculated = calculatedLines.get(item.id)!;
      return {
        ...item,
        adjustmentInCents: calculated.adjustmentInCents,
        taxInCents: calculated.taxInCents,
        lineTotalInCents: calculated.totalInCents,
      };
    });

    return {
      id: account.id,
      tableId: account.table_id,
      tableName: account.table_name,
      serviceType: account.service_type,
      status: account.status,
      reference: account.reference,
      guestCount: account.guest_count,
      version: account.version,
      accountGroupId: account.account_group_id,
      isPrimary: account.is_primary,
      responsible: {
        id: account.responsible_user_id,
        displayName: account.responsible_user_name ?? "Sin responsable",
      },
      openedAt: new Date(account.opened_at).toISOString(),
      items,
      adjustments: adjustmentsResult.rows.map((adjustment) => ({
        id: adjustment.id,
        kind: adjustment.kind,
        calculation: adjustment.calculation,
        value: adjustment.value,
        reason: adjustment.reason,
        createdAt: new Date(adjustment.created_at).toISOString(),
        appliedInCents: totals.adjustments.find(
          (calculated) => calculated.id === adjustment.id,
        )?.appliedInCents ?? 0,
      })),
      totals: {
        itemTotalInCents: totals.itemTotalInCents,
        subtotalInCents: totals.subtotalInCents,
        discountInCents: totals.discountInCents,
        adjustmentTotalInCents: totals.adjustmentTotalInCents,
        taxInCents: totals.taxInCents,
        totalInCents: totals.totalInCents,
      },
      totalInCents: totals.totalInCents,
    };
  }

  open(input: OpenAccountDto, key: string, actor: AuthContext) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: "account.open",
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        if (input.serviceType === "table") {
          if (!input.tableId) {
            throw new BadRequestException("Se requiere mesa para este servicio");
          }
          const table = await transaction.query(
            `SELECT id FROM service_tables
              WHERE id = $1 AND site_id = $2 AND active
              FOR UPDATE`,
            [input.tableId, actor.siteId],
          );
          if (table.rowCount === 0) throw new NotFoundException("Mesa inexistente");
          const occupied = await transaction.query(
            `SELECT id FROM service_accounts
              WHERE table_id = $1 AND site_id = $2
                AND status IN ('open', 'awaiting_payment')
              LIMIT 1
              FOR UPDATE`,
            [input.tableId, actor.siteId],
          );
          if (occupied.rowCount > 0) {
            throw new ConflictException("La mesa ya tiene una cuenta abierta");
          }
        } else if (input.tableId) {
          throw new BadRequestException("Este tipo de servicio no utiliza mesa");
        }

        const id = randomUUID();
        try {
          await transaction.query(
            `INSERT INTO service_accounts (
              id, site_id, table_id, service_type, reference, guest_count,
              opened_by_user_id, opened_on_terminal_id, responsible_user_id,
              account_group_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $7, $1)`,
            [
              id,
              actor.siteId,
              input.tableId ?? null,
              input.serviceType,
              input.reference ?? null,
              input.guestCount,
              actor.userId,
              actor.terminalId,
            ],
          );
        } catch (error) {
          if ((error as { code?: string }).code === "23505") {
            throw new ConflictException("La mesa ya tiene una cuenta abierta");
          }
          throw error;
        }

        const body = {
          id,
          tableId: input.tableId ?? null,
          serviceType: input.serviceType,
          reference: input.reference ?? null,
          guestCount: input.guestCount,
          status: "open",
          version: 0,
        };
        await this.audit.append(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          actorUserId: actor.userId,
          terminalId: actor.terminalId,
          action: "account.opened",
          entityType: "service_account",
          entityId: id,
          changes: body,
        });
        await this.outbox.enqueue(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          eventType: "account.opened",
          aggregateType: "service_account",
          aggregateId: id,
          payload: body,
        });

        return { status: 201, body };
      },
    );
  }

  addItem(
    accountId: string,
    input: AddOrderItemDto,
    key: string,
    actor: AuthContext,
  ) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: `account.add-item:${accountId}`,
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        const account = await this.lockAccount(
          transaction,
          accountId,
          actor.siteId,
          input.expectedVersion,
        );
        const productResult = await transaction.query<ProductRow>(
          `SELECT
             products.id, products.code, products.name,
             products.production_center_id, prices.price_in_cents,
             taxes.rate_basis_points, taxes.price_includes_tax
           FROM products
           JOIN product_prices prices
             ON prices.product_id = products.id
            AND prices.site_id = products.site_id
            AND prices.price_list_code = 'DEFAULT'
            AND prices.active
           JOIN tax_rules taxes ON taxes.id = products.tax_rule_id AND taxes.active
           WHERE products.id = $1 AND products.site_id = $2
             AND products.active AND products.available`,
          [input.productId, actor.siteId],
        );
        const product = productResult.rows[0];
        if (!product) throw new NotFoundException("Producto no disponible");

        const selectedModifiers = await this.validateModifiers(
          transaction,
          input.productId,
          actor.siteId,
          input.modifierIds ?? [],
        );
        const itemId = randomUUID();
        await transaction.query(
          `INSERT INTO order_items (
            id, site_id, account_id, product_id, product_name, product_code,
            production_center_id, unit_price_in_cents, tax_rate_basis_points,
            tax_included, quantity, note, created_by_user_id,
            created_on_terminal_id
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
          )`,
          [
            itemId,
            actor.siteId,
            account.id,
            product.id,
            product.name,
            product.code,
            product.production_center_id,
            product.price_in_cents,
            product.rate_basis_points,
            product.price_includes_tax,
            input.quantity,
            input.note ?? null,
            actor.userId,
            actor.terminalId,
          ],
        );
        for (const modifier of selectedModifiers) {
          await transaction.query(
            `INSERT INTO order_item_modifiers (
              id, site_id, order_item_id, modifier_id, modifier_name,
              price_delta_in_cents, quantity
            ) VALUES ($1, $2, $3, $4, $5, $6, 1)`,
            [
              randomUUID(),
              actor.siteId,
              itemId,
              modifier.modifier_id,
              modifier.modifier_name,
              modifier.price_delta_in_cents,
            ],
          );
        }
        const nextVersion = account.version + 1;
        await transaction.query(
          `UPDATE service_accounts
              SET version = $3, updated_at = now()
            WHERE id = $1 AND site_id = $2`,
          [accountId, actor.siteId, nextVersion],
        );

        const body = {
          item: {
            id: itemId,
            productId: product.id,
            productName: product.name,
            unitPriceInCents: product.price_in_cents,
            quantity: input.quantity,
            note: input.note ?? null,
            preparationState: "pending",
            modifiers: selectedModifiers.map((modifier) => ({
              id: modifier.modifier_id,
              name: modifier.modifier_name,
              priceDeltaInCents: modifier.price_delta_in_cents,
            })),
          },
          accountVersion: nextVersion,
        };
        await this.audit.append(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          actorUserId: actor.userId,
          terminalId: actor.terminalId,
          action: "order_item.added",
          entityType: "service_account",
          entityId: accountId,
          changes: body,
        });
        await this.outbox.enqueue(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          eventType: "account.updated",
          aggregateType: "service_account",
          aggregateId: accountId,
          payload: body,
        });

        return { status: 201, body };
      },
    );
  }

  updateItem(
    accountId: string,
    itemId: string,
    input: UpdateOrderItemDto,
    key: string,
    actor: AuthContext,
  ) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: `account.update-item:${accountId}:${itemId}`,
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        const account = await this.lockAccount(
          transaction,
          accountId,
          actor.siteId,
          input.expectedVersion,
        );
        const item = await transaction.query<{ id: string }>(
          `UPDATE order_items
              SET quantity = $4, note = $5, updated_at = now()
            WHERE id = $1 AND account_id = $2 AND site_id = $3
              AND preparation_state = 'pending'
          RETURNING id`,
          [itemId, accountId, actor.siteId, input.quantity, input.note ?? null],
        );
        if (item.rowCount === 0) {
          throw new ConflictException("Sólo se pueden modificar artículos pendientes");
        }
        const nextVersion = account.version + 1;
        await transaction.query(
          `UPDATE service_accounts
              SET version = $3, updated_at = now()
            WHERE id = $1 AND site_id = $2`,
          [accountId, actor.siteId, nextVersion],
        );
        const body = {
          itemId,
          quantity: input.quantity,
          note: input.note ?? null,
          accountVersion: nextVersion,
        };
        await this.audit.append(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          actorUserId: actor.userId,
          terminalId: actor.terminalId,
          action: "order_item.updated",
          entityType: "service_account",
          entityId: accountId,
          changes: body,
        });
        await this.outbox.enqueue(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          eventType: "account.updated",
          aggregateType: "service_account",
          aggregateId: accountId,
          payload: body,
        });
        return { status: 200, body };
      },
    );
  }

  sendRound(
    accountId: string,
    input: SendRoundDto,
    key: string,
    actor: AuthContext,
  ) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: `account.send-round:${accountId}`,
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        const account = await this.lockAccount(
          transaction,
          accountId,
          actor.siteId,
          input.expectedVersion,
        );
        const pending = await transaction.query<RoundItemRow>(
          `SELECT id, product_name, quantity, note, production_center_id
             FROM order_items
            WHERE account_id = $1 AND site_id = $2
              AND preparation_state = 'pending'
            ORDER BY created_at, id
            FOR UPDATE`,
          [accountId, actor.siteId],
        );
        if (pending.rowCount === 0) {
          throw new ConflictException("La cuenta no tiene artículos pendientes");
        }
        const sequenceResult = await transaction.query<{ next_sequence: number }>(
          `SELECT COALESCE(max(sequence), 0)::integer + 1 AS next_sequence
             FROM order_rounds WHERE account_id = $1`,
          [accountId],
        );
        const sequence = sequenceResult.rows[0]?.next_sequence ?? 1;
        const roundId = randomUUID();
        await transaction.query(
          `INSERT INTO order_rounds (
            id, site_id, account_id, sequence, sent_by_user_id,
            sent_on_terminal_id
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            roundId,
            actor.siteId,
            accountId,
            sequence,
            actor.userId,
            actor.terminalId,
          ],
        );
        await transaction.query(
          `UPDATE order_items
              SET round_id = $3, preparation_state = 'sent', updated_at = now()
            WHERE account_id = $1 AND site_id = $2
              AND preparation_state = 'pending'`,
          [accountId, actor.siteId, roundId],
        );
        const nextVersion = account.version + 1;
        await transaction.query(
          `UPDATE service_accounts
              SET version = $3, updated_at = now()
            WHERE id = $1 AND site_id = $2`,
          [accountId, actor.siteId, nextVersion],
        );
        const production = await this.production.planRound(transaction, {
          siteId: actor.siteId,
          accountId,
          roundId,
          roundSequence: sequence,
        });
        const body = {
          roundId,
          sequence,
          accountVersion: nextVersion,
          production,
          items: pending.rows.map((item) => ({
            id: item.id,
            productName: item.product_name,
            quantity: item.quantity,
            note: item.note,
            productionCenterId: item.production_center_id,
          })),
        };
        await this.audit.append(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          actorUserId: actor.userId,
          terminalId: actor.terminalId,
          action: "order_round.sent",
          entityType: "service_account",
          entityId: accountId,
          changes: { roundId, sequence, itemCount: pending.rowCount },
        });
        await this.outbox.enqueue(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          eventType: "order.round.submitted",
          aggregateType: "service_account",
          aggregateId: accountId,
          payload: body,
        });

        return { status: 201, body };
      },
    );
  }

  cancelItem(
    accountId: string,
    itemId: string,
    input: CancelOrderItemDto,
    key: string,
    actor: AuthContext,
  ) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: `account.cancel-item:${accountId}:${itemId}`,
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        const account = await this.lockAccount(
          transaction,
          accountId,
          actor.siteId,
          input.expectedVersion,
        );
        const itemResult = await transaction.query<{
          id: string;
          product_name: string;
          preparation_state: string;
          round_id: string | null;
        }>(
          `SELECT id, product_name, preparation_state, round_id
             FROM order_items
            WHERE id = $1 AND account_id = $2 AND site_id = $3
            FOR UPDATE`,
          [itemId, accountId, actor.siteId],
        );
        const item = itemResult.rows[0];
        if (!item) throw new NotFoundException("Artículo inexistente");
        if (!["pending", "sent"].includes(item.preparation_state)) {
          throw new ConflictException("El artículo ya no se puede cancelar");
        }
        if (item.preparation_state === "sent" && !item.round_id) {
          throw new ConflictException("El artículo enviado no tiene una ronda válida");
        }
        await transaction.query(
          `UPDATE order_items
              SET preparation_state = 'cancelled', updated_at = now()
            WHERE id = $1 AND account_id = $2 AND site_id = $3`,
          [itemId, accountId, actor.siteId],
        );
        const nextVersion = account.version + 1;
        await transaction.query(
          `UPDATE service_accounts
              SET version = $3, updated_at = now()
            WHERE id = $1 AND site_id = $2`,
          [accountId, actor.siteId, nextVersion],
        );
        const production = item.preparation_state === "sent" && item.round_id
          ? await this.production.planCancellation(transaction, {
              siteId: actor.siteId,
              accountId,
              roundId: item.round_id,
              itemId,
              reason: input.reason,
            })
          : null;
        const body = {
          itemId,
          productName: item.product_name,
          previousState: item.preparation_state,
          state: "cancelled",
          reason: input.reason,
          accountVersion: nextVersion,
          production,
        };
        await this.audit.append(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          actorUserId: actor.userId,
          terminalId: actor.terminalId,
          action: "order_item.cancelled",
          entityType: "service_account",
          entityId: accountId,
          reason: input.reason,
          changes: body,
        });
        await this.outbox.enqueue(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          eventType: "account.updated",
          aggregateType: "service_account",
          aggregateId: accountId,
          payload: body,
        });
        return { status: 201, body };
      },
    );
  }

  async listByTable(tableId: string, actor: AuthContext) {
    const result = await this.database.query<{ id: string }>(
      `SELECT id
         FROM service_accounts
        WHERE table_id = $1 AND site_id = $2
          AND status IN ('open', 'awaiting_payment')
        ORDER BY is_primary DESC, opened_at, id`,
      [tableId, actor.siteId],
    );
    const accounts = await Promise.all(
      result.rows.map((row) => this.readAccount(this.database, row.id, actor.siteId)),
    );
    return {
      accounts: accounts.map((account) => ({
        id: account.id,
        label: account.reference ?? account.tableName ?? "Cuenta",
        version: account.version,
        guestCount: account.guestCount,
        responsible: account.responsible,
        itemCount: account.items
          .filter((item) => item.preparationState !== "cancelled")
          .reduce((total, item) => total + item.quantity, 0),
        totalInCents: account.totalInCents,
        isPrimary: account.isPrimary,
      })),
    };
  }

  async managementOptions(accountId: string, actor: AuthContext) {
    const current = await this.readAccount(this.database, accountId, actor.siteId);
    const [users, tables, otherIds] = await Promise.all([
      this.database.query<{ id: string; display_name: string }>(
        `SELECT id, display_name
           FROM app_users
          WHERE site_id = $1 AND status = 'active'
          ORDER BY display_name, id`,
        [actor.siteId],
      ),
      this.database.query<{ id: string; name: string }>(
        `SELECT tables.id, tables.name
           FROM service_tables tables
          WHERE tables.site_id = $1 AND tables.active
            AND (
              tables.id = $2
              OR NOT EXISTS (
                SELECT 1 FROM service_accounts accounts
                 WHERE accounts.table_id = tables.id
                   AND accounts.status IN ('open', 'awaiting_payment')
              )
            )
          ORDER BY tables.display_order, tables.name`,
        [actor.siteId, current.tableId],
      ),
      this.database.query<{ id: string }>(
        `SELECT id
           FROM service_accounts
          WHERE site_id = $1 AND id <> $2 AND status = 'open'
          ORDER BY opened_at, id`,
        [actor.siteId, accountId],
      ),
    ]);
    const otherAccounts = await Promise.all(
      otherIds.rows.map((row) => this.readAccount(this.database, row.id, actor.siteId)),
    );
    return {
      users: users.rows.map((user) => ({
        id: user.id,
        displayName: user.display_name,
      })),
      tables: tables.rows.map((table) => ({ id: table.id, name: table.name })),
      accounts: otherAccounts.map((account) => ({
        id: account.id,
        label: account.tableName ?? account.reference ?? (
          account.serviceType === "takeaway" ? "Para llevar" : "Venta rápida"
        ),
        version: account.version,
        totalInCents: account.totalInCents,
        responsible: account.responsible,
      })),
    };
  }

  applyAdjustment(
    accountId: string,
    input: ApplyAccountAdjustmentDto,
    key: string,
    actor: AuthContext,
  ) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: `account.adjustment.apply:${accountId}`,
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        const account = await this.lockAccount(
          transaction,
          accountId,
          actor.siteId,
          input.expectedVersion,
        );
        if (input.calculation === "percentage" && input.value > 10_000) {
          throw new BadRequestException("El descuento no puede exceder 100%");
        }
        const snapshot = await this.readAccount(transaction, accountId, actor.siteId);
        if (snapshot.totalInCents <= 0) {
          throw new ConflictException("La cuenta no tiene saldo para ajustar");
        }
        if (input.calculation === "fixed" && input.value > snapshot.totalInCents) {
          throw new BadRequestException("El descuento supera el total de la cuenta");
        }
        const adjustmentId = randomUUID();
        await transaction.query(
          `INSERT INTO account_adjustments (
            id, site_id, account_id, kind, calculation, value, reason,
            applied_by_user_id, applied_on_terminal_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            adjustmentId,
            actor.siteId,
            accountId,
            input.kind,
            input.calculation,
            input.value,
            input.reason,
            actor.userId,
            actor.terminalId,
          ],
        );
        const accountVersion = account.version + 1;
        await this.updateAccountVersion(transaction, accountId, actor.siteId, accountVersion);
        const body = { adjustmentId, accountVersion, ...input };
        await this.recordAccountEvent(transaction, actor, {
          action: "account.adjustment.applied",
          eventType: "account.updated",
          accountId,
          reason: input.reason,
          changes: body,
        });
        return { status: 201, body };
      },
    );
  }

  voidAdjustment(
    accountId: string,
    adjustmentId: string,
    input: VoidAccountAdjustmentDto,
    key: string,
    actor: AuthContext,
  ) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: `account.adjustment.void:${accountId}:${adjustmentId}`,
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        const account = await this.lockAccount(
          transaction,
          accountId,
          actor.siteId,
          input.expectedVersion,
        );
        const result = await transaction.query(
          `UPDATE account_adjustments
              SET status = 'voided', voided_by_user_id = $4,
                  voided_on_terminal_id = $5, void_reason = $6, voided_at = now()
            WHERE id = $1 AND account_id = $2 AND site_id = $3 AND status = 'active'
          RETURNING id`,
          [
            adjustmentId,
            accountId,
            actor.siteId,
            actor.userId,
            actor.terminalId,
            input.reason,
          ],
        );
        if (result.rowCount === 0) {
          throw new NotFoundException("Descuento activo inexistente");
        }
        const accountVersion = account.version + 1;
        await this.updateAccountVersion(transaction, accountId, actor.siteId, accountVersion);
        const body = { adjustmentId, accountVersion, reason: input.reason };
        await this.recordAccountEvent(transaction, actor, {
          action: "account.adjustment.voided",
          eventType: "account.updated",
          accountId,
          reason: input.reason,
          changes: body,
        });
        return { status: 200, body };
      },
    );
  }

  createPrecheck(
    accountId: string,
    input: CreatePrecheckDto,
    key: string,
    actor: AuthContext,
  ) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: `account.precheck:${accountId}`,
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        await this.lockAccount(
          transaction,
          accountId,
          actor.siteId,
          input.expectedVersion,
        );
        const snapshot = await this.readAccount(transaction, accountId, actor.siteId);
        if (snapshot.items.every((item) => item.preparationState === "cancelled")) {
          throw new ConflictException("La cuenta no tiene artículos para una precuenta");
        }
        const sequenceResult = await transaction.query<{ next_sequence: number }>(
          `SELECT COALESCE(max(sequence), 0)::integer + 1 AS next_sequence
             FROM account_prechecks WHERE account_id = $1`,
          [accountId],
        );
        const sequence = sequenceResult.rows[0]?.next_sequence ?? 1;
        const precheckId = randomUUID();
        const generatedAt = new Date().toISOString();
        const precheck = { id: precheckId, sequence, generatedAt, account: snapshot };
        await transaction.query(
          `INSERT INTO account_prechecks (
            id, site_id, account_id, sequence, account_version, snapshot,
            generated_by_user_id, generated_on_terminal_id
          ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
          [
            precheckId,
            actor.siteId,
            accountId,
            sequence,
            snapshot.version,
            JSON.stringify(precheck),
            actor.userId,
            actor.terminalId,
          ],
        );
        await this.recordAccountEvent(transaction, actor, {
          action: "account.precheck.generated",
          eventType: "account.precheck.generated",
          accountId,
          changes: { precheckId, sequence, accountVersion: snapshot.version },
        });
        return { status: 201, body: precheck };
      },
    );
  }

  updateContext(
    accountId: string,
    input: UpdateAccountContextDto,
    key: string,
    actor: AuthContext,
  ) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: `account.context:${accountId}`,
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        const account = await this.lockAccount(
          transaction,
          accountId,
          actor.siteId,
          input.expectedVersion,
        );
        if (!input.tableId && !input.responsibleUserId) {
          throw new BadRequestException("Indica una mesa o un responsable");
        }
        if (input.responsibleUserId) {
          const user = await transaction.query(
            `SELECT id FROM app_users
              WHERE id = $1 AND site_id = $2 AND status = 'active'`,
            [input.responsibleUserId, actor.siteId],
          );
          if (user.rowCount === 0) throw new NotFoundException("Responsable inexistente");
        }
        if (input.tableId && input.tableId !== account.table_id) {
          if (account.service_type !== "table") {
            throw new BadRequestException("Sólo una cuenta de comedor puede cambiar de mesa");
          }
          const table = await transaction.query(
            `SELECT id FROM service_tables
              WHERE id = $1 AND site_id = $2 AND active
              FOR UPDATE`,
            [input.tableId, actor.siteId],
          );
          if (table.rowCount === 0) throw new NotFoundException("Mesa inexistente");
          const occupied = await transaction.query(
            `SELECT id FROM service_accounts
              WHERE table_id = $1 AND site_id = $2
                AND account_group_id <> $3
                AND status IN ('open', 'awaiting_payment')
              LIMIT 1
              FOR UPDATE`,
            [input.tableId, actor.siteId, account.account_group_id],
          );
          if (occupied.rowCount > 0) throw new ConflictException("La mesa destino está ocupada");
          await transaction.query(
            `UPDATE service_accounts
                SET table_id = $3,
                    version = CASE WHEN id = $4 THEN version ELSE version + 1 END,
                    updated_at = now()
              WHERE site_id = $1 AND account_group_id = $2
                AND status IN ('open', 'awaiting_payment')`,
            [actor.siteId, account.account_group_id, input.tableId, accountId],
          );
        }
        if (input.responsibleUserId) {
          await transaction.query(
            `UPDATE service_accounts
                SET responsible_user_id = $3, updated_at = now()
              WHERE id = $1 AND site_id = $2`,
            [accountId, actor.siteId, input.responsibleUserId],
          );
        }
        const accountVersion = account.version + 1;
        await this.updateAccountVersion(transaction, accountId, actor.siteId, accountVersion);
        const body = {
          accountId,
          accountVersion,
          tableId: input.tableId ?? account.table_id,
          responsibleUserId: input.responsibleUserId ?? account.responsible_user_id,
        };
        await this.recordAccountEvent(transaction, actor, {
          action: "account.context.updated",
          eventType: "account.updated",
          accountId,
          changes: body,
        });
        return { status: 200, body };
      },
    );
  }

  split(
    accountId: string,
    input: SplitAccountDto,
    key: string,
    actor: AuthContext,
  ) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: `account.split:${accountId}`,
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        const source = await this.lockAccount(
          transaction,
          accountId,
          actor.siteId,
          input.expectedVersion,
        );
        await this.assertNoActiveAdjustments(transaction, [accountId]);
        const destinationAccountId = randomUUID();
        await transaction.query(
          `INSERT INTO service_accounts (
            id, site_id, table_id, service_type, reference, guest_count,
            opened_by_user_id, opened_on_terminal_id, responsible_user_id,
            account_group_id, is_primary
          ) VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9, false)`,
          [
            destinationAccountId,
            actor.siteId,
            source.table_id,
            source.service_type,
            source.reference ? `${source.reference} · división` : "Cuenta dividida",
            actor.userId,
            actor.terminalId,
            source.responsible_user_id,
            source.account_group_id,
          ],
        );
        await this.moveItems(transaction, {
          sourceAccountId: accountId,
          destinationAccountId,
          siteId: actor.siteId,
          items: input.items,
          reason: input.reason,
          actor,
        });
        const sourceVersion = source.version + 1;
        const destinationVersion = 1;
        await this.updateAccountVersion(transaction, accountId, actor.siteId, sourceVersion);
        await this.updateAccountVersion(
          transaction,
          destinationAccountId,
          actor.siteId,
          destinationVersion,
        );
        const body = {
          sourceAccountId: accountId,
          sourceVersion,
          destinationAccountId,
          destinationVersion,
          items: input.items,
        };
        await this.recordAccountEvent(transaction, actor, {
          action: "account.split",
          eventType: "account.split",
          accountId,
          reason: input.reason,
          changes: body,
        });
        return { status: 201, body };
      },
    );
  }

  transferItems(
    accountId: string,
    input: TransferAccountItemsDto,
    key: string,
    actor: AuthContext,
  ) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: `account.transfer:${accountId}`,
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        const [source, destination] = await this.lockAccountPair(transaction, {
          sourceAccountId: accountId,
          sourceExpectedVersion: input.sourceExpectedVersion,
          destinationAccountId: input.destinationAccountId,
          destinationExpectedVersion: input.destinationExpectedVersion,
          siteId: actor.siteId,
        });
        await this.assertNoActiveAdjustments(transaction, [source.id, destination.id]);
        await this.moveItems(transaction, {
          sourceAccountId: source.id,
          destinationAccountId: destination.id,
          siteId: actor.siteId,
          items: input.items,
          reason: input.reason,
          actor,
        });
        const sourceVersion = source.version + 1;
        const destinationVersion = destination.version + 1;
        await this.updateAccountVersion(transaction, source.id, actor.siteId, sourceVersion);
        await this.updateAccountVersion(
          transaction,
          destination.id,
          actor.siteId,
          destinationVersion,
        );
        const body = {
          sourceAccountId: source.id,
          sourceVersion,
          destinationAccountId: destination.id,
          destinationVersion,
          items: input.items,
        };
        await this.recordAccountEvent(transaction, actor, {
          action: "account.items.transferred",
          eventType: "account.items.transferred",
          accountId,
          reason: input.reason,
          changes: body,
        });
        return { status: 200, body };
      },
    );
  }

  cancelAccount(
    accountId: string,
    input: CancelAccountDto,
    key: string,
    actor: AuthContext,
  ) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: `account.cancel:${accountId}`,
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        const account = await this.lockAccount(
          transaction,
          accountId,
          actor.siteId,
          input.expectedVersion,
        );
        const activeItems = await transaction.query<{ id: string }>(
          `SELECT id
             FROM order_items
            WHERE account_id = $1 AND site_id = $2
              AND preparation_state <> 'cancelled'
            LIMIT 1
            FOR UPDATE`,
          [accountId, actor.siteId],
        );
        if (activeItems.rowCount > 0) {
          throw new ConflictException(
            "Cancela o transfiere todos los artículos antes de cancelar la cuenta",
          );
        }
        await this.assertNoActiveAdjustments(transaction, [accountId]);

        let promotedAccountId: string | null = null;
        if (account.is_primary) {
          const sibling = await transaction.query<{ id: string }>(
            `SELECT id
               FROM service_accounts
              WHERE site_id = $1 AND account_group_id = $2 AND id <> $3
                AND status IN ('open', 'awaiting_payment')
              ORDER BY opened_at, id
              LIMIT 1
              FOR UPDATE`,
            [actor.siteId, account.account_group_id, account.id],
          );
          promotedAccountId = sibling.rows[0]?.id ?? null;
        }

        const nextVersion = account.version + 1;
        await transaction.query(
          `UPDATE service_accounts
              SET status = 'cancelled', is_primary = false, version = $3,
                  closed_at = now(), updated_at = now()
            WHERE id = $1 AND site_id = $2`,
          [accountId, actor.siteId, nextVersion],
        );
        if (promotedAccountId) {
          await transaction.query(
            `UPDATE service_accounts
                SET is_primary = true, updated_at = now()
              WHERE id = $1 AND site_id = $2`,
            [promotedAccountId, actor.siteId],
          );
        }

        const body = {
          accountId,
          accountVersion: nextVersion,
          status: "cancelled" as const,
          tableId: account.table_id,
          promotedAccountId,
          reason: input.reason,
        };
        await this.recordAccountEvent(transaction, actor, {
          action: "account.cancelled",
          eventType: "account.cancelled",
          accountId,
          reason: input.reason,
          changes: body,
        });
        return { status: 200, body };
      },
    );
  }

  merge(
    accountId: string,
    input: MergeAccountDto,
    key: string,
    actor: AuthContext,
  ) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: `account.merge:${accountId}`,
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        const [source, destination] = await this.lockAccountPair(transaction, {
          sourceAccountId: accountId,
          sourceExpectedVersion: input.sourceExpectedVersion,
          destinationAccountId: input.destinationAccountId,
          destinationExpectedVersion: input.destinationExpectedVersion,
          siteId: actor.siteId,
        });
        await this.assertNoActiveAdjustments(transaction, [source.id, destination.id]);
        if (source.is_primary && source.account_group_id !== destination.account_group_id) {
          const siblings = await transaction.query(
            `SELECT id FROM service_accounts
              WHERE site_id = $1 AND account_group_id = $2 AND id <> $3
                AND status IN ('open', 'awaiting_payment')
              LIMIT 1
              FOR UPDATE`,
            [actor.siteId, source.account_group_id, source.id],
          );
          if (siblings.rowCount > 0) {
            throw new ConflictException(
              "Une primero las cuentas divididas de la mesa origen",
            );
          }
        }
        const items = await transaction.query<TransferableItemRow>(
          `SELECT id, quantity
             FROM order_items
            WHERE account_id = $1 AND site_id = $2
              AND preparation_state <> 'cancelled'
            ORDER BY created_at, id
            FOR UPDATE`,
          [source.id, actor.siteId],
        );
        if (items.rowCount > 0) {
          await this.moveItems(transaction, {
            sourceAccountId: source.id,
            destinationAccountId: destination.id,
            siteId: actor.siteId,
            items: items.rows.map((item) => ({ itemId: item.id, quantity: item.quantity })),
            reason: input.reason,
            actor,
          });
        }
        if (source.is_primary && source.table_id === destination.table_id) {
          await transaction.query(
            `UPDATE service_accounts SET is_primary = false
              WHERE id = $1 AND site_id = $2`,
            [source.id, actor.siteId],
          );
          await transaction.query(
            `UPDATE service_accounts SET is_primary = true
              WHERE id = $1 AND site_id = $2`,
            [destination.id, actor.siteId],
          );
        }
        const sourceVersion = source.version + 1;
        const destinationVersion = destination.version + 1;
        await transaction.query(
          `UPDATE service_accounts
              SET status = 'closed', version = $3, closed_at = now(), updated_at = now()
            WHERE id = $1 AND site_id = $2`,
          [source.id, actor.siteId, sourceVersion],
        );
        await this.updateAccountVersion(
          transaction,
          destination.id,
          actor.siteId,
          destinationVersion,
        );
        const body = {
          sourceAccountId: source.id,
          sourceVersion,
          destinationAccountId: destination.id,
          destinationVersion,
        };
        await this.recordAccountEvent(transaction, actor, {
          action: "account.merged",
          eventType: "account.merged",
          accountId: source.id,
          reason: input.reason,
          changes: body,
        });
        return { status: 200, body };
      },
    );
  }

  private async lockAccountPair(
    transaction: DatabaseSession,
    input: {
      sourceAccountId: string;
      sourceExpectedVersion: number;
      destinationAccountId: string;
      destinationExpectedVersion: number;
      siteId: string;
    },
  ): Promise<[AccountRow, AccountRow]> {
    if (input.sourceAccountId === input.destinationAccountId) {
      throw new BadRequestException("La cuenta origen y destino deben ser diferentes");
    }
    const expected = new Map([
      [input.sourceAccountId, input.sourceExpectedVersion],
      [input.destinationAccountId, input.destinationExpectedVersion],
    ]);
    const locked = new Map<string, AccountRow>();
    for (const id of [input.sourceAccountId, input.destinationAccountId].sort()) {
      locked.set(
        id,
        await this.lockAccount(transaction, id, input.siteId, expected.get(id)!),
      );
    }
    return [locked.get(input.sourceAccountId)!, locked.get(input.destinationAccountId)!];
  }

  private async assertNoActiveAdjustments(
    transaction: DatabaseSession,
    accountIds: string[],
  ): Promise<void> {
    const result = await transaction.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM account_adjustments
        WHERE account_id = ANY($1::uuid[]) AND status = 'active'`,
      [accountIds],
    );
    if (Number(result.rows[0]?.count ?? 0) > 0) {
      throw new ConflictException(
        "Anula los descuentos o cortesías antes de mover artículos entre cuentas",
      );
    }
  }

  private async moveItems(
    transaction: DatabaseSession,
    input: {
      sourceAccountId: string;
      destinationAccountId: string;
      siteId: string;
      items: Array<{ itemId: string; quantity: number }>;
      reason: string;
      actor: AuthContext;
    },
  ): Promise<void> {
    if (new Set(input.items.map((item) => item.itemId)).size !== input.items.length) {
      throw new BadRequestException("No se puede repetir un artículo en la transferencia");
    }
    for (const selection of input.items) {
      const result = await transaction.query<TransferableItemRow>(
        `SELECT id, quantity
           FROM order_items
          WHERE id = $1 AND account_id = $2 AND site_id = $3
            AND preparation_state <> 'cancelled'
          FOR UPDATE`,
        [selection.itemId, input.sourceAccountId, input.siteId],
      );
      const item = result.rows[0];
      if (!item) throw new NotFoundException("Artículo transferible inexistente");
      if (selection.quantity > item.quantity) {
        throw new BadRequestException("La cantidad transferida supera la disponible");
      }

      let destinationItemId = item.id;
      if (selection.quantity === item.quantity) {
        await transaction.query(
          `UPDATE order_items SET account_id = $2, updated_at = now()
            WHERE id = $1`,
          [item.id, input.destinationAccountId],
        );
      } else {
        destinationItemId = randomUUID();
        await transaction.query(
          `INSERT INTO order_items (
            id, site_id, account_id, round_id, product_id, product_name,
            product_code, production_center_id, unit_price_in_cents,
            tax_rate_basis_points, tax_included, quantity, note,
            preparation_state, created_by_user_id, created_on_terminal_id,
            created_at, updated_at
          )
          SELECT
            $1, site_id, $2, round_id, product_id, product_name,
            product_code, production_center_id, unit_price_in_cents,
            tax_rate_basis_points, tax_included, $3, note,
            preparation_state, created_by_user_id, created_on_terminal_id,
            created_at, now()
          FROM order_items WHERE id = $4`,
          [destinationItemId, input.destinationAccountId, selection.quantity, item.id],
        );
        const modifiers = await transaction.query<{
          modifier_id: string;
          modifier_name: string;
          price_delta_in_cents: number;
          quantity: number;
        }>(
          `SELECT modifier_id, modifier_name, price_delta_in_cents, quantity
             FROM order_item_modifiers WHERE order_item_id = $1`,
          [item.id],
        );
        for (const modifier of modifiers.rows) {
          await transaction.query(
            `INSERT INTO order_item_modifiers (
              id, site_id, order_item_id, modifier_id, modifier_name,
              price_delta_in_cents, quantity
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              randomUUID(),
              input.siteId,
              destinationItemId,
              modifier.modifier_id,
              modifier.modifier_name,
              modifier.price_delta_in_cents,
              modifier.quantity,
            ],
          );
        }
        await transaction.query(
          `UPDATE order_items
              SET quantity = quantity - $2, updated_at = now()
            WHERE id = $1`,
          [item.id, selection.quantity],
        );
      }
      await transaction.query(
        `INSERT INTO account_item_transfers (
          id, site_id, source_account_id, destination_account_id,
          source_item_id, destination_item_id, quantity, reason,
          transferred_by_user_id, transferred_on_terminal_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          randomUUID(),
          input.siteId,
          input.sourceAccountId,
          input.destinationAccountId,
          item.id,
          destinationItemId,
          selection.quantity,
          input.reason,
          input.actor.userId,
          input.actor.terminalId,
        ],
      );
    }
  }

  private updateAccountVersion(
    transaction: DatabaseSession,
    accountId: string,
    siteId: string,
    version: number,
  ) {
    return transaction.query(
      `UPDATE service_accounts SET version = $3, updated_at = now()
        WHERE id = $1 AND site_id = $2`,
      [accountId, siteId, version],
    );
  }

  private async recordAccountEvent(
    transaction: DatabaseSession,
    actor: AuthContext,
    input: {
      action: string;
      eventType: string;
      accountId: string;
      reason?: string;
      changes: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.audit.append(transaction, {
      id: randomUUID(),
      siteId: actor.siteId,
      actorUserId: actor.userId,
      terminalId: actor.terminalId,
      action: input.action,
      entityType: "service_account",
      entityId: input.accountId,
      reason: input.reason,
      changes: input.changes,
    });
    await this.outbox.enqueue(transaction, {
      id: randomUUID(),
      siteId: actor.siteId,
      eventType: input.eventType,
      aggregateType: "service_account",
      aggregateId: input.accountId,
      payload: input.changes,
    });
  }

  private async lockAccount(
    transaction: DatabaseSession,
    accountId: string,
    siteId: string,
    expectedVersion: number,
  ): Promise<AccountRow> {
    const result = await transaction.query<AccountRow>(
      `SELECT
         id, site_id, table_id, NULL::text AS table_name, service_type,
         status, reference, guest_count, version, opened_at,
         responsible_user_id, NULL::text AS responsible_user_name,
         account_group_id, is_primary
       FROM service_accounts
       WHERE id = $1 AND site_id = $2 AND version = $3 AND status = 'open'
       FOR UPDATE`,
      [accountId, siteId, expectedVersion],
    );
    return assertAccountMutable(result.rows[0]);
  }

  private async validateModifiers(
    transaction: DatabaseSession,
    productId: string,
    siteId: string,
    selectedIds: string[],
  ): Promise<ModifierRow[]> {
    if (new Set(selectedIds).size !== selectedIds.length) {
      throw new BadRequestException("No se puede repetir un modificador");
    }
    const result = await transaction.query<ModifierRow>(
      `SELECT
         groups.id AS group_id,
         groups.name AS group_name,
         groups.minimum_selections,
         groups.maximum_selections,
         modifiers.id AS modifier_id,
         modifiers.name AS modifier_name,
         modifiers.price_delta_in_cents,
         modifiers.available
       FROM product_modifier_groups links
       JOIN modifier_groups groups
         ON groups.id = links.modifier_group_id AND groups.active
       JOIN modifiers
         ON modifiers.modifier_group_id = groups.id AND modifiers.active
       WHERE links.product_id = $1 AND groups.site_id = $2
       ORDER BY groups.display_order, modifiers.display_order`,
      [productId, siteId],
    );
    const known = new Map(result.rows.map((modifier) => [modifier.modifier_id, modifier]));
    const selected = selectedIds.map((id) => known.get(id));
    if (selected.some((modifier) => !modifier || !modifier.available)) {
      throw new BadRequestException("Modificador inválido o no disponible");
    }

    const groups = new Map<string, ModifierRow[]>();
    for (const modifier of result.rows) {
      const group = groups.get(modifier.group_id) ?? [];
      group.push(modifier);
      groups.set(modifier.group_id, group);
    }
    for (const options of groups.values()) {
      const selectionCount = selected.filter(
        (modifier) => modifier?.group_id === options[0]?.group_id,
      ).length;
      const rule = options[0];
      if (
        rule &&
        (selectionCount < rule.minimum_selections ||
          selectionCount > rule.maximum_selections)
      ) {
        throw new BadRequestException(
          `Selección inválida para ${rule.group_name}`,
        );
      }
    }

    return selected as ModifierRow[];
  }
}
