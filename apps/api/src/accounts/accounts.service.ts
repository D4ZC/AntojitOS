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
import {
  IdempotencyService,
  requestHash,
} from "../idempotency/idempotency.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import type { AuthContext } from "../security/auth-context.js";
import type { AddOrderItemDto } from "./dto/add-order-item.dto.js";
import type { OpenAccountDto } from "./dto/open-account.dto.js";
import type { SendRoundDto } from "./dto/send-round.dto.js";
import type { UpdateOrderItemDto } from "./dto/update-order-item.dto.js";

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
  ) {}

  async get(accountId: string, actor: AuthContext) {
    const accountResult = await this.database.query<AccountRow>(
      `SELECT
         accounts.id, accounts.site_id, accounts.table_id, tables.name AS table_name,
         accounts.service_type, accounts.status, accounts.reference,
         accounts.guest_count, accounts.version, accounts.opened_at
       FROM service_accounts accounts
       LEFT JOIN service_tables tables ON tables.id = accounts.table_id
       WHERE accounts.id = $1 AND accounts.site_id = $2`,
      [accountId, actor.siteId],
    );
    const account = accountResult.rows[0];
    if (!account) throw new NotFoundException("Cuenta inexistente");

    const [itemsResult, modifiersResult] = await Promise.all([
      this.database.query<ItemRow>(
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
        [accountId, actor.siteId],
      ),
      this.database.query<ItemModifierRow>(
        `SELECT
           order_item_id, id, modifier_id, modifier_name,
           price_delta_in_cents, quantity
         FROM order_item_modifiers
         WHERE order_item_id IN (
           SELECT id FROM order_items WHERE account_id = $1 AND site_id = $2
         )
         ORDER BY id`,
        [accountId, actor.siteId],
      ),
    ]);

    const items = itemsResult.rows.map((item) => ({
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
      lineTotalInCents:
        (item.unit_price_in_cents + item.modifier_total_in_cents) * item.quantity,
    }));

    return {
      id: account.id,
      tableId: account.table_id,
      tableName: account.table_name,
      serviceType: account.service_type,
      status: account.status,
      reference: account.reference,
      guestCount: account.guest_count,
      version: account.version,
      openedAt: new Date(account.opened_at).toISOString(),
      items,
      totalInCents: items.reduce((total, item) => total + item.lineTotalInCents, 0),
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
        } else if (input.tableId) {
          throw new BadRequestException("Este tipo de servicio no utiliza mesa");
        }

        const id = randomUUID();
        try {
          await transaction.query(
            `INSERT INTO service_accounts (
              id, site_id, table_id, service_type, reference, guest_count,
              opened_by_user_id, opened_on_terminal_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
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
        const body = {
          roundId,
          sequence,
          accountVersion: nextVersion,
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

  private async lockAccount(
    transaction: DatabaseSession,
    accountId: string,
    siteId: string,
    expectedVersion: number,
  ): Promise<AccountRow> {
    const result = await transaction.query<AccountRow>(
      `SELECT
         id, site_id, table_id, NULL::text AS table_name, service_type,
         status, reference, guest_count, version, opened_at
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
