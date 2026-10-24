import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readConfig } from "../src/config.js";

vi.mock("node:fs", () => ({ existsSync: vi.fn(() => false) }));

const environmentNames = [
  "PRINT_AGENT_MODE", "PRINT_AGENT_API_URL", "PRINT_AGENT_CENTERS", "PRINT_AGENT_REGISTERS",
  "PRINT_AGENT_POLL_MS", "PRINTER_HOST", "PRINTER_PORT", "PRINTER_QUEUE", "PRINTER_TIMEOUT_MS",
  "PRINTER_COLUMNS", "PRINTER_ENCODING", "PRINTER_CODE_PAGE",
];
beforeEach(() => { for (const name of environmentNames) vi.stubEnv(name, undefined); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("configuración del agente de impresión", () => {
  it("mantiene el simulador como valor inicial con perfil 80 mm y CP858", () => {
    expect(readConfig()).toMatchObject({
      mode: "simulator", printerPort: 9100, printerTimeoutMs: 10_000,
      printerColumns: 42, printerEncoding: "cp858", printerCodePage: 19,
      centerCodes: ["KITCHEN", "BAR"], registerCodes: ["MAIN"],
    });
  });

  it("requiere dirección en TCP y cola instalada en modo system", () => {
    vi.stubEnv("PRINT_AGENT_MODE", "tcp");
    expect(() => readConfig()).toThrow("PRINTER_HOST");
    vi.stubEnv("PRINTER_HOST", " 192.168.1.50 ");
    expect(readConfig()).toMatchObject({ mode: "tcp", printerHost: "192.168.1.50" });
    vi.stubEnv("PRINT_AGENT_MODE", "system");
    expect(() => readConfig()).toThrow("PRINTER_QUEUE");
    vi.stubEnv("PRINTER_QUEUE", " BIXOLON SRP-F310 ");
    expect(readConfig()).toMatchObject({ mode: "system", printerQueue: "BIXOLON SRP-F310" });
  });

  it("acepta una impresora de caja sin centros de producción", () => {
    vi.stubEnv("PRINT_AGENT_CENTERS", "");
    vi.stubEnv("PRINT_AGENT_REGISTERS", " main ");
    expect(readConfig()).toMatchObject({ centerCodes: [], registerCodes: ["MAIN"] });
    vi.stubEnv("PRINT_AGENT_REGISTERS", " ");
    expect(() => readConfig()).toThrow("al menos un centro de producción o una caja");
  });

  it("acepta impresora de cocina sin caja y normaliza sus destinos", () => {
    vi.stubEnv("PRINT_AGENT_CENTERS", " kitchen, bar ");
    vi.stubEnv("PRINT_AGENT_REGISTERS", "");
    expect(readConfig()).toMatchObject({ centerCodes: ["KITCHEN", "BAR"], registerCodes: [] });
  });

  it.each([
    ["PRINTER_PORT", "0"], ["PRINTER_PORT", "65536"], ["PRINTER_PORT", "9100.5"],
    ["PRINTER_TIMEOUT_MS", "0"], ["PRINTER_TIMEOUT_MS", "25001"],
    ["PRINTER_COLUMNS", "23"], ["PRINTER_COLUMNS", "57"],
    ["PRINTER_CODE_PAGE", "-1"], ["PRINTER_CODE_PAGE", "256"], ["PRINTER_CODE_PAGE", ""],
  ])("rechaza %s=%s fuera del rango permitido", (name, value) => {
    vi.stubEnv(name, value);
    expect(() => readConfig()).toThrow(name);
  });

  it("acepta límites de columnas y página cero sin convertirla en el valor inicial", () => {
    vi.stubEnv("PRINTER_COLUMNS", "24");
    vi.stubEnv("PRINTER_CODE_PAGE", "0");
    vi.stubEnv("PRINTER_PORT", "65535");
    expect(readConfig()).toMatchObject({ printerColumns: 24, printerCodePage: 0, printerPort: 65535 });
    vi.stubEnv("PRINTER_COLUMNS", "56");
    expect(readConfig().printerColumns).toBe(56);
  });

  it("rechaza codificaciones no implementadas, modos desconocidos y nombres de cola con controles", () => {
    vi.stubEnv("PRINTER_ENCODING", "utf8");
    expect(() => readConfig()).toThrow("PRINTER_ENCODING debe ser cp858");
    vi.stubEnv("PRINTER_ENCODING", "CP858");
    expect(readConfig().printerEncoding).toBe("cp858");
    vi.stubEnv("PRINT_AGENT_MODE", "usb");
    expect(() => readConfig()).toThrow("PRINT_AGENT_MODE");
    vi.stubEnv("PRINT_AGENT_MODE", "system");
    vi.stubEnv("PRINTER_QUEUE", "Bixolon\nOtra cola");
    expect(() => readConfig()).toThrow("PRINTER_QUEUE");
  });
});
