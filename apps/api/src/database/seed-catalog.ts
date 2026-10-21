import { AppConfigService } from "../config/app-config.service.js";
import { loadEnvironment } from "../config/load-environment.js";
import { applyPilotCatalog } from "./pilot-catalog.js";
import { PostgresDatabase } from "./postgres-database.js";
import { runMigrations } from "./run-migrations.js";

const ids = {
  site: "00000000-0000-4000-8000-000000000001",
  kitchen: "00000000-0000-4000-8000-000000000201",
  tax: "00000000-0000-4000-8000-000000000230",
};

loadEnvironment();

const config = new AppConfigService();
const database = new PostgresDatabase(config.databaseUrl);

try {
  await runMigrations(database);
  await database.transaction((transaction) =>
    applyPilotCatalog(transaction, {
      siteId: ids.site,
      kitchenId: ids.kitchen,
      taxRuleId: ids.tax,
    }),
  );
  console.info("Catálogo del piloto actualizado");
} finally {
  await database.close();
}
