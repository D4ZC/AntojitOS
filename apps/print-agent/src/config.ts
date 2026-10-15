import { existsSync } from "node:fs";
import { resolve } from "node:path";

const loadEnvironment = (): void => {
  for (const candidate of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
  }
};

const positiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("Configuración numérica inválida");
  return parsed;
};

export interface AgentConfig {
  apiUrl: string;
  mode: "simulator" | "tcp";
  siteCode: string;
  code: string;
  displayName: string;
  centerCodes: string[];
  bootstrapToken?: string;
  agentId?: string;
  agentToken?: string;
  credentialsPath: string;
  simulatorOutputDirectory: string;
  printerHost?: string;
  printerPort: number;
  pollIntervalMs: number;
}

export const readConfig = (): AgentConfig => {
  loadEnvironment();
  const mode = process.env.PRINT_AGENT_MODE ?? "simulator";
  if (mode !== "simulator" && mode !== "tcp") {
    throw new Error("PRINT_AGENT_MODE debe ser simulator o tcp");
  }
  const centerCodes = (process.env.PRINT_AGENT_CENTERS ?? "KITCHEN,BAR")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  if (centerCodes.length === 0) throw new Error("Se requiere al menos un centro de producción");
  const printerHost = process.env.PRINTER_HOST;
  if (mode === "tcp" && !printerHost) throw new Error("PRINTER_HOST es obligatorio en modo tcp");

  return {
    apiUrl: (process.env.PRINT_AGENT_API_URL ?? "http://127.0.0.1:3000/api").replace(/\/$/, ""),
    mode,
    siteCode: (process.env.PRINT_AGENT_SITE_CODE ?? "PILOT").toUpperCase(),
    code: (process.env.PRINT_AGENT_CODE ?? "PRINT-01").toUpperCase(),
    displayName: process.env.PRINT_AGENT_NAME ?? "Agente de impresión principal",
    centerCodes,
    bootstrapToken: process.env.BOOTSTRAP_TOKEN,
    agentId: process.env.PRINT_AGENT_ID,
    agentToken: process.env.PRINT_AGENT_TOKEN,
    credentialsPath: resolve(process.env.PRINT_AGENT_CREDENTIALS_PATH ?? "var/print-agent/credentials.json"),
    simulatorOutputDirectory: resolve(process.env.PRINT_AGENT_OUTPUT_DIR ?? "var/print-simulator"),
    printerHost,
    printerPort: positiveInteger(process.env.PRINTER_PORT, 9100),
    pollIntervalMs: positiveInteger(process.env.PRINT_AGENT_POLL_MS, 1000),
  };
};
