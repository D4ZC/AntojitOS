import { HttpException, UnauthorizedException } from "@nestjs/common";
import { hash } from "@node-rs/argon2";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthService } from "../src/auth/auth.service.js";
import { AppConfigService } from "../src/config/app-config.service.js";
import { runMigrations } from "../src/database/run-migrations.js";
import { hashDeviceToken } from "../src/security/token.js";
import { TestDatabase } from "./test-database.js";

const ids = {
  site: "00000000-0000-4000-8000-000000000001",
  terminal: "00000000-0000-4000-8000-000000000101",
  role: "00000000-0000-4000-8000-000000000010",
  user: "00000000-0000-4000-8000-000000000020",
};
const deviceToken = "registered-device-token";

let database: TestDatabase;
let auth: AuthService;

beforeEach(async () => {
  database = new TestDatabase();
  await runMigrations(database);
  const pinHash = await hash("1234", {
    memoryCost: 4_096,
    timeCost: 1,
    parallelism: 1,
  });

  await database.query(
    "INSERT INTO sites (id, code, name) VALUES ($1, 'PILOT', 'Piloto')",
    [ids.site],
  );
  await database.query(
    `INSERT INTO terminals (
      id, site_id, code, display_name, profile, device_token_hash
    ) VALUES ($1, $2, 'POS-01', 'Tablet uno', 'pos', $3)`,
    [ids.terminal, ids.site, hashDeviceToken(deviceToken)],
  );
  await database.query(
    "INSERT INTO permissions (code, description) VALUES ('terminal.manage', 'Administrar terminales')",
  );
  await database.query(
    `INSERT INTO roles (id, site_id, code, name)
     VALUES ($1, $2, 'ADMIN', 'Administrador')`,
    [ids.role, ids.site],
  );
  await database.query(
    `INSERT INTO role_permissions (role_id, permission_code)
     VALUES ($1, 'terminal.manage')`,
    [ids.role],
  );
  await database.query(
    `INSERT INTO app_users (id, site_id, employee_code, display_name)
     VALUES ($1, $2, 'ADMIN', 'Administrador')`,
    [ids.user, ids.site],
  );
  await database.query(
    "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)",
    [ids.user, ids.role],
  );
  await database.query(
    "INSERT INTO user_pin_credentials (user_id, pin_hash) VALUES ($1, $2)",
    [ids.user, pinHash],
  );

  auth = new AuthService(database, new AppConfigService());
});

afterEach(async () => {
  await database.close();
});

describe("sesión por PIN y terminal", () => {
  it("crea una sesión opaca y resuelve sus permisos", async () => {
    const login = await auth.login({
      terminalId: ids.terminal,
      employeeCode: "admin",
      pin: "1234",
      deviceToken,
    });
    const context = await auth.resolveToken(login.accessToken);

    expect(login.accessToken).toHaveLength(43);
    expect(login.user.displayName).toBe("Administrador");
    expect(context.terminalId).toBe(ids.terminal);
    expect(context.permissions).toContain("terminal.manage");

    const stored = await database.query<{ token_hash: string }>(
      "SELECT token_hash FROM user_sessions",
    );
    expect(stored.rows[0]?.token_hash).not.toBe(login.accessToken);
  });

  it("rechaza el secreto de otro dispositivo", async () => {
    await expect(
      auth.login({
        terminalId: ids.terminal,
        employeeCode: "ADMIN",
        pin: "1234",
        deviceToken: "not-the-registered-token",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("bloquea temporalmente después de cinco PIN incorrectos", async () => {
    const input = {
      terminalId: ids.terminal,
      employeeCode: "ADMIN",
      pin: "0000",
      deviceToken,
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(auth.login(input)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }

    try {
      await auth.login({ ...input, pin: "1234" });
      throw new Error("La credencial bloqueada permitió iniciar sesión");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(423);
    }
  });
});

