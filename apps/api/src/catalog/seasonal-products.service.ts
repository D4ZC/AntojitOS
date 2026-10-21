import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service.js";
import type { DatabaseRow, DatabaseSession } from "../database/database.port.js";
import { IdempotencyService, requestHash } from "../idempotency/idempotency.service.js";
import type { AuthContext } from "../security/auth-context.js";
import type { CreateSeasonalProductDto } from "./dto/create-seasonal-product.dto.js";
import type { UpdateSeasonalProductDto } from "./dto/update-seasonal-product.dto.js";

interface SeasonalProductRow extends DatabaseRow {
  id: string;
  name: string;
  available: boolean;
  version: number;
  seasonal: boolean;
  price_in_cents: number;
}

const seasonalOnly = () =>
  new BadRequestException("Solo los platillos de temporada se editan desde el POS");

@Injectable()
export class SeasonalProductsService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  create(input: CreateSeasonalProductDto, key: string, actor: AuthContext) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: "catalog.product.create",
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        const category = await transaction.query<{ seasonal: boolean } & DatabaseRow>(
          `SELECT seasonal FROM product_categories
            WHERE id = $1 AND site_id = $2 AND active`,
          [input.categoryId, actor.siteId],
        );
        if (!category.rows[0]) throw new NotFoundException("Categoría no disponible");
        if (!category.rows[0].seasonal) throw seasonalOnly();

        // Un platillo nuevo se prepara y factura igual que los demás de su categoría.
        const defaults = await transaction.query<{
          production_center_id: string | null;
          tax_rule_id: string;
          display_order: number;
        } & DatabaseRow>(
          `SELECT
             (SELECT production_center_id FROM products
               WHERE category_id = $1 ORDER BY display_order LIMIT 1) AS production_center_id,
             COALESCE(
               (SELECT tax_rule_id FROM products
                 WHERE category_id = $1 ORDER BY display_order LIMIT 1),
               (SELECT id FROM tax_rules WHERE site_id = $2 AND active ORDER BY code LIMIT 1)
             ) AS tax_rule_id,
             COALESCE(
               (SELECT max(display_order) FROM products WHERE category_id = $1), 0
             )::integer + 1 AS display_order`,
          [input.categoryId, actor.siteId],
        );
        const placement = defaults.rows[0];
        if (!placement?.tax_rule_id) {
          throw new ConflictException("La sucursal no tiene una regla de impuestos activa");
        }

        const name = input.name.trim();
        const productId = randomUUID();
        await transaction.query(
          `INSERT INTO products (
             id, site_id, category_id, production_center_id, tax_rule_id,
             code, name, short_name, emoji, color, display_order,
             active, available
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, '🍽️', 'cream', $8, true, true)`,
          [
            productId,
            actor.siteId,
            input.categoryId,
            placement.production_center_id,
            placement.tax_rule_id,
            `TEMPORADA-${productId.slice(0, 8).toUpperCase()}`,
            name,
            placement.display_order,
          ],
        );
        await this.insertPrice(transaction, actor.siteId, productId, input.priceInCents);

        const body = {
          product: {
            id: productId,
            name,
            priceInCents: input.priceInCents,
            available: true,
            version: 0,
          },
        };
        await this.audit.append(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          actorUserId: actor.userId,
          terminalId: actor.terminalId,
          action: "catalog.product.created",
          entityType: "product",
          entityId: productId,
          changes: body,
        });
        return { status: 201, body };
      },
    );
  }

  update(
    productId: string,
    input: UpdateSeasonalProductDto,
    key: string,
    actor: AuthContext,
  ) {
    return this.idempotency.execute(
      {
        siteId: actor.siteId,
        scope: `catalog.product.update:${productId}`,
        key,
        requestHash: requestHash(input),
      },
      async (transaction) => {
        const result = await transaction.query<SeasonalProductRow>(
          `SELECT products.id, products.name, products.available, products.version,
                  categories.seasonal, prices.price_in_cents
             FROM products
             JOIN product_categories categories ON categories.id = products.category_id
             JOIN product_prices prices
               ON prices.product_id = products.id
              AND prices.price_list_code = 'DEFAULT'
              AND prices.active
            WHERE products.id = $1 AND products.site_id = $2 AND products.active
            FOR UPDATE OF products`,
          [productId, actor.siteId],
        );
        const before = result.rows[0];
        if (!before) throw new NotFoundException("Platillo no disponible");
        if (!before.seasonal) throw seasonalOnly();
        if (before.version !== input.expectedVersion) {
          throw new ConflictException("El platillo cambió en otra terminal");
        }

        const name = input.name?.trim() ?? before.name;
        const available = input.available ?? before.available;
        const priceInCents = input.priceInCents ?? before.price_in_cents;
        const version = before.version + 1;
        await transaction.query(
          `UPDATE products
              SET name = $3, short_name = $3, available = $4,
                  version = $5, updated_at = now()
            WHERE id = $1 AND site_id = $2`,
          [productId, actor.siteId, name, available, version],
        );
        if (priceInCents !== before.price_in_cents) {
          // Se conserva el precio anterior inactivo como historial de cambios.
          await transaction.query(
            `UPDATE product_prices
                SET active = false
              WHERE product_id = $1 AND site_id = $2
                AND price_list_code = 'DEFAULT' AND active`,
            [productId, actor.siteId],
          );
          await this.insertPrice(transaction, actor.siteId, productId, priceInCents);
        }

        const body = { product: { id: productId, name, priceInCents, available, version } };
        await this.audit.append(transaction, {
          id: randomUUID(),
          siteId: actor.siteId,
          actorUserId: actor.userId,
          terminalId: actor.terminalId,
          action: "catalog.product.updated",
          entityType: "product",
          entityId: productId,
          changes: {
            before: {
              name: before.name,
              priceInCents: before.price_in_cents,
              available: before.available,
            },
            after: body.product,
          },
        });
        return { status: 200, body };
      },
    );
  }

  private async insertPrice(
    transaction: DatabaseSession,
    siteId: string,
    productId: string,
    priceInCents: number,
  ) {
    await transaction.query(
      `INSERT INTO product_prices (
         id, site_id, product_id, price_list_code, price_in_cents, active
       ) VALUES ($1, $2, $3, 'DEFAULT', $4, true)`,
      [randomUUID(), siteId, productId, priceInCents],
    );
  }
}
