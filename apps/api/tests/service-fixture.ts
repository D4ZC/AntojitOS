import { runMigrations } from "../src/database/run-migrations.js";
import { hashDeviceToken } from "../src/security/token.js";
import { TestDatabase } from "./test-database.js";

export const fixtureIds = {
  site: "10000000-0000-4000-8000-000000000001",
  user: "10000000-0000-4000-8000-000000000002",
  userTwo: "10000000-0000-4000-8000-000000000014",
  terminalOne: "10000000-0000-4000-8000-000000000003",
  terminalTwo: "10000000-0000-4000-8000-000000000004",
  productionCenter: "10000000-0000-4000-8000-000000000005",
  area: "10000000-0000-4000-8000-000000000006",
  table: "10000000-0000-4000-8000-000000000007",
  tableTwo: "10000000-0000-4000-8000-000000000015",
  tax: "10000000-0000-4000-8000-000000000008",
  category: "10000000-0000-4000-8000-000000000009",
  product: "10000000-0000-4000-8000-000000000010",
  price: "10000000-0000-4000-8000-000000000011",
  modifierGroup: "10000000-0000-4000-8000-000000000012",
  modifier: "10000000-0000-4000-8000-000000000013",
};

export const createServiceFixture = async (): Promise<TestDatabase> => {
  const database = new TestDatabase();
  await runMigrations(database);

  await database.transaction(async (transaction) => {
    await transaction.query(
      "INSERT INTO sites (id, code, name) VALUES ($1, 'PILOT', 'Piloto')",
      [fixtureIds.site],
    );
    await transaction.query(
      `INSERT INTO app_users (id, site_id, employee_code, display_name)
       VALUES
         ($1, $3, 'ADMIN', 'Administrador'),
         ($2, $3, 'WAITER', 'Mesero dos')`,
      [fixtureIds.user, fixtureIds.userTwo, fixtureIds.site],
    );
    await transaction.query(
      `INSERT INTO terminals (
         id, site_id, code, display_name, profile, device_token_hash
       ) VALUES
         ($1, $3, 'POS-01', 'Tablet uno', 'pos', $4),
         ($2, $3, 'POS-02', 'Tablet dos', 'pos', $5)`,
      [
        fixtureIds.terminalOne,
        fixtureIds.terminalTwo,
        fixtureIds.site,
        hashDeviceToken("terminal-one"),
        hashDeviceToken("terminal-two"),
      ],
    );
    await transaction.query(
      `INSERT INTO production_centers (id, site_id, code, name)
       VALUES ($1, $2, 'KITCHEN', 'Cocina')`,
      [fixtureIds.productionCenter, fixtureIds.site],
    );
    await transaction.query(
      `INSERT INTO dining_areas (id, site_id, code, name)
       VALUES ($1, $2, 'MAIN', 'Comedor')`,
      [fixtureIds.area, fixtureIds.site],
    );
    await transaction.query(
      `INSERT INTO service_tables (
         id, site_id, dining_area_id, code, name, capacity, display_order
       ) VALUES
         ($1, $3, $4, 'TABLE-1', 'Mesa 1', 4, 1),
         ($2, $3, $4, 'TABLE-2', 'Mesa 2', 4, 2)`,
      [fixtureIds.table, fixtureIds.tableTwo, fixtureIds.site, fixtureIds.area],
    );
    await transaction.query(
      `INSERT INTO tax_rules (
         id, site_id, code, name, rate_basis_points, price_includes_tax
       ) VALUES ($1, $2, 'IVA-16', 'IVA 16%', 1600, true)`,
      [fixtureIds.tax, fixtureIds.site],
    );
    await transaction.query(
      `INSERT INTO product_categories (id, site_id, code, name)
       VALUES ($1, $2, 'TACOS', 'Tacos')`,
      [fixtureIds.category, fixtureIds.site],
    );
    await transaction.query(
      `INSERT INTO products (
         id, site_id, category_id, production_center_id, tax_rule_id,
         code, name, short_name
       ) VALUES ($1, $2, $3, $4, $5, 'TACO', 'Taco de prueba', 'Taco')`,
      [
        fixtureIds.product,
        fixtureIds.site,
        fixtureIds.category,
        fixtureIds.productionCenter,
        fixtureIds.tax,
      ],
    );
    await transaction.query(
      `INSERT INTO product_prices (
         id, site_id, product_id, price_list_code, price_in_cents
       ) VALUES ($1, $2, $3, 'DEFAULT', 1000)`,
      [fixtureIds.price, fixtureIds.site, fixtureIds.product],
    );
    await transaction.query(
      `INSERT INTO modifier_groups (
         id, site_id, code, name, minimum_selections, maximum_selections
       ) VALUES ($1, $2, 'PREP', 'Preparación', 0, 1)`,
      [fixtureIds.modifierGroup, fixtureIds.site],
    );
    await transaction.query(
      `INSERT INTO modifiers (
         id, site_id, modifier_group_id, code, name, price_delta_in_cents
       ) VALUES ($1, $2, $3, 'EXTRA', 'Extra', 200)`,
      [
        fixtureIds.modifier,
        fixtureIds.site,
        fixtureIds.modifierGroup,
      ],
    );
    await transaction.query(
      `INSERT INTO product_modifier_groups (product_id, modifier_group_id)
       VALUES ($1, $2)`,
      [fixtureIds.product, fixtureIds.modifierGroup],
    );
  });

  return database;
};
