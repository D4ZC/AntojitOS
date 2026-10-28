import { hash } from "@node-rs/argon2";
import { randomInt, randomUUID } from "node:crypto";
import type { DatabasePort } from "./database.port.js";

/** Adds the dedicated cashier to existing sites without resetting an existing PIN. */
export const provisionCashierAccounts = async (
  database: DatabasePort,
  options: { pin?: string; resetPin?: boolean } = {},
): Promise<void> => {
  const configuredPin = options.pin ?? process.env.SEED_CASHIER_PIN;
  if (configuredPin !== undefined && !/^\d{4,8}$/u.test(configuredPin)) {
    throw new Error("SEED_CASHIER_PIN debe contener entre 4 y 8 dígitos");
  }
  const sites = await database.query<{ id: string; code: string }>("SELECT id, code FROM sites");
  for (const site of sites.rows) {
    const pin = configuredPin ?? (process.env.NODE_ENV === "production"
      ? String(randomInt(100_000, 1_000_000))
      : "3456");
    let insertedCredential = false;
    await database.transaction(async (transaction) => {
      const role = await transaction.query<{ id: string }>(
        `INSERT INTO roles (id, site_id, code, name) VALUES ($1, $2, 'CASHIER', 'Cajero')
         ON CONFLICT (site_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [randomUUID(), site.id],
      );
      const roleId = role.rows[0]!.id;
      await transaction.query("DELETE FROM role_permissions WHERE role_id = $1", [roleId]);
      await transaction.query(
        `INSERT INTO role_permissions (role_id, permission_code)
         SELECT $1, code FROM permissions WHERE code IN (
           'catalog.read', 'service.account.open', 'service.account.read',
           'service.item.add', 'service.item.edit', 'service.item.cancel',
           'service.round.send', 'service.account.manage', 'service.precheck.create',
           'customers.read', 'customers.manage',
           'cash.shift.read', 'cash.shift.open', 'cash.shift.close', 'sales.payment.capture'
         ) ON CONFLICT DO NOTHING`, [roleId],
      );
      const user = await transaction.query<{ id: string }>(
        `INSERT INTO app_users (id, site_id, employee_code, display_name)
         VALUES ($1, $2, 'CAJERO', 'Cajero')
         ON CONFLICT (site_id, employee_code) DO UPDATE SET display_name = EXCLUDED.display_name
         RETURNING id`, [randomUUID(), site.id],
      );
      const userId = user.rows[0]!.id;
      await transaction.query("DELETE FROM user_roles WHERE user_id = $1", [userId]);
      await transaction.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)", [userId, roleId]);
      const credential = await transaction.query("SELECT user_id FROM user_pin_credentials WHERE user_id = $1", [userId]);
      if (credential.rowCount && !options.resetPin) return;
      const pinHash = await hash(pin, { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 });
      const inserted = await transaction.query(
        `INSERT INTO user_pin_credentials (user_id, pin_hash) VALUES ($1, $2)
         ON CONFLICT (user_id) DO ${options.resetPin
          ? "UPDATE SET pin_hash = EXCLUDED.pin_hash, failed_attempts = 0, locked_until = NULL, updated_at = now()"
          : "NOTHING"} RETURNING user_id`, [userId, pinHash],
      );
      insertedCredential = inserted.rowCount > 0;
    });
    if (insertedCredential && configuredPin === undefined && process.env.NODE_ENV === "production") {
      console.info(`Código CAJERO (${site.code}): ${pin}`);
    }
  }
};
