import { AppConfigService } from "../config/app-config.service.js";
import { loadEnvironment } from "../config/load-environment.js";
import { PostgresDatabase } from "./postgres-database.js";
import { runMigrations } from "./run-migrations.js";

loadEnvironment();

const config = new AppConfigService();
const database = new PostgresDatabase(config.databaseUrl);

try {
  await runMigrations(database);
  console.info("Migraciones aplicadas correctamente");
} finally {
  await database.close();
}
