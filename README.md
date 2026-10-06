# AntojitOS

Punto de venta web local-first para restaurantes. La operación de la sucursal se ejecutará en su red local; Internet será opcional para facturación, respaldos remotos e integraciones externas.

## Estado

- Fase 0: prototipo táctil para dos terminales Windows.
- Fase 1: API local, PostgreSQL, sesiones, permisos, auditoría, idempotencia, outbox y eventos en tiempo real.

## Requisitos de desarrollo

- Node.js 24 o superior
- pnpm 10 o superior

## Inicio rápido

```bash
pnpm install
pnpm dev
```

El prototipo queda disponible en `http://localhost:5173`.

Para levantar también la API se necesita PostgreSQL. La preparación completa está documentada en [`docs/phase-1/EJECUCION_LOCAL.md`](docs/phase-1/EJECUCION_LOCAL.md). Sus endpoints quedan en `http://localhost:3000/api` y OpenAPI en `http://localhost:3000/api/docs`.

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

- `apps/pos`: prototipo PWA táctil del punto de venta.
- `apps/api`: API autoritativa local y migraciones PostgreSQL.
- `packages/domain`: reglas de dominio independientes de la interfaz.
- `docs/phase-0`: alcance, flujos, estados y permisos iniciales.
- `docs/architecture`: decisiones de arquitectura.
- `docs/data`: modelo de datos inicial.
- `SOFT_RESTAURANT_FUNCIONALIDADES.md`: mapa funcional de referencia.
- `PLAN_IMPLEMENTACION_ANTOJITOS.md`: plan de implementación por fases.
