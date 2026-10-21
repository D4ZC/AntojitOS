import { afterEach, describe, expect, it, vi } from "vitest";
import { AppConfigService } from "../src/config/app-config.service.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("configuración de la aplicación", () => {
  it("construye la conexión del piloto sin exponer una contraseña sin escapar", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("POSTGRES_USER", "antojit");
    vi.stubEnv("POSTGRES_PASSWORD", "secret/with@symbols");
    vi.stubEnv("POSTGRES_HOST", "postgres");
    vi.stubEnv("POSTGRES_PORT", "5433");
    vi.stubEnv("POSTGRES_DB", "antojit_os");

    expect(new AppConfigService().databaseUrl).toBe(
      "postgresql://antojit:secret%2Fwith%40symbols@postgres:5433/antojit_os",
    );
  });

  it("conserva DATABASE_URL cuando fue configurada explícitamente", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://custom/database");
    vi.stubEnv("POSTGRES_PASSWORD", "ignored-password");

    expect(new AppConfigService().databaseUrl).toBe(
      "postgresql://custom/database",
    );
  });

  it("rechaza secretos débiles en producción", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("BOOTSTRAP_TOKEN", "short");
    vi.stubEnv("SESSION_PEPPER", "short");
    vi.stubEnv("POSTGRES_PASSWORD", "short");

    expect(() => new AppConfigService()).toThrow(
      "BOOTSTRAP_TOKEN y SESSION_PEPPER",
    );
  });
});
