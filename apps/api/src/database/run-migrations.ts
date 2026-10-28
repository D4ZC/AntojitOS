import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabasePort } from "./database.port.js";
import { provisionCashierAccounts } from "./provision-cashier.js";

const migrationDirectory = resolve(
  fileURLToPath(new URL("../../migrations", import.meta.url)),
);

export const runMigrations = async (database: DatabasePort): Promise<void> => {
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const filenames = (await readdir(migrationDirectory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  for (const filename of filenames) {
    const applied = await database.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations WHERE filename = $1",
      [filename],
    );

    if (applied.rowCount > 0) continue;

    const sql = await readFile(resolve(migrationDirectory, filename), "utf8");

    await database.transaction(async (transaction) => {
      await transaction.query(sql);
      await transaction.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1)",
        [filename],
      );
    });
  }
  await provisionCashierAccounts(database);
};
