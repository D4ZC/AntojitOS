# AntojitOS

Punto de venta web local-first para restaurantes. La operación de la sucursal se ejecutará en su red local; Internet será opcional para facturación, respaldos remotos e integraciones externas.

## Estado

- Fase 0: prototipo táctil para dos terminales Windows.
- Fase 1: API local, PostgreSQL, sesiones, permisos, auditoría, idempotencia, outbox y eventos en tiempo real.
- Fase 2: catálogo, mapa de mesas, cuentas persistentes, captura táctil y rondas de producción.

## Requisitos de desarrollo

- Node.js 24 o superior
- pnpm 10 o superior

## Inicio rápido

```bash
pnpm install
pnpm dev
```

El prototipo queda disponible en `http://localhost:5173`.

Para operar el POS conectado a la PC principal se necesita PostgreSQL y `VITE_REMOTE_MODE=true`. La preparación completa de PC y tablets está documentada en [`docs/phase-2/EJECUCION_LOCAL.md`](docs/phase-2/EJECUCION_LOCAL.md). La API queda en `http://localhost:3000/api` y OpenAPI en `http://localhost:3000/api/docs`.

## Validación

```bash
pnpm check
pnpm test
pnpm build
```

Si todavía no se han descargado dependencias, las reglas puras de dominio pueden validarse con:

```bash
pnpm test:offline
```

## Estructura

- `apps/pos`: PWA táctil con modo demostración y modo conectado al servidor local.
- `apps/api`: API autoritativa local y migraciones PostgreSQL.
- `packages/domain`: reglas de dominio independientes de la interfaz.
- `docs/phase-0`: alcance, flujos, estados y permisos iniciales.
- `docs/phase-1`: fundaciones del servidor local y seguridad.
- `docs/phase-2`: catálogo, servicio, recorrido táctil y ejecución en tablets.
- `docs/architecture`: decisiones de arquitectura.
- `docs/data`: modelo de datos inicial.
- `SOFT_RESTAURANT_FUNCIONALIDADES.md`: mapa funcional de referencia.
- `PLAN_IMPLEMENTACION_ANTOJITOS.md`: plan de implementación por fases.
