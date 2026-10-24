import { Inject, Injectable } from "@nestjs/common";
import {
  DATABASE,
  type DatabasePort,
  type DatabaseRow,
} from "../database/database.port.js";
import { modifierPriceLabel } from "./modifier-price-label.js";

interface CategoryRow extends DatabaseRow {
  id: string;
  code: string;
  name: string;
  color: string | null;
  display_order: number;
  seasonal: boolean;
}

interface ProductRow extends DatabaseRow {
  id: string;
  category_id: string;
  code: string;
  name: string;
  short_name: string;
  emoji: string | null;
  color: string | null;
  display_order: number;
  available: boolean;
  version: number;
  price_in_cents: number;
  tax_rate_basis_points: number;
  price_includes_tax: boolean;
  production_center_id: string | null;
}

interface ModifierRow extends DatabaseRow {
  product_id: string;
  group_id: string;
  group_name: string;
  minimum_selections: number;
  maximum_selections: number;
  modifier_id: string;
  modifier_code: string;
  modifier_name: string;
  price_delta_in_cents: number;
  available: boolean;
}

interface AreaRow extends DatabaseRow {
  area_id: string;
  area_name: string;
  area_order: number;
  table_id: string;
  table_code: string;
  table_name: string;
  capacity: number;
  table_order: number;
  account_id: string | null;
  account_version: number | null;
  account_count: number;
}

@Injectable()
export class CatalogService {
  constructor(@Inject(DATABASE) private readonly database: DatabasePort) {}

  async catalog(siteId: string) {
    const [categories, products, modifiers] = await Promise.all([
      this.database.query<CategoryRow>(
        `SELECT id, code, name, color, display_order, seasonal
           FROM product_categories
          WHERE site_id = $1 AND active
          ORDER BY display_order, name`,
        [siteId],
      ),
      this.database.query<ProductRow>(
        `SELECT
           products.id, products.category_id, products.code, products.name,
           products.short_name, products.emoji, products.color,
           products.display_order, products.available, products.version,
           prices.price_in_cents, taxes.rate_basis_points AS tax_rate_basis_points,
           taxes.price_includes_tax, products.production_center_id
         FROM products
         JOIN product_prices prices
           ON prices.product_id = products.id
          AND prices.site_id = products.site_id
          AND prices.price_list_code = 'DEFAULT'
          AND prices.active
         JOIN tax_rules taxes ON taxes.id = products.tax_rule_id AND taxes.active
         WHERE products.site_id = $1 AND products.active
         ORDER BY products.category_id, products.display_order, products.name`,
        [siteId],
      ),
      this.database.query<ModifierRow>(
        `SELECT
           links.product_id,
           groups.id AS group_id,
           groups.name AS group_name,
           groups.minimum_selections,
           groups.maximum_selections,
           modifiers.id AS modifier_id,
           modifiers.code AS modifier_code,
           modifiers.name AS modifier_name,
           modifiers.price_delta_in_cents,
           modifiers.available
         FROM product_modifier_groups links
         JOIN modifier_groups groups
           ON groups.id = links.modifier_group_id AND groups.active
         JOIN modifiers
           ON modifiers.modifier_group_id = groups.id AND modifiers.active
         WHERE groups.site_id = $1
         ORDER BY links.display_order, groups.display_order, modifiers.display_order`,
        [siteId],
      ),
    ]);

    const modifiersByProduct = new Map<string, Map<string, {
      id: string;
      name: string;
      minimumSelections: number;
      maximumSelections: number;
      options: Array<{
        id: string;
        name: string;
        priceDeltaInCents: number;
        available: boolean;
      }>;
    }>>();

    const productsById = new Map(products.rows.map((product) => [product.id, product]));
    for (const row of modifiers.rows) {
      const product = productsById.get(row.product_id);
      if (!product) continue;
      const groups = modifiersByProduct.get(row.product_id) ?? new Map();
      const group = groups.get(row.group_id) ?? {
        id: row.group_id,
        name: row.group_name,
        minimumSelections: row.minimum_selections,
        maximumSelections: row.maximum_selections,
        options: [],
      };
      group.options.push({
        id: row.modifier_id,
        name: modifierPriceLabel(
          row.modifier_code, row.modifier_name, product.price_in_cents, row.price_delta_in_cents,
        ),
        priceDeltaInCents: row.price_delta_in_cents,
        available: row.available,
      });
      groups.set(row.group_id, group);
      modifiersByProduct.set(row.product_id, groups);
    }

    return {
      categories: categories.rows.map((category) => ({
        id: category.id,
        code: category.code,
        name: category.name,
        color: category.color,
        seasonal: category.seasonal,
        products: products.rows
          .filter((product) => product.category_id === category.id)
          .map((product) => ({
            id: product.id,
            code: product.code,
            name: product.name,
            shortName: product.short_name,
            emoji: product.emoji,
            color: product.color,
            available: product.available,
            version: product.version,
            priceInCents: product.price_in_cents,
            taxRateBasisPoints: product.tax_rate_basis_points,
            priceIncludesTax: product.price_includes_tax,
            productionCenterId: product.production_center_id,
            modifierGroups: [
              ...(modifiersByProduct.get(product.id)?.values() ?? []),
            ],
          })),
      })),
    };
  }

  async serviceLayout(siteId: string) {
    const result = await this.database.query<AreaRow>(
      `SELECT
         areas.id AS area_id,
         areas.name AS area_name,
         areas.display_order AS area_order,
         tables.id AS table_id,
         tables.code AS table_code,
         tables.name AS table_name,
         tables.capacity,
         tables.display_order AS table_order,
         accounts.account_id,
         accounts.account_version,
         COALESCE(accounts.account_count, 0)::integer AS account_count
       FROM dining_areas areas
       JOIN service_tables tables
         ON tables.dining_area_id = areas.id AND tables.active
       LEFT JOIN (
         SELECT
           table_id,
           (array_agg(id ORDER BY is_primary DESC, opened_at, id))[1] AS account_id,
           (array_agg(version ORDER BY is_primary DESC, opened_at, id))[1] AS account_version,
           count(*)::integer AS account_count
         FROM service_accounts
         WHERE status IN ('open', 'awaiting_payment')
         GROUP BY table_id
       ) accounts ON accounts.table_id = tables.id
       WHERE areas.site_id = $1 AND areas.active
       ORDER BY areas.display_order, tables.display_order`,
      [siteId],
    );

    const areas = new Map<string, {
      id: string;
      name: string;
      tables: Array<{
        id: string;
        code: string;
        name: string;
        capacity: number;
        state: "free" | "occupied";
        accountId: string | null;
        accountVersion: number | null;
        accountCount: number;
      }>;
    }>();

    for (const row of result.rows) {
      const area = areas.get(row.area_id) ?? {
        id: row.area_id,
        name: row.area_name,
        tables: [],
      };
      area.tables.push({
        id: row.table_id,
        code: row.table_code,
        name: row.table_name,
        capacity: row.capacity,
        state: row.account_id ? "occupied" : "free",
        accountId: row.account_id,
        accountVersion: row.account_version,
        accountCount: row.account_count,
      });
      areas.set(row.area_id, area);
    }

    return { areas: [...areas.values()] };
  }
}
