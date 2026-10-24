#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const registryUrl = "https://registry.npmjs.org/-/ping";

export const checkNpmRegistry = async ({
  url = registryUrl,
  timeoutMilliseconds = 15_000,
  fetchRegistry = fetch,
} = {}) => {
  try {
    const response = await fetchRegistry(url, {
      signal: AbortSignal.timeout(timeoutMilliseconds),
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}`);
    }
    // Keep the timeout active until the entire response has arrived, too.
    await response.arrayBuffer();
  } catch (error) {
    const code = error?.cause?.code ?? error?.code;
    const detail = error?.name === "TimeoutError" ? "ETIMEDOUT" :
      typeof code === "string" ? code : error?.message ?? "Error";
    throw new Error(
      `No se pudo acceder a registry.npmjs.org desde el contenedor (${detail}). ` +
      `La comprobacion espera como maximo ${timeoutMilliseconds / 1_000} segundos. ` +
      "Revisa Internet y la conexion, DNS, VPN o cortafuegos de Podman. " +
      "Conecta una red estable y vuelve a ejecutar ACTUALIZAR-APP.cmd desde el mismo ZIP.",
      { cause: error },
    );
  }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.info("Comprobando acceso a registry.npmjs.org desde el contenedor (maximo 15 segundos)...");
  checkNpmRegistry().then(
    () => console.info("Registro npm accesible. Preparando las dependencias..."),
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
