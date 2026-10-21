import { Injectable } from "@nestjs/common";

const readInteger = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} debe ser un entero positivo`);
  }

  return parsed;
};

const databaseUrlFromEnvironment = (): string => {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const password = process.env.POSTGRES_PASSWORD;
  if (!password) {
    return "postgresql://antojit:antojit@127.0.0.1:5432/antojit_os";
  }

  const user = process.env.POSTGRES_USER ?? "antojit";
  const host = process.env.POSTGRES_HOST ?? "127.0.0.1";
  const port = readInteger("POSTGRES_PORT", 5432);
  const database = process.env.POSTGRES_DB ?? "antojit_os";

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
};

@Injectable()
export class AppConfigService {
  readonly nodeEnv = process.env.NODE_ENV ?? "development";
  readonly apiHost = process.env.API_HOST ?? "0.0.0.0";
  readonly apiPort = readInteger("API_PORT", 3000);
  readonly databaseUrl = databaseUrlFromEnvironment();
  readonly bootstrapToken =
    process.env.BOOTSTRAP_TOKEN ?? "development-bootstrap-token";
  readonly sessionPepper =
    process.env.SESSION_PEPPER ?? "development-session-pepper-change-before-production";
  readonly sessionTtlHours = readInteger("SESSION_TTL_HOURS", 12);

  constructor() {
    if (
      this.nodeEnv === "production" &&
      (this.bootstrapToken.length < 24 || this.sessionPepper.length < 32)
    ) {
      throw new Error(
        "BOOTSTRAP_TOKEN y SESSION_PEPPER deben configurarse con secretos fuertes en producción",
      );
    }

    if (
      this.nodeEnv === "production" &&
      !process.env.DATABASE_URL &&
      (process.env.POSTGRES_PASSWORD?.length ?? 0) < 16
    ) {
      throw new Error(
        "POSTGRES_PASSWORD debe tener al menos 16 caracteres en producción",
      );
    }
  }
}
