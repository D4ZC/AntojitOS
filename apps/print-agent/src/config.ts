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

const boundedInteger = (name: string, fallback: number, minimum: number, maximum: number): number => {
  const raw = process.env[name];
  const parsed = Number(raw ?? fallback);
  if (raw?.trim() === "" || !Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} debe ser un entero entre ${minimum} y ${maximum}`);
  }
  return parsed;
};

export interface AgentConfig {
  apiUrl: string;
  mode: "simulator" | "tcp" | "system";
  siteCode: string;
  code: string;
  displayName: string;
  centerCodes: string[];
  registerCodes: string[];
  bootstrapToken?: string;
  agentId?: string;
  agentToken?: string;
  credentialsPath: string;
  simulatorOutputDirectory: string;
  printerHost?: string;
  printerPort: number;
  printerQueue?: string;
  printerTimeoutMs: number;
  printerColumns: number;
  printerEncoding: "cp858";
  printerCodePage: number;
  pollIntervalMs: number;
}

export const readConfig = (): AgentConfig => {
  loadEnvironment();
  const mode = process.env.PRINT_AGENT_MODE ?? "simulator";
  if (mode !== "simulator" && mode !== "tcp" && mode !== "system") {
    throw new Error("PRINT_AGENT_MODE debe ser simulator, tcp o system");
  }
  const centerCodes = (process.env.PRINT_AGENT_CENTERS ?? "KITCHEN,BAR")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  const registerCodes = (process.env.PRINT_AGENT_REGISTERS ?? "MAIN")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  if (centerCodes.length === 0 && registerCodes.length === 0) {
    throw new Error("Se requiere al menos un centro de producción o una caja");
  }
  const printerHost = process.env.PRINTER_HOST?.trim() || undefined;
  if (mode === "tcp" && !printerHost) throw new Error("PRINTER_HOST es obligatorio en modo tcp");
  const printerQueue = process.env.PRINTER_QUEUE?.trim() || undefined;
  if (mode === "system" && !printerQueue) throw new Error("PRINTER_QUEUE es obligatorio en modo system");
  if (printerQueue && (printerQueue.length > 255 || /[\u0000-\u001f\u007f]/.test(printerQueue))) {
    throw new Error("PRINTER_QUEUE debe contener el nombre de una cola sin caracteres de control");
  }
  const printerEncoding = (process.env.PRINTER_ENCODING ?? "cp858").trim().toLowerCase();
  if (printerEncoding !== "cp858") throw new Error("PRINTER_ENCODING debe ser cp858");

  return {
    apiUrl: (process.env.PRINT_AGENT_API_URL ?? "http://127.0.0.1:3000/api").replace(/\/$/, ""),
    mode,
    siteCode: (process.env.PRINT_AGENT_SITE_CODE ?? "PILOT").toUpperCase(),
    code: (process.env.PRINT_AGENT_CODE ?? "PRINT-01").toUpperCase(),
    displayName: process.env.PRINT_AGENT_NAME ?? "Agente de impresión principal",
    centerCodes,
    registerCodes,
    bootstrapToken: process.env.BOOTSTRAP_TOKEN,
    agentId: process.env.PRINT_AGENT_ID,
    agentToken: process.env.PRINT_AGENT_TOKEN,
    credentialsPath: resolve(process.env.PRINT_AGENT_CREDENTIALS_PATH ?? "var/print-agent/credentials.json"),
    simulatorOutputDirectory: resolve(process.env.PRINT_AGENT_OUTPUT_DIR ?? "var/print-simulator"),
    printerHost,
    printerPort: boundedInteger("PRINTER_PORT", 9100, 1, 65535),
    printerQueue,
    // Claims expire after 30 seconds; leave time to acknowledge the API.
    printerTimeoutMs: boundedInteger("PRINTER_TIMEOUT_MS", 10_000, 1, 25_000),
    printerColumns: boundedInteger("PRINTER_COLUMNS", 42, 24, 56),
    printerEncoding,
    printerCodePage: boundedInteger("PRINTER_CODE_PAGE", 19, 0, 255),
    pollIntervalMs: positiveInteger(process.env.PRINT_AGENT_POLL_MS, 1000),
  };
};
