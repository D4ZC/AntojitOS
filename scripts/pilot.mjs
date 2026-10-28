#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");
const composeFile = join(repositoryRoot, "compose.pilot.yaml");
const environmentFile = join(repositoryRoot, ".env.pilot");
const environmentExample = join(repositoryRoot, ".env.pilot.example");
const backupDirectory = join(repositoryRoot, "backups");
const projectName = process.env.PILOT_PROJECT_NAME ?? "antojitos-pilot";

export const parseEnvironmentFile = (contents) => {
  const values = {};
  for (const originalLine of contents.split(/\r?\n/u)) {
    const line = originalLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7) : line;
    const separator = normalized.indexOf("=");
    if (separator <= 0) continue;
    const name = normalized.slice(0, separator).trim();
    let value = normalized.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[name] = value;
  }
  return values;
};

export const validatePilotEnvironment = (environment) => {
  const requirements = [
    ["NODE_ENV", (value) => value === "production", "debe ser production"],
    ["POSTGRES_PASSWORD", (value) => value.length >= 16, "debe tener al menos 16 caracteres"],
    ["BOOTSTRAP_TOKEN", (value) => value.length >= 24, "debe tener al menos 24 caracteres"],
    ["SESSION_PEPPER", (value) => value.length >= 32, "debe tener al menos 32 caracteres"],
    ["SEED_ADMIN_PIN", (value) => /^\d{4,8}$/u.test(value), "debe contener entre 4 y 8 dígitos"],
    ["SEED_WAITER_PIN", (value) => /^\d{4,8}$/u.test(value), "debe contener entre 4 y 8 dígitos"],
  ];

  for (const [name, accepts, message] of requirements) {
    const value = environment[name] ?? "";
    if (value.includes("__") || !accepts(value)) {
      throw new Error(`${name} ${message}`);
    }
  }

  if (environment.SEED_CASHIER_PIN !== undefined && !/^\d{4,8}$/u.test(environment.SEED_CASHIER_PIN)) {
    throw new Error("SEED_CASHIER_PIN debe contener entre 4 y 8 dígitos");
  }

  const port = Number(environment.PILOT_HTTP_PORT ?? "8080");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PILOT_HTTP_PORT debe ser un puerto válido");
  }
};

export const generatePilotEnvironment = (template) => {
  const adminPin = String(randomInt(100_000, 1_000_000));
  let waiterPin = String(randomInt(100_000, 1_000_000));
  while (waiterPin === adminPin) {
    waiterPin = String(randomInt(100_000, 1_000_000));
  }
  let cashierPin = String(randomInt(100_000, 1_000_000));
  while (cashierPin === adminPin || cashierPin === waiterPin) {
    cashierPin = String(randomInt(100_000, 1_000_000));
  }

  const values = {
    __POSTGRES_PASSWORD__: randomBytes(24).toString("hex"),
    __BOOTSTRAP_TOKEN__: randomBytes(24).toString("hex"),
    __SESSION_PEPPER__: randomBytes(32).toString("hex"),
    __ADMIN_PIN__: adminPin,
    __WAITER_PIN__: waiterPin,
    __CASHIER_PIN__: cashierPin,
  };

  let contents = template;
  for (const [placeholder, value] of Object.entries(values)) {
    contents = contents.replaceAll(placeholder, value);
  }

  return { contents, adminPin, waiterPin, cashierPin, bootstrapToken: values.__BOOTSTRAP_TOKEN__ };
};

export const ensurePilotCashierPin = (path) => {
  const contents = readFileSync(path, "utf8");
  const environment = parseEnvironmentFile(contents);
  if (environment.SEED_CASHIER_PIN !== undefined) return environment;
  let pin = String(randomInt(100_000, 1_000_000));
  while ([environment.SEED_ADMIN_PIN, environment.SEED_WAITER_PIN].includes(pin)) {
    pin = String(randomInt(100_000, 1_000_000));
  }
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const separator = contents.length && !/[\r\n]$/u.test(contents) ? newline : "";
  // Append to preserve the existing bytes, file permissions and Windows ACL.
  appendFileSync(path, `${separator}SEED_CASHIER_PIN=${pin}${newline}`, { encoding: "utf8", mode: 0o600 });
  return { ...environment, SEED_CASHIER_PIN: pin };
};

export const backupFileName = (date = new Date()) =>
  `antojitos-${date.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/u, "Z")}.dump`;

export const normalizeCommandArguments = (arguments_) =>
  arguments_[0] === "--" ? arguments_.slice(1) : arguments_;

const help = () => {
  console.info(`Uso: pnpm pilot:<comando>

Comandos:
  init                         Genera .env.pilot con secretos fuertes
  configure-cashier            Agrega PIN de cajero sólo si falta en .env.pilot
  up                           Construye e inicia la pila del piloto
  start                        Inicia las imagenes existentes sin descargar ni construir
  seed                         Carga los datos iniciales del restaurante
  ensure-seeded                Inicializa solo una base sin sucursales; conserva los PIN existentes
  catalog                      Reemplaza únicamente el menú activo
  status                       Muestra el estado de los servicios
  verify                       Comprueba la PWA y la API
  logs                         Muestra los últimos logs
  backup                       Crea y valida un respaldo PostgreSQL
  verify-backup <archivo>      Restaura el respaldo en una base temporal
  restore <archivo> --confirm-restore
                               Reemplaza la base activa y conserva un respaldo previo
  down                         Detiene la pila sin borrar datos`);
};

const initialize = () => {
  if (existsSync(environmentFile)) {
    throw new Error(".env.pilot ya existe; no se modificó");
  }
  const generated = generatePilotEnvironment(
    readFileSync(environmentExample, "utf8"),
  );
  writeFileSync(environmentFile, generated.contents, {
    flag: "wx",
    mode: 0o600,
  });
  console.info(`Configuración creada en ${relative(repositoryRoot, environmentFile)}`);
  console.info(`Código ADMIN: ${generated.adminPin}`);
  console.info(`Código MESERO: ${generated.waiterPin}`);
  console.info(`Código CAJERO: ${generated.cashierPin}`);
  console.info(`Token para registrar terminales: ${generated.bootstrapToken}`);
  console.info("Guarda estos datos en un lugar seguro antes de iniciar el piloto.");
};

const readPilotEnvironment = () => {
  if (!existsSync(environmentFile)) {
    throw new Error("Falta .env.pilot. Ejecuta primero: pnpm pilot:init");
  }
  validatePilotEnvironment(parseEnvironmentFile(readFileSync(environmentFile, "utf8")));
  const environment = ensurePilotCashierPin(environmentFile);
  // The USB agent belongs to Windows, even when an older .env.pilot still
  // describes the simulator. Never revive that simulator during a daily start.
  const nativeEnvironmentFile = join(repositoryRoot, ".env.print-agent");
  if (existsSync(nativeEnvironmentFile)) {
    const native = parseEnvironmentFile(readFileSync(nativeEnvironmentFile, "utf8"));
    if (native.PRINT_AGENT_MODE === "system") environment.PRINT_AGENT_RUNTIME = "native";
  }
  return environment;
};

export const usesNativePrintAgent = (environment = {}) =>
  environment.PRINT_AGENT_RUNTIME === "native" || environment.PRINT_AGENT_MODE === "system";

export const synchronizePilotPrintService = (engine, environment, operations = {}) => {
  const runCompose = operations.compose ?? compose;
  if (usesNativePrintAgent(environment)) {
    // Stopping alone leaves restart: unless-stopped available to another up.
    // Remove only the container; keep its named credential volume intact.
    runCompose(engine, "rm", "--stop", "--force", "print-agent");
  } else {
    runCompose(engine, "up", "--detach", "--no-build", "--pull", "never", "print-agent");
  }
};

const executableExists = (executable) => {
  const result = spawnSync(executable, ["--version"], { stdio: "ignore" });
  return result.status === 0;
};

const detectContainerEngine = () => {
  const requested = process.env.CONTAINER_ENGINE;
  if (requested) {
    if (!executableExists(requested)) {
      throw new Error(`No se encontró el motor configurado: ${requested}`);
    }
    return requested;
  }
  if (executableExists("podman")) return "podman";
  if (executableExists("docker")) return "docker";
  throw new Error("Se requiere Podman o Docker con soporte para compose");
};

const composeArguments = (...arguments_) => [
  "compose",
  "--env-file",
  environmentFile,
  "-f",
  composeFile,
  "-p",
  projectName,
  ...arguments_,
];

const execute = (executable, arguments_, options = {}) => {
  const result = spawnSync(executable, arguments_, {
    cwd: repositoryRoot,
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${executable} terminó con código ${result.status ?? "desconocido"}`);
  }
  return result;
};

const compose = (engine, ...arguments_) =>
  execute(engine, composeArguments(...arguments_));

const composeWithStreams = (engine, arguments_, streams) =>
  execute(engine, composeArguments(...arguments_), { stdio: streams });

const waitForUrl = async (url, attempts = 30) => {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return response;
    } catch {
      // El servicio todavía está iniciando.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
  }
  throw new Error(`El servicio no respondió correctamente: ${url}`);
};

const verifyRuntime = async (environment) => {
  const port = environment.PILOT_HTTP_PORT ?? "8080";
  const applicationUrl = `http://127.0.0.1:${port}`;
  const healthResponse = await waitForUrl(`${applicationUrl}/api/health/ready`);
  const health = await healthResponse.json();
  if (health.status !== "ready" || health.database !== "connected") {
    throw new Error("La API respondió, pero PostgreSQL no está disponible");
  }
  const application = await waitForUrl(applicationUrl);
  const html = await application.text();
  if (!html.includes("AntojitOS")) {
    throw new Error("La página entregada no corresponde a AntojitOS");
  }
  console.info(`Pila lista: ${applicationUrl}`);
  console.info("API lista y PostgreSQL conectado");
};

const databaseIsSeeded = (engine) => {
  const result = spawnSync(
    engine,
    composeArguments(
      "exec",
      "-T",
      "postgres",
      "sh",
      "-c",
      'psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align --command="SELECT EXISTS (SELECT 1 FROM sites)"',
    ),
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || "No fue posible revisar la inicialización");
  }
  return result.stdout.trim() === "t";
};

const resolveBackup = (input) => {
  if (!input) throw new Error("Debes indicar el archivo de respaldo");
  const path = isAbsolute(input) ? input : resolve(repositoryRoot, input);
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`No existe el respaldo: ${path}`);
  }
  return path;
};

const validateArchive = (engine, path) => {
  const input = openSync(path, "r");
  try {
    composeWithStreams(
      engine,
      ["exec", "-T", "postgres", "pg_restore", "--list"],
      [input, "ignore", "inherit"],
    );
  } finally {
    closeSync(input);
  }
};

const createBackup = (engine, label) => {
  mkdirSync(backupDirectory, { recursive: true });
  const filename = label ? backupFileName().replace(".dump", `-${label}.dump`) : backupFileName();
  const finalPath = join(backupDirectory, filename);
  const temporaryPath = `${finalPath}.partial`;
  const output = openSync(temporaryPath, "wx", 0o600);

  try {
    composeWithStreams(
      engine,
      [
        "exec",
        "-T",
        "postgres",
        "sh",
        "-c",
        'pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --no-owner --no-privileges',
      ],
      ["ignore", output, "inherit"],
    );
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  } finally {
    closeSync(output);
  }

  renameSync(temporaryPath, finalPath);
  validateArchive(engine, finalPath);
  const contents = readFileSync(finalPath);
  const manifest = {
    createdAt: new Date().toISOString(),
    file: filename,
    bytes: contents.byteLength,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
  writeFileSync(`${finalPath}.json`, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  console.info(`Respaldo validado: ${relative(repositoryRoot, finalPath)}`);
  console.info(`SHA-256: ${manifest.sha256}`);
  return finalPath;
};

const verifyBackup = (engine, path) => {
  validateArchive(engine, path);
  const database = `antojit_verify_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  compose(
    engine,
    "exec",
    "-T",
    "postgres",
    "sh",
    "-c",
    'createdb --username="$POSTGRES_USER" "$1"',
    "createdb",
    database,
  );

  try {
    const input = openSync(path, "r");
    try {
      composeWithStreams(
        engine,
        [
          "exec",
          "-T",
          "postgres",
          "sh",
          "-c",
          'pg_restore --username="$POSTGRES_USER" --dbname="$1" --exit-on-error --no-owner --no-privileges',
          "pg_restore",
          database,
        ],
        [input, "inherit", "inherit"],
      );
    } finally {
      closeSync(input);
    }

    const query = spawnSync(
      engine,
      composeArguments(
        "exec",
        "-T",
        "postgres",
        "sh",
        "-c",
        'psql --username="$POSTGRES_USER" --dbname="$1" --tuples-only --no-align --command="SELECT (SELECT count(*) FROM schema_migrations) || chr(58) || (SELECT count(*) FROM sites)"',
        "psql",
        database,
      ),
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    if (query.error) throw query.error;
    if (query.status !== 0) throw new Error(query.stderr || "No fue posible verificar el respaldo");
    const [migrations, sites] = query.stdout.trim().split(":").map(Number);
    if (!migrations || !sites) {
      throw new Error("El respaldo no contiene el esquema y la sucursal esperados");
    }
    console.info(`Restauración temporal correcta: ${migrations} migraciones, ${sites} sucursal(es)`);
  } finally {
    compose(
      engine,
      "exec",
      "-T",
      "postgres",
      "sh",
      "-c",
      'dropdb --if-exists --force --username="$POSTGRES_USER" "$1"',
      "dropdb",
      database,
    );
  }
};

const restoreBackup = async (engine, environment, path, confirmed) => {
  if (!confirmed) {
    throw new Error("La restauración reemplaza la base activa. Repite con --confirm-restore");
  }
  if (usesNativePrintAgent(environment)) {
    throw new Error("pilot:restore no admite la impresión USB administrada: la restauración debe coordinar la parada y el reinicio del agente nativo de Windows");
  }
  validateArchive(engine, path);
  createBackup(engine, "before-restore");
  compose(engine, "stop", "api", "print-agent");

  compose(
    engine,
    "exec",
    "-T",
    "postgres",
    "sh",
    "-c",
    'dropdb --if-exists --force --username="$POSTGRES_USER" "$POSTGRES_DB" && createdb --username="$POSTGRES_USER" "$POSTGRES_DB"',
  );

  const input = openSync(path, "r");
  try {
    composeWithStreams(
      engine,
      [
        "exec",
        "-T",
        "postgres",
        "sh",
        "-c",
        'pg_restore --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --exit-on-error --no-owner --no-privileges',
      ],
      [input, "inherit", "inherit"],
    );
  } finally {
    closeSync(input);
  }

  compose(engine, "start", "api", "print-agent");
  await verifyRuntime(environment);
  console.info("Restauración completada y servicios reiniciados");
};

// Windows reuses these operations on installation and every boot. Keep the
// initialization guard here, next to the database query, rather than using an
// installation marker that can disappear independently of the database volume.
export const ensurePilotIsSeeded = (engine, operations = {}) => {
  const isSeeded = operations.isSeeded ?? databaseIsSeeded;
  const runCompose = operations.compose ?? compose;
  const environment = operations.environment ?? {};
  if (usesNativePrintAgent(environment)) {
    synchronizePilotPrintService(engine, environment, { compose: runCompose });
  }
  const initialized = !isSeeded(engine);
  if (initialized) {
    runCompose(engine, "exec", "-T", "api", "node", "dist/database/seed.js");
  }
  if (!usesNativePrintAgent(environment)) {
    synchronizePilotPrintService(engine, environment, { compose: runCompose });
  }
  return initialized;
};

export const startPilotServices = async (engine, environment, operations = {}) => {
  const runCompose = operations.compose ?? compose;
  const verify = operations.verify ?? verifyRuntime;
  const isSeeded = operations.isSeeded ?? databaseIsSeeded;
  if (usesNativePrintAgent(environment)) {
    synchronizePilotPrintService(engine, environment, { compose: runCompose });
  }
  runCompose(engine, "up", "--detach", "--no-build", "--pull", "never", "postgres", "api", "web");
  await verify(environment);
  if (!isSeeded(engine)) {
    throw new Error("La base no esta inicializada. Ejecuta el instalador antes del inicio diario");
  }
  if (!usesNativePrintAgent(environment)) {
    synchronizePilotPrintService(engine, environment, { compose: runCompose });
  }
};

const main = async () => {
  const [command = "help", ...rawArguments] = process.argv.slice(2);
  const arguments_ = normalizeCommandArguments(rawArguments);
  if (command === "help" || command === "--help" || command === "-h") {
    help();
    return;
  }
  if (command === "init") {
    initialize();
    return;
  }

  const environment = readPilotEnvironment();
  if (command === "configure-cashier") {
    console.info("PIN de cajero configurado en .env.pilot; se conservaron los demás secretos y los PIN existentes.");
    return;
  }
  const engine = detectContainerEngine();

  switch (command) {
    case "start":
      await startPilotServices(engine, environment);
      break;
    case "up":
      if (usesNativePrintAgent(environment)) synchronizePilotPrintService(engine, environment);
      for (const service of ["api", "web", "print-agent"]) {
        compose(engine, "build", service);
      }
      compose(engine, "up", "--detach", "--no-build", "postgres", "api", "web");
      await verifyRuntime(environment);
      if (databaseIsSeeded(engine)) {
        if (!usesNativePrintAgent(environment)) synchronizePilotPrintService(engine, environment);
      } else {
        console.info("Instalación nueva: ejecuta pnpm pilot:seed para activar el agente de impresión");
      }
      break;
    case "seed":
      if (usesNativePrintAgent(environment)) synchronizePilotPrintService(engine, environment);
      compose(engine, "exec", "-T", "api", "node", "dist/database/seed.js");
      if (!usesNativePrintAgent(environment)) synchronizePilotPrintService(engine, environment);
      console.info("Datos iniciales aplicados");
      break;
    case "ensure-seeded":
      console.info(
        ensurePilotIsSeeded(engine, { environment })
          ? "Datos iniciales aplicados en una base nueva"
          : "La base ya contiene una sucursal; se conservaron el catalogo y los PIN existentes",
      );
      break;
    case "catalog":
      compose(engine, "exec", "-T", "api", "node", "dist/database/seed-catalog.js");
      console.info("Menú activo reemplazado");
      break;
    case "status":
      compose(engine, "ps");
      break;
    case "verify":
      await verifyRuntime(environment);
      break;
    case "logs":
      compose(engine, "logs", "--tail", "150", ...arguments_);
      break;
    case "backup":
      createBackup(engine);
      break;
    case "verify-backup":
      verifyBackup(engine, resolveBackup(arguments_[0]));
      break;
    case "restore":
      await restoreBackup(
        engine,
        environment,
        resolveBackup(arguments_[0]),
        arguments_.includes("--confirm-restore"),
      );
      break;
    case "down":
      compose(engine, "down");
      console.info("Servicios detenidos; los datos se conservaron");
      break;
    default:
      help();
      throw new Error(`Comando desconocido: ${command}`);
  }
};

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
