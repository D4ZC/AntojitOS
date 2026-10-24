import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service.js";
import type { DatabaseRow } from "../database/database.port.js";
import { IdempotencyService, requestHash } from "../idempotency/idempotency.service.js";
import type { AuthContext } from "../security/auth-context.js";
import type { UpdateModifierPriceDto } from "./dto/update-modifier-price.dto.js";
import type { UpdateProductPriceDto } from "./dto/update-product-price.dto.js";

interface ProductRow extends DatabaseRow {
  id: string;
  name: string;
  available: boolean;
  version: number;
}

interface ModifierRow extends DatabaseRow {
  id: string;
  name: string;
  price_delta_in_cents: number;
}

@Injectable()
export class CatalogPricingService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  updateProductPrice(
    productId: string,
    input: UpdateProductPriceDto,
    key: string,
    actor: AuthContext,
  ) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: `catalog.product.price.update:${productId}`,
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        const result = await transaction.query<ProductRow>(
          `SELECT products.id, products.name, products.available, products.version
             FROM products
             JOIN product_categories categories
               ON categories.id = products.category_id
              AND categories.site_id = products.site_id AND categories.active
            WHERE products.id = $1 AND products.site_id = $2 AND products.active
            FOR UPDATE OF products`,
          [productId, actor.siteId],
        );
        const before = result.rows[0];
        if (!before) throw new NotFoundException("Platillo no disponible");
        if (before.version !== input.expectedVersion) {
          throw new ConflictException("El platillo cambió en otra terminal; actualiza el catálogo");
        }

        // Consultar después del bloqueo evita leer un precio anterior si otra terminal acaba de editarlo.
        const price = await transaction.query<{ price_in_cents: number } & DatabaseRow>(
          `SELECT price_in_cents FROM product_prices
            WHERE product_id = $1 AND site_id = $2
              AND price_list_code = 'DEFAULT' AND active`,
          [productId, actor.siteId],
        );
        const previousPrice = price.rows[0]?.price_in_cents;
        if (previousPrice === undefined) throw new NotFoundException("Precio no disponible");

        if (input.priceInCents !== previousPrice) {
          await transaction.query(
            `UPDATE product_prices SET active = false
              WHERE product_id = $1 AND site_id = $2
                AND price_list_code = 'DEFAULT' AND active`,
            [productId, actor.siteId],
          );
          await transaction.query(
            `INSERT INTO product_prices (
               id, site_id, product_id, price_list_code, price_in_cents, active
             ) VALUES ($1, $2, $3, 'DEFAULT', $4, true)`,
            [randomUUID(), actor.siteId, productId, input.priceInCents],
          );
        }
        const version = before.version + 1;
        await transaction.query(
          `UPDATE products SET version = $3, updated_at = now()
            WHERE id = $1 AND site_id = $2`,
          [productId, actor.siteId, version],
        );

        const body = {
          product: {
            id: productId,
            name: before.name,
            priceInCents: input.priceInCents,
            available: before.available,
            version,
          },
        };
        await this.audit.append(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          actorUserId: actor.userId,
          terminalId: actor.terminalId,
          action: "catalog.product.price.updated",
          entityType: "product",
          entityId: productId,
          changes: {
            before: { priceInCents: previousPrice, version: before.version },
            after: { priceInCents: input.priceInCents, version },
          },
        });
        return { status: 200, body };
      },
    );
  }

  updateModifierPrice(
    modifierId: string,
    input: UpdateModifierPriceDto,
    key: string,
    actor: AuthContext,
  ) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: `catalog.modifier.price.update:${modifierId}`,
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        const result = await transaction.query<ModifierRow>(
          `SELECT modifiers.id, modifiers.name, modifiers.price_delta_in_cents
             FROM modifiers
             JOIN modifier_groups groups
               ON groups.id = modifiers.modifier_group_id
              AND groups.site_id = modifiers.site_id AND groups.active
            WHERE modifiers.id = $1 AND modifiers.site_id = $2 AND modifiers.active
            FOR UPDATE OF modifiers`,
          [modifierId, actor.siteId],
        );
        const before = result.rows[0];
        if (!before) throw new NotFoundException("Opción no disponible");
        if (before.price_delta_in_cents !== input.expectedPriceDeltaInCents) {
          throw new ConflictException("El precio de la opción cambió en otra terminal; actualiza el catálogo");
        }
        await transaction.query(
          `UPDATE modifiers SET price_delta_in_cents = $3
            WHERE id = $1 AND site_id = $2`,
          [modifierId, actor.siteId, input.priceDeltaInCents],
        );
        const body = {
          modifier: { id: modifierId, name: before.name, priceDeltaInCents: input.priceDeltaInCents },
        };
        await this.audit.append(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          actorUserId: actor.userId,
          terminalId: actor.terminalId,
          action: "catalog.modifier.price.updated",
          entityType: "modifier",
          entityId: modifierId,
          changes: {
            before: { priceDeltaInCents: before.price_delta_in_cents },
            after: { priceDeltaInCents: input.priceDeltaInCents },
          },
        });
        return { status: 200, body };
      },
    );
  }
}
