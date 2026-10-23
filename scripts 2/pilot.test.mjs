import assert from "node:assert/strict";
import test from "node:test";
import {
  backupFileName,
  ensurePilotIsSeeded,
  generatePilotEnvironment,
  normalizeCommandArguments,
  parseEnvironmentFile,
  startPilotServices,
  validatePilotEnvironment,
} from "./pilot.mjs";

test("parsea variables de entorno sin incluir comentarios", () => {
  assert.deepEqual(
    parseEnvironmentFile(`
# comentario
NODE_ENV=production
export POSTGRES_DB='antojit_os'
PRINT_AGENT_NAME="Agente principal"
`),
    {
      NODE_ENV: "production",
      POSTGRES_DB: "antojit_os",
      PRINT_AGENT_NAME: "Agente principal",
    },
  );
});

test("reinstalar conserva los PIN y el catalogo cuando ya hay una sucursal", () => {
  const calls = [];
  const operations = { isSeeded: () => true, compose: (...args) => calls.push(args) };
  assert.equal(ensurePilotIsSeeded("podman", operations), false);
  assert.equal(ensurePilotIsSeeded("podman", operations), false);
  assert.deepEqual(calls, Array(2).fill(["podman", "up", "--detach", "--no-build", "--pull", "never", "print-agent"]));
});

test("una base nueva se inicializa antes de arrancar impresion", () => {
  const calls = [];
  assert.equal(ensurePilotIsSeeded("podman", {
    isSeeded: () => false,
    compose: (...args) => calls.push(args),
  }), true);
  assert.deepEqual(calls[0], ["podman", "exec", "-T", "api", "node", "dist/database/seed.js"]);
  assert.equal(calls[1].at(-1), "print-agent");
});

test("un fallo al consultar la base no se interpreta como una instalacion nueva", () => {
  let executed = false;
  assert.throws(() => ensurePilotIsSeeded("podman", {
    isSeeded: () => { throw new Error("conexion fallida"); },
    compose: () => { executed = true; },
  }), /conexion fallida/u);
  assert.equal(executed, false);
});

test("el arranque diario usa imagenes locales y espera la API antes de impresion", async () => {
  const calls = [];
  const environment = { PILOT_HTTP_PORT: "18080" };
  await startPilotServices("podman", environment, {
    compose: (...args) => calls.push(args),
    verify: async (value) => { assert.equal(value, environment); calls.push(["ready"]); },
    isSeeded: () => true,
  });
  assert.deepEqual(calls, [
    ["podman", "up", "--detach", "--no-build", "--pull", "never", "postgres", "api", "web"],
    ["ready"],
    ["podman", "up", "--detach", "--no-build", "--pull", "never", "print-agent"],
  ]);
});

test("el arranque diario no inicializa una base vacia ni inicia impresion", async () => {
  const calls = [];
  await assert.rejects(startPilotServices("podman", {}, {
    compose: (...args) => calls.push(args),
    verify: async () => {},
    isSeeded: () => false,
  }), /no esta inicializada/u);
  assert.equal(calls.length, 1);
});

test("genera secretos y códigos válidos para el piloto", () => {
  const generated = generatePilotEnvironment(`
NODE_ENV=production
POSTGRES_PASSWORD=__POSTGRES_PASSWORD__
BOOTSTRAP_TOKEN=__BOOTSTRAP_TOKEN__
SESSION_PEPPER=__SESSION_PEPPER__
SEED_ADMIN_PIN=__ADMIN_PIN__
SEED_WAITER_PIN=__WAITER_PIN__
PILOT_HTTP_PORT=8080
`);
  const environment = parseEnvironmentFile(generated.contents);

  assert.doesNotThrow(() => validatePilotEnvironment(environment));
  assert.notEqual(generated.adminPin, generated.waiterPin);
  assert.equal(generated.bootstrapToken.length, 48);
});

test("rechaza la plantilla sin inicializar", () => {
  assert.throws(
    () =>
      validatePilotEnvironment({
        NODE_ENV: "production",
        POSTGRES_PASSWORD: "__POSTGRES_PASSWORD__",
        BOOTSTRAP_TOKEN: "__BOOTSTRAP_TOKEN__",
        SESSION_PEPPER: "__SESSION_PEPPER__",
        SEED_ADMIN_PIN: "__ADMIN_PIN__",
        SEED_WAITER_PIN: "__WAITER_PIN__",
      }),
    /POSTGRES_PASSWORD/u,
  );
});

test("crea un nombre de respaldo portable", () => {
  assert.equal(
    backupFileName(new Date("2026-10-14T23:45:12.123Z")),
    "antojitos-2026-10-14T23-45-12Z.dump",
  );
});

test("ignora el separador de argumentos que entrega pnpm", () => {
  assert.deepEqual(normalizeCommandArguments(["--", "backups/test.dump"]), [
    "backups/test.dump",
  ]);
  assert.deepEqual(normalizeCommandArguments(["backups/test.dump"]), [
    "backups/test.dump",
  ]);
});
