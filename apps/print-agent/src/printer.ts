import { mkdir, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { join } from "node:path";
import type { AgentConfig } from "./config.js";
import { renderEscPos, renderPlainTicket } from "./escpos.js";
import type { PrintJob } from "./types.js";

const printTcp = (host: string, port: number, bytes: Uint8Array): Promise<void> =>
  new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(10_000);
    socket.once("error", reject);
    socket.once("timeout", () => socket.destroy(new Error("Tiempo de espera agotado")));
    socket.once("connect", () => {
      socket.end(bytes, () => resolve());
    });
  });

const printSimulator = async (
  outputDirectory: string,
  job: PrintJob,
  bytes: Uint8Array,
): Promise<void> => {
  await mkdir(outputDirectory, { recursive: true });
  const baseName = `${job.id}-attempt-${job.attempt}`;
  await Promise.all([
    writeFile(join(outputDirectory, `${baseName}.txt`), renderPlainTicket(job.payload), { flag: "wx" }),
    writeFile(join(outputDirectory, `${baseName}.bin`), bytes, { flag: "wx" }),
  ]);
};

export const printJob = async (config: AgentConfig, job: PrintJob): Promise<void> => {
  const bytes = renderEscPos(job.payload);
  if (config.mode === "simulator") {
    await printSimulator(config.simulatorOutputDirectory, job, bytes);
    return;
  }
  if (!config.printerHost) throw new Error("No se configuró PRINTER_HOST");
  await printTcp(config.printerHost, config.printerPort, bytes);
};
