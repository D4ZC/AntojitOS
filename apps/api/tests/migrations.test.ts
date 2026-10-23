import { readdir } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogService } from "../src/catalog/catalog.service.js";
import { runMigrations } from "../src/database/run-migrations.js";
import { createServiceFixture, fixtureIds } from "./service-fixture.js";
import { TestDatabase } from "./test-database.js";

let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.close();
  database = undefined;
});

describe("migraciones de fundación", () => {
  it("crea el esquema completo y puede ejecutarse dos veces", async () => {
    database = new TestDatabase();

    await runMigrations(database);
    await runMigrations(database);

    const tables = await database.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name`,
    );

    expect(tables.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        "app_users",
        "account_adjustments",
        "account_item_transfers",
        "account_prechecks",
        "audit_events",
        "cash_movements",
        "cash_registers",
        "cash_shift_closes",
        "cash_shift_declarations",
        "cash_shifts",
        "dining_areas",
        "idempotency_records",
        "order_items",
        "order_rounds",
        "outbox_events",
        "payments",
        "payment_allocations",
        "payment_methods",
        "payment_tips",
        "refund_payments",
        "products",
        "production_tickets",
        "print_jobs",
        "service_accounts",
        "sites",
        "sales_receipts",
        "sales_refunds",
        "terminals",
        "user_sessions",
      ]),
    );
    const applied = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM schema_migrations",
    );
    const filenames = await readdir(new URL("../migrations/", import.meta.url));
    expect(applied.rows[0]?.count).toBe(
      String(filenames.filter((filename) => filename.endsWith(".sql")).length),
    );
  });

  it("agrega Mesa 9 y actualiza la flauta sin modificar pedidos ni precios históricos", async () => {
    database = await createServiceFixture();
    await database.query(
      "DELETE FROM schema_migrations WHERE filename = '0008_pilot_tables_and_flauta_price.sql'",
    );
    await database.query(
      "UPDATE products SET code = 'FLAUTA', name = 'Flauta', short_name = 'Flauta' WHERE id = $1",
      [fixtureIds.product],
    );
    await database.query("UPDATE product_prices SET price_in_cents = 2500 WHERE id = $1", [fixtureIds.price]);
    await database.query(
      `INSERT INTO product_prices (id, site_id, product_id, price_in_cents, active)
       VALUES ('20000000-0000-4000-8000-000000000001', $1, $2, 2000, false)`,
      [fixtureIds.site, fixtureIds.product],
    );
    await database.query(
      `INSERT INTO service_accounts (
         id, account_group_id, site_id, service_type, reference, responsible_user_id,
         opened_by_user_id, opened_on_terminal_id
       ) VALUES (
         '20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002',
         $1, 'quick', 'Pedido existente', $2, $2, $3
       )`,
      [fixtureIds.site, fixtureIds.user, fixtureIds.terminalOne],
    );
    await database.query(
      `INSERT INTO order_items (
         id, site_id, account_id, product_id, product_name, product_code,
         unit_price_in_cents, tax_rate_basis_points, tax_included, quantity,
         created_by_user_id, created_on_terminal_id
       ) VALUES (
         '20000000-0000-4000-8000-000000000003', $1,
         '20000000-0000-4000-8000-000000000002', $2, 'Flauta', 'FLAUTA',
         2500, 1600, true, 1, $3, $4
       )`,
      [fixtureIds.site, fixtureIds.product, fixtureIds.user, fixtureIds.terminalOne],
    );

    await runMigrations(database);
    await runMigrations(database);

    const layout = await new CatalogService(database).serviceLayout(fixtureIds.site);
    expect(layout.areas[0]?.tables.filter((table) => table.code === "TABLE-9"))
      .toEqual([expect.objectContaining({ name: "Mesa 9", capacity: 4, state: "free" })]);
    expect(layout.areas[0]?.tables).toHaveLength(3);
    const catalog = await new CatalogService(database).catalog(fixtureIds.site);
    expect(catalog.categories[0]?.products[0]).toMatchObject({
      code: "FLAUTA", priceInCents: 3500, version: 1,
    });
    const prices = await database.query<{ price_in_cents: number; active: boolean }>(
      "SELECT price_in_cents, active FROM product_prices WHERE product_id = $1 ORDER BY active",
      [fixtureIds.product],
    );
    expect(prices.rows).toEqual([
      { price_in_cents: 2000, active: false },
      { price_in_cents: 3500, active: true },
    ]);
    const item = await database.query<{ unit_price_in_cents: number; quantity: number }>(
      "SELECT unit_price_in_cents, quantity FROM order_items WHERE id = '20000000-0000-4000-8000-000000000003'",
    );
    expect(item.rows[0]).toEqual({ unit_price_in_cents: 2500, quantity: 1 });
  });
});
