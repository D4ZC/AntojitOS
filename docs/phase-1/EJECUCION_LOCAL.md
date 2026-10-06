# Ejecución local de la Fase 1

## Preparación

```bash
cp .env.example .env
docker compose up -d postgres
pnpm --filter @antojit-os/api db:migrate
pnpm --filter @antojit-os/api db:seed
pnpm dev
```

La API queda en `http://localhost:3000/api` y OpenAPI en `http://localhost:3000/api/docs`.

## Flujo de prueba

1. Registrar terminal:

```bash
curl -X POST http://localhost:3000/api/v1/terminals/register \
  -H 'content-type: application/json' \
  -H 'x-bootstrap-token: replace-this-before-using-a-real-network' \
  -d '{"siteCode":"PILOT","terminalCode":"POS-01","displayName":"Tablet uno","profile":"pos"}'
```

Conservar `id` y `deviceToken` de la respuesta.

2. Iniciar sesión:

```bash
curl -X POST http://localhost:3000/api/v1/session/pin \
  -H 'content-type: application/json' \
  -d '{"terminalId":"ID_DE_TERMINAL","employeeCode":"ADMIN","pin":"1234","deviceToken":"TOKEN_DE_DISPOSITIVO"}'
```

3. Modificar nombre con sesión e idempotencia:

```bash
curl -X PATCH http://localhost:3000/api/v1/terminals/ID_DE_TERMINAL \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer TOKEN_DE_SESION' \
  -H 'idempotency-key: rename-pos-01-v1' \
  -d '{"displayName":"Tablet principal","expectedVersion":0}'
```

Repetir exactamente la petición debe devolver `idempotencyReplayed: true` sin crear otra auditoría ni evento.

## Seguridad

Los secretos del ejemplo son exclusivamente locales. Antes de exponer el servidor en la red se deben reemplazar `BOOTSTRAP_TOKEN` y `SESSION_PEPPER`, proteger `.env` y habilitar HTTPS.

