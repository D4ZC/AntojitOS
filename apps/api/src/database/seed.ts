import { hash } from "@node-rs/argon2";
import { AppConfigService } from "../config/app-config.service.js";
import { loadEnvironment } from "../config/load-environment.js";
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
};

const categories = [
  ["00000000-0000-4000-8000-000000000240", "TACOS", "Tacos", "coral", 1],
  ["00000000-0000-4000-8000-000000000241", "ANTOJITOS", "Antojitos", "amber", 2],
  ["00000000-0000-4000-8000-000000000242", "BEBIDAS", "Bebidas", "mint", 3],
  ["00000000-0000-4000-8000-000000000243", "POSTRES", "Postres", "honey", 4],
] as const;

const products = [
  ["00000000-0000-4000-8000-000000000300", categories[0][0], ids.kitchen, "TACO-PASTOR", "Taco al pastor", "🌮", "coral", 1, 2200],
  ["00000000-0000-4000-8000-000000000301", categories[0][0], ids.kitchen, "TACO-ASADA", "Taco de asada", "🌮", "amber", 2, 2600],
  ["00000000-0000-4000-8000-000000000302", categories[0][0], ids.kitchen, "TACO-CAMPECHANO", "Taco campechano", "🌮", "clay", 3, 2800],
  ["00000000-0000-4000-8000-000000000303", categories[1][0], ids.kitchen, "QUESADILLA", "Quesadilla", "🫓", "sun", 1, 4200],
  ["00000000-0000-4000-8000-000000000304", categories[1][0], ids.kitchen, "GRINGA", "Gringa al pastor", "🧀", "peach", 2, 6200],
  ["00000000-0000-4000-8000-000000000305", categories[1][0], ids.kitchen, "SOPE", "Sope especial", "🥙", "sage", 3, 4800],
  ["00000000-0000-4000-8000-000000000306", categories[2][0], ids.bar, "AGUA-HORCHATA", "Agua de horchata", "🥛", "cream", 1, 3500],
  ["00000000-0000-4000-8000-000000000307", categories[2][0], ids.bar, "AGUA-JAMAICA", "Agua de jamaica", "🥤", "berry", 2, 3500],
  ["00000000-0000-4000-8000-000000000308", categories[2][0], ids.bar, "REFRESCO", "Refresco", "🧊", "mint", 3, 3800],
  ["00000000-0000-4000-8000-000000000309", categories[3][0], ids.kitchen, "FLAN", "Flan de la casa", "🍮", "honey", 1, 5200],
] as const;

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
    for (const [id, code, name, color, displayOrder] of categories) {
      await transaction.query(
        `INSERT INTO product_categories (
          id, site_id, code, name, color, display_order
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name, color = EXCLUDED.color,
            display_order = EXCLUDED.display_order`,
        [id, ids.site, code, name, color, displayOrder],
      );
    }
    for (const [
      id,
      categoryId,
      productionCenterId,
      code,
      name,
      emoji,
      color,
      displayOrder,
      priceInCents,
    ] of products) {
      await transaction.query(
        `INSERT INTO products (
          id, site_id, category_id, production_center_id, tax_rule_id,
          code, name, short_name, emoji, color, display_order
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name, short_name = EXCLUDED.short_name,
            category_id = EXCLUDED.category_id,
            production_center_id = EXCLUDED.production_center_id,
            emoji = EXCLUDED.emoji, color = EXCLUDED.color,
            display_order = EXCLUDED.display_order, updated_at = now()`,
        [
          id,
          ids.site,
          categoryId,
          productionCenterId,
          ids.tax,
          code,
          name,
          emoji,
          color,
          displayOrder,
        ],
      );
      await transaction.query(
        `INSERT INTO product_prices (
          id, site_id, product_id, price_list_code, price_in_cents
        ) VALUES ($1, $2, $3, 'DEFAULT', $4)
        ON CONFLICT (site_id, product_id, price_list_code) WHERE active
        DO UPDATE SET price_in_cents = EXCLUDED.price_in_cents`,
        [
          id.replace("0000000003", "0000000004"),
          ids.site,
          id,
          priceInCents,
        ],
      );
    }

    const cookingGroupId = "00000000-0000-4000-8000-000000000500";
    await transaction.query(
      `INSERT INTO modifier_groups (
        id, site_id, code, name, minimum_selections, maximum_selections
      ) VALUES ($1, $2, 'COOKING', 'Preparación', 0, 1)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [cookingGroupId, ids.site],
    );
    await transaction.query(
      `INSERT INTO modifiers (
        id, site_id, modifier_group_id, code, name, display_order
      ) VALUES
        ('00000000-0000-4000-8000-000000000501', $1, $2, 'NO-ONION', 'Sin cebolla', 1),
        ('00000000-0000-4000-8000-000000000502', $1, $2, 'NO-CILANTRO', 'Sin cilantro', 2),
        ('00000000-0000-4000-8000-000000000503', $1, $2, 'EXTRA-SALSA', 'Salsa extra', 3)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [ids.site, cookingGroupId],
    );
    await transaction.query(
      `INSERT INTO product_modifier_groups (product_id, modifier_group_id)
       SELECT id, $1 FROM products WHERE site_id = $2 AND code LIKE 'TACO-%'
       ON CONFLICT DO NOTHING`,
      [cookingGroupId, ids.site],
    );
  });

  console.info("Datos piloto creados. Usuarios: ADMIN y MESERO");
} finally {
  await database.close();
}
