import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { join, win32 } from "node:path";
import type { AgentConfig } from "./config.js";
import { renderEscPos, renderPlainTicket } from "./escpos.js";
import type { PrintJob } from "./types.js";
import { windowsSpoolerScript } from "./windows-spooler.js";

const printTcp = (host: string, port: number, bytes: Uint8Array, timeoutMs: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let settled = false;
    socket.setTimeout(timeoutMs);
    socket.once("error", (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    });
    socket.once("timeout", () => socket.destroy(new Error("Tiempo de espera agotado")));
    socket.once("close", () => {
      if (settled) return;
      settled = true;
      reject(new Error("La conexión terminó antes de completar el envío a la impresora"));
    });
    socket.once("connect", () => {
      socket.end(bytes, (error?: Error) => {
        if (settled) return;
        settled = true;
        socket.setTimeout(0);
        socket.destroy();
        if (error) reject(error);
        else resolve();
      });
    });
  });

const runSpooler = (
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  bytes: Uint8Array,
  timeoutMs: number,
  acknowledged: (stdout: string) => boolean,
): Promise<void> => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: environment,
  });
  let settled = false;
  let stdout = "";
  let stderr = "";
  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) {
      child.kill("SIGKILL");
      reject(error);
    } else resolve();
  };
  const timer = setTimeout(() => finish(new Error(
    "Tiempo agotado esperando confirmación de la cola; verifica el trabajo antes de reimprimir",
  )), timeoutMs);
  child.once("error", (error) => finish(new Error(`No se pudo abrir la cola del sistema: ${error.message}`)));
  child.stdin.once("error", (error) => finish(new Error(`La cola no recibió la comanda: ${error.message}`)));
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
    if (stdout.length > 65_536) finish(new Error("Respuesta de la cola demasiado grande"));
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
    if (stderr.length > 65_536) finish(new Error("Respuesta de error de la cola demasiado grande"));
  });
  child.once("close", (code, signal) => {
    if (code !== 0) {
      finish(new Error(`La cola rechazó el trabajo (${signal ?? code ?? "sin salida"})${stderr.trim() ? `: ${stderr.trim().slice(0, 1000)}` : ""}`));
    } else if (!acknowledged(stdout)) {
      finish(new Error("La cola terminó sin confirmar un identificador de trabajo; verifica antes de reimprimir"));
    } else finish();
  });
  child.stdin.end(bytes);
});

const printSystem = (config: AgentConfig, job: PrintJob, bytes: Uint8Array): Promise<void> => {
  if (!config.printerQueue) throw new Error("No se configuró PRINTER_QUEUE");
  const documentName = `AntojitOS ${job.id} intento ${job.attempt}`;
  if (process.platform === "win32") {
    const powershell = win32.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    return runSpooler(powershell, [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-OutputFormat", "Text", "-EncodedCommand",
      Buffer.from(windowsSpoolerScript, "utf16le").toString("base64"),
    ], {
      ...process.env, ANTOJIT_RAW_PRINTER_QUEUE: config.printerQueue, ANTOJIT_RAW_DOCUMENT_NAME: documentName,
    }, bytes, config.printerTimeoutMs, (output) => /^ANTOJIT_SPOOL_JOB=[1-9]\d*\s*$/m.test(output));
  }
  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw new Error("El modo system requiere Windows, macOS o Linux con cola de impresión");
  }
  return runSpooler("lp", ["-d", config.printerQueue, "-o", "raw", "-t", documentName], {
    ...process.env, LC_ALL: "C", LANG: "C",
  }, bytes, config.printerTimeoutMs, (output) => /^request id is [^\r\n]+-[1-9]\d*\s*\(/m.test(output));
};

const printSimulator = async (
  outputDirectory: string,
  job: PrintJob,
  bytes: Uint8Array,
  columns: number,
): Promise<void> => {
  await mkdir(outputDirectory, { recursive: true });
  const baseName = `${job.id}-attempt-${job.attempt}`;
  await Promise.all([
    writeFile(join(outputDirectory, `${baseName}.txt`), renderPlainTicket(job.payload, { columns }), { flag: "wx" }),
    writeFile(join(outputDirectory, `${baseName}.bin`), bytes, { flag: "wx" }),
  ]);
};

export const printJob = async (config: AgentConfig, job: PrintJob): Promise<void> => {
  const bytes = renderEscPos(job.payload, {
    columns: config.printerColumns, encoding: config.printerEncoding, codePage: config.printerCodePage,
  });
  if (config.mode === "simulator") {
    await printSimulator(config.simulatorOutputDirectory, job, bytes, config.printerColumns);
    return;
  }
  if (config.mode === "system") {
    await printSystem(config, job, bytes);
    return;
  }
  if (!config.printerHost) throw new Error("No se configuró PRINTER_HOST");
  await printTcp(config.printerHost, config.printerPort, bytes, config.printerTimeoutMs);
};
