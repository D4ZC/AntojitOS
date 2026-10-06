import { hash } from "@node-rs/argon2";
import { AppConfigService } from "../config/app-config.service.js";
import { loadEnvironment } from "../config/load-environment.js";
import { PostgresDatabase } from "./postgres-database.js";
import { runMigrations } from "./run-migrations.js";

const ids = {
  site: "00000000-0000-4000-8000-000000000001",
  administratorRole: "00000000-0000-4000-8000-000000000010",
  administratorUser: "00000000-0000-4000-8000-000000000020",
};

loadEnvironment();

const config = new AppConfigService();
const database = new PostgresDatabase(config.databaseUrl);
const adminPin = process.env.SEED_ADMIN_PIN ?? "1234";

try {
  await runMigrations(database);
  const pinHash = await hash(adminPin, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  });

  await database.transaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO sites (id, code, name)
       VALUES ($1, 'PILOT', 'Sucursal piloto')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [ids.site],
    );
    await transaction.query(
      `INSERT INTO permissions (code, description) VALUES
        ('terminal.manage', 'Modificar configuración de terminales'),
        ('audit.read', 'Consultar la bitácora de auditoría')
       ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description`,
    );
    await transaction.query(
      `INSERT INTO roles (id, site_id, code, name)
       VALUES ($1, $2, 'ADMINISTRATOR', 'Administrador')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [ids.administratorRole, ids.site],
    );
    await transaction.query(
      `INSERT INTO role_permissions (role_id, permission_code)
       SELECT $1, code FROM permissions
       ON CONFLICT DO NOTHING`,
      [ids.administratorRole],
    );
    await transaction.query(
      `INSERT INTO app_users (id, site_id, employee_code, display_name)
       VALUES ($1, $2, 'ADMIN', 'Administrador')
       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [ids.administratorUser, ids.site],
    );
    await transaction.query(
      `INSERT INTO user_roles (user_id, role_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [ids.administratorUser, ids.administratorRole],
    );
    await transaction.query(
      `INSERT INTO user_pin_credentials (user_id, pin_hash)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
       SET pin_hash = EXCLUDED.pin_hash, failed_attempts = 0,
           locked_until = NULL, updated_at = now()`,
      [ids.administratorUser, pinHash],
    );
  });

  console.info("Datos piloto creados. Usuario: ADMIN");
} finally {
  await database.close();
}
