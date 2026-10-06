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

@Injectable()
export class AppConfigService {
  readonly nodeEnv = process.env.NODE_ENV ?? "development";
  readonly apiHost = process.env.API_HOST ?? "0.0.0.0";
  readonly apiPort = readInteger("API_PORT", 3000);
  readonly databaseUrl =
    process.env.DATABASE_URL ??
    "postgresql://antojit:antojit@127.0.0.1:5432/antojit_os";
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
  }
}

