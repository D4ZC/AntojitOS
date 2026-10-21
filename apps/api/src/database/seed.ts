import { hash } from "@node-rs/argon2";
import { AppConfigService } from "../config/app-config.service.js";
import { loadEnvironment } from "../config/load-environment.js";
import { applyPilotCatalog } from "./pilot-catalog.js";
import { PostgresDatabase } from "./postgres-database.js";
import { runMigrations } from "./run-migrations.js";

const ids = {
  site: "00000000-0000-4000-8000-000000000001",
  administratorRole: "00000000-0000-4000-8000-000000000010",
  waiterRole: "00000000-0000-4000-8000-000000000011",
  administratorUser: "00000000-0000-4000-8000-000000000020",
  waiterUser: "00000000-0000-4000-8000-000000000021",
  kitchen: "00000000-0000-4000-8000-000000000201",
  bar: "00000000-0000-4000-8000-000000000202",
  mainArea: "00000000-0000-4000-8000-000000000210",
  tax: "00000000-0000-4000-8000-000000000230",
  cashRegister: "00000000-0000-4000-8000-000000000600",
  cashPaymentMethod: "00000000-0000-4000-8000-000000000610",
  cardPaymentMethod: "00000000-0000-4000-8000-000000000611",
  transferPaymentMethod: "00000000-0000-4000-8000-000000000612",
};

loadEnvironment();

const config = new AppConfigService();
const database = new PostgresDatabase(config.databaseUrl);
const adminPin = process.env.SEED_ADMIN_PIN ?? "1234";
const waiterPin = process.env.SEED_WAITER_PIN ?? "2345";

try {
  await runMigrations(database);
  const adminPinHash = await hash(adminPin, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  });
  const waiterPinHash = await hash(waiterPin, {
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
      `INSERT INTO cash_registers (id, site_id, code, name)
       VALUES ($1, $2, 'MAIN', 'Caja principal')
       ON CONFLICT (site_id, code) DO UPDATE
       SET name = EXCLUDED.name, active = true`,
      [ids.cashRegister, ids.site],
    );
    await transaction.query(
      `INSERT INTO payment_methods (
         id, site_id, code, name, supports_change, requires_reference, display_order
       ) VALUES
         ($1, $4, 'CASH', 'Efectivo', true, false, 1),
         ($2, $4, 'CARD', 'Tarjeta', false, true, 2),
         ($3, $4, 'TRANSFER', 'Transferencia', false, true, 3)
       ON CONFLICT (site_id, code) DO UPDATE SET
         name = EXCLUDED.name,
         supports_change = EXCLUDED.supports_change,
         requires_reference = EXCLUDED.requires_reference,
         display_order = EXCLUDED.display_order,
         active = true`,
      [
        ids.cashPaymentMethod,
        ids.cardPaymentMethod,
        ids.transferPaymentMethod,
        ids.site,
      ],
    );
    await transaction.query(
      `INSERT INTO permissions (code, description) VALUES
        ('terminal.manage', 'Modificar configuración de terminales'),
        ('audit.read', 'Consultar la bitácora de auditoría')
       ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description`,
    );
    await transaction.query(
      `INSERT INTO roles (id, site_id, code, name) VALUES
        ($1, $3, 'ADMINISTRATOR', 'Administrador'),
        ($2, $3, 'WAITER', 'Mesero')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [ids.administratorRole, ids.waiterRole, ids.site],
    );
    await transaction.query(
      `INSERT INTO role_permissions (role_id, permission_code)
       SELECT $1, code FROM permissions
       ON CONFLICT DO NOTHING`,
      [ids.administratorRole],
    );
    await transaction.query(
      `INSERT INTO role_permissions (role_id, permission_code)
       SELECT $1, code FROM permissions
        WHERE code IN (
          'catalog.read', 'service.account.open', 'service.account.read',
          'service.item.add', 'service.item.edit', 'service.item.cancel',
          'service.round.send', 'service.account.manage',
          'service.precheck.create'
        )
       ON CONFLICT DO NOTHING`,
      [ids.waiterRole],
    );
    await transaction.query(
      `INSERT INTO app_users (id, site_id, employee_code, display_name) VALUES
        ($1, $3, 'ADMIN', 'Administrador'),
        ($2, $3, 'MESERO', 'Mesero de prueba')
       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [ids.administratorUser, ids.waiterUser, ids.site],
    );
    await transaction.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES
        ($1, $3),
        ($2, $4)
       ON CONFLICT DO NOTHING`,
      [ids.administratorUser, ids.waiterUser, ids.administratorRole, ids.waiterRole],
    );
    await transaction.query(
      `INSERT INTO user_pin_credentials (user_id, pin_hash) VALUES
        ($1, $3),
        ($2, $4)
       ON CONFLICT (user_id) DO UPDATE
       SET pin_hash = EXCLUDED.pin_hash, failed_attempts = 0,
           locked_until = NULL, updated_at = now()`,
      [ids.administratorUser, ids.waiterUser, adminPinHash, waiterPinHash],
    );

    await transaction.query(
      `INSERT INTO production_centers (id, site_id, code, name) VALUES
        ($1, $3, 'KITCHEN', 'Cocina'),
        ($2, $3, 'BAR', 'Barra')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [ids.kitchen, ids.bar, ids.site],
    );
    await transaction.query(
      `INSERT INTO dining_areas (id, site_id, code, name, display_order)
       VALUES ($1, $2, 'MAIN', 'Comedor', 1)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [ids.mainArea, ids.site],
    );
    for (let index = 1; index <= 8; index += 1) {
      const suffix = (219 + index).toString().padStart(12, "0");
      await transaction.query(
        `INSERT INTO service_tables (
          id, site_id, dining_area_id, code, name, capacity, display_order
        ) VALUES ($1, $2, $3, $4, $5, 4, $6)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [
          `00000000-0000-4000-8000-${suffix}`,
          ids.site,
          ids.mainArea,
          `TABLE-${index}`,
          `Mesa ${index}`,
          index,
        ],
      );
    }
    await transaction.query(
      `INSERT INTO tax_rules (
        id, site_id, code, name, rate_basis_points, price_includes_tax
      ) VALUES ($1, $2, 'IVA-16', 'IVA 16%', 1600, true)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name, rate_basis_points = EXCLUDED.rate_basis_points`,
      [ids.tax, ids.site],
    );
    await applyPilotCatalog(transaction, {
      siteId: ids.site,
      kitchenId: ids.kitchen,
      taxRuleId: ids.tax,
    });
  });

  console.info("Datos piloto creados. Usuarios: ADMIN y MESERO");
} finally {
  await database.close();
}
