import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "../src/config.js";
import { renderEscPos, renderPlainTicket } from "../src/escpos.js";
import { printJob } from "../src/printer.js";
import type { PrintJob } from "../src/types.js";
import { windowsSpoolerScript } from "../src/windows-spooler.js";

const { spawn, mkdir, writeFile, createConnection } = vi.hoisted(() => ({
  spawn: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn(), createConnection: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn }));
vi.mock("node:fs/promises", () => ({ mkdir, writeFile }));
vi.mock("node:net", () => ({ createConnection }));

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn(() => true);
}

const config = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  apiUrl: "http://localhost:3000/api", mode: "system", siteCode: "PILOT", code: "PRINT-01",
  displayName: "Bixolon", centerCodes: [], registerCodes: ["MAIN"],
  credentialsPath: "/unused/credentials.json", simulatorOutputDirectory: "/unused/simulator",
  printerQueue: "BIXOLON_SRP_F310", printerPort: 9100, printerTimeoutMs: 1000,
  printerColumns: 48, printerEncoding: "cp858", printerCodePage: 19, pollIntervalMs: 1000,
  ...overrides,
});
const job: PrintJob = {
  id: "job-1", ticketId: "ticket-1", receiptId: null, shiftCloseId: null,
  attempt: 2, claimToken: "claim-token", kind: "addition",
  payload: {
    ticketId: "ticket-1", kind: "addition", center: { id: "center-1", code: "KITCHEN", name: "Cocina" },
    service: { accountId: "account-1", type: "table", label: "Mesa 9" }, roundSequence: 1,
    items: [{ productName: "Flauta", quantity: 2, note: "Con crema", modifiers: ["Con todo"] }],
  },
};

const platform = (value: NodeJS.Platform) => {
  vi.stubGlobal("process", new Proxy(process, { get: (target, property) => property === "platform" ? value : Reflect.get(target, property) }));
};

let child: FakeChild;
beforeEach(() => {
  vi.useFakeTimers();
  child = new FakeChild();
  spawn.mockReturnValue(child);
  mkdir.mockResolvedValue(undefined);
  writeFile.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("transporte de la impresora sin trabajos físicos", () => {
  it("envía bytes RAW a CUPS por stdin con argumentos independientes y espera su confirmación", async () => {
    platform("darwin");
    const queue = "Bixolon;$(no-ejecutar)";
    let completed = false;
    const result = printJob(config({ printerQueue: queue }), job).then(() => { completed = true; });
    const [command, args, options] = spawn.mock.calls[0]!;
    expect(command).toBe("lp");
    expect(args).toEqual(["-d", queue, "-o", "raw", "-t", "AntojitOS job-1 intento 2"]);
    expect(options).toMatchObject({ shell: false, env: { LC_ALL: "C", LANG: "C" } });
    expect(child.stdin.read()).toEqual(Buffer.from(renderEscPos(job.payload, { columns: 48, encoding: "cp858", codePage: 19 })));
    await Promise.resolve();
    expect(completed).toBe(false);
    child.stdout.write("request id is BIXOLON_SRP_F310-123 (1 file(s))\n");
    child.emit("close", 0, null);
    await result;
    expect(completed).toBe(true);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("usa el spooler RAW de Windows con programa estático y datos separados del comando", async () => {
    platform("win32");
    const queue = "BIXOLON ' Caja & $(no-ejecutar)";
    const result = printJob(config({ printerQueue: queue }), job);
    const [command, args, options] = spawn.mock.calls[0]!;
    expect(command).toMatch(/WindowsPowerShell\\v1\.0\\powershell\.exe$/);
    expect(args).toContain("-NonInteractive");
    expect(args).toContain("-NoProfile");
    const decoded = Buffer.from(args.at(-1), "base64").toString("utf16le");
    expect(decoded).toBe(windowsSpoolerScript);
    expect(decoded).toContain('DataType = "RAW"');
    expect(decoded).toContain("written != bytes.Length");
    expect(decoded).not.toContain(queue);
    expect(options).toMatchObject({ shell: false, windowsHide: true, env: { ANTOJIT_RAW_PRINTER_QUEUE: queue } });
    expect(child.stdin.read()).toBeInstanceOf(Buffer);
    child.stdout.write("ANTOJIT_SPOOL_JOB=42\r\n");
    child.emit("close", 0, null);
    await result;
  });

  it("no confirma éxito si el spooler sale sin identificador o rechaza el trabajo", async () => {
    platform("linux");
    const noAck = printJob(config(), job);
    child.emit("close", 0, null);
    await expect(noAck).rejects.toThrow("sin confirmar un identificador");
    child = new FakeChild(); spawn.mockReturnValue(child);
    const rejected = printJob(config(), job);
    child.stderr.write("lp: printer not found");
    child.emit("close", 1, null);
    await expect(rejected).rejects.toThrow("lp: printer not found");
  });

  it("mata el proceso cuando se agota el tiempo sin confirmar la cola", async () => {
    platform("linux");
    const result = printJob(config({ printerTimeoutMs: 500 }), job);
    const rejected = expect(result).rejects.toThrow("Tiempo agotado esperando confirmación");
    await vi.advanceTimersByTimeAsync(500);
    await rejected;
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("propaga programa ausente y escritura incompleta sin confirmar", async () => {
    platform("linux");
    const unavailable = printJob(config(), job);
    child.emit("error", new Error("ENOENT"));
    await expect(unavailable).rejects.toThrow("No se pudo abrir la cola del sistema: ENOENT");
    child = new FakeChild(); spawn.mockReturnValue(child);
    const broken = printJob(config(), job);
    child.stdin.emit("error", new Error("EPIPE"));
    await expect(broken).rejects.toThrow("La cola no recibió la comanda: EPIPE");
  });

  it("conserva en el simulador texto y bytes con el mismo ancho sin invocar el sistema", async () => {
    await printJob(config({ mode: "simulator", printerColumns: 32 }), job);
    expect(writeFile).toHaveBeenCalledWith(
      "/unused/simulator/job-1-attempt-2.txt", renderPlainTicket(job.payload, { columns: 32 }), { flag: "wx" },
    );
    expect(writeFile).toHaveBeenCalledWith(
      "/unused/simulator/job-1-attempt-2.bin", renderEscPos(job.payload, { columns: 32, encoding: "cp858", codePage: 19 }), { flag: "wx" },
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it("envía por TCP el mismo ESC/POS y espera a terminar la escritura", async () => {
    const socket = new EventEmitter() as EventEmitter & {
      setTimeout: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    };
    socket.setTimeout = vi.fn(); socket.destroy = vi.fn(); socket.end = vi.fn();
    createConnection.mockReturnValue(socket);
    let completed = false;
    const result = printJob(config({ mode: "tcp", printerHost: "192.168.1.50" }), job).then(() => { completed = true; });
    expect(createConnection).toHaveBeenCalledWith({ host: "192.168.1.50", port: 9100 });
    expect(socket.setTimeout).toHaveBeenCalledWith(1000);
    socket.emit("connect");
    expect(socket.end.mock.calls[0]?.[0]).toEqual(renderEscPos(job.payload, { columns: 48, encoding: "cp858", codePage: 19 }));
    await Promise.resolve();
    expect(completed).toBe(false);
    socket.end.mock.calls[0]![1]();
    await result;
    expect(completed).toBe(true);
    expect(socket.destroy).toHaveBeenCalled();
  });

  it("rechaza un socket TCP cerrado antes de enviar y errores al terminar la escritura", async () => {
    const socket = new EventEmitter() as EventEmitter & {
      setTimeout: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    };
    socket.setTimeout = vi.fn(); socket.destroy = vi.fn(); socket.end = vi.fn();
    createConnection.mockReturnValue(socket);
    const result = printJob(config({ mode: "tcp", printerHost: "192.168.1.50" }), job);
    socket.emit("close");
    await expect(result).rejects.toThrow("antes de completar el envío");
    const other = new EventEmitter() as typeof socket;
    other.setTimeout = vi.fn(); other.destroy = vi.fn(); other.end = vi.fn();
    createConnection.mockReturnValue(other);
    const failed = printJob(config({ mode: "tcp", printerHost: "192.168.1.50" }), job);
    other.emit("connect");
    other.end.mock.calls[0]![1](new Error("EPIPE"));
    await expect(failed).rejects.toThrow("EPIPE");
  });

  it("no usa red ni colas si faltan datos o la plataforma no soporta el transporte", async () => {
    await expect(printJob(config({ printerQueue: undefined }), job)).rejects.toThrow("PRINTER_QUEUE");
    await expect(printJob(config({ mode: "tcp", printerHost: undefined }), job)).rejects.toThrow("PRINTER_HOST");
    platform("aix");
    await expect(printJob(config(), job)).rejects.toThrow("Windows, macOS o Linux");
    expect(spawn).not.toHaveBeenCalled();
    expect(createConnection).not.toHaveBeenCalled();
  });
});
