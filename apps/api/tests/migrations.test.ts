import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "../src/database/run-migrations.js";
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
        "dining_areas",
        "idempotency_records",
        "order_items",
        "order_rounds",
        "outbox_events",
        "products",
        "production_tickets",
        "print_jobs",
        "service_accounts",
        "sites",
        "terminals",
        "user_sessions",
      ]),
    );
    const applied = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM schema_migrations",
    );
    expect(applied.rows[0]?.count).toBe("4");
  });
});
