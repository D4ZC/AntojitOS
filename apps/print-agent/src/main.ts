import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ProductionAgentApi } from "./api-client.js";
import { readConfig } from "./config.js";
import { printJob } from "./printer.js";
import type { AgentCredentials } from "./types.js";

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const config = readConfig();

const credentials = async (): Promise<AgentCredentials> => {
  if (config.agentId && config.agentToken) {
    return { id: config.agentId, token: config.agentToken };
  }
  if (existsSync(config.credentialsPath)) {
    return JSON.parse(await readFile(config.credentialsPath, "utf8")) as AgentCredentials;
  }
  if (!config.bootstrapToken) {
    throw new Error(
      "Se requiere BOOTSTRAP_TOKEN para registrar el agente por primera vez",
    );
  }
  const registered = await ProductionAgentApi.register(
    config.apiUrl,
    config.bootstrapToken,
    {
      siteCode: config.siteCode,
      code: config.code,
      displayName: config.displayName,
      centerCodes: config.centerCodes,
      registerCodes: config.registerCodes,
    },
  );
  await mkdir(dirname(config.credentialsPath), { recursive: true });
  await writeFile(config.credentialsPath, JSON.stringify(registered, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  console.info(`Agente ${config.code} registrado`);
  return registered;
};

const api = new ProductionAgentApi(config.apiUrl, await credentials());
let stopping = false;
process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });

console.info(`Agente de impresión activo en modo ${config.mode}`);
while (!stopping) {
  try {
    const { job } = await api.claim();
    if (!job) {
      await wait(config.pollIntervalMs);
      continue;
    }
    try {
      await printJob(config, job);
      await api.complete(job);
      console.info(`Trabajo ${job.id} confirmado`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error de impresión";
      await api.fail(job, message);
      console.error(`Trabajo ${job.id} falló: ${message}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error del agente";
    console.error(`Agente sin conexión: ${message}`);
    await wait(Math.max(config.pollIntervalMs, 2_000));
  }
}

console.info("Agente detenido");
