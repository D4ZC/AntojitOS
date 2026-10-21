# AntojitOS

Punto de venta web local-first para restaurantes. La operación de la sucursal se ejecutará en su red local; Internet será opcional para facturación, respaldos remotos e integraciones externas.

## Estado

- Fase 0: prototipo táctil para dos terminales Windows.
- Fase 1: API local, PostgreSQL, sesiones, permisos, auditoría, idempotencia, outbox y eventos en tiempo real.
- Fase 2: catálogo, mapa de mesas, cuentas persistentes, captura táctil y rondas de producción.
- Fase 3: KDS, enrutamiento por centro y cola durable para impresión ESC/POS.
- Fase 4A: precuenta, totales/impuestos, descuentos y gestión transaccional de cuentas.
- Fase 4B.1: apertura de caja, cobro, propina, cambio, ticket y cierre de cuenta.
- Fase 4B.2: movimientos, corte preliminar/final, diferencias, devoluciones y ticket físico.
- Fase 5A: pila de piloto, operación en producción y recuperación verificada.

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

Para ejecutar la pila aislada del piloto con Podman o Docker:

```bash
pnpm pilot:init
pnpm pilot:up
pnpm pilot:seed
```

La PWA queda en `http://localhost:8080`; la guía de operación y recuperación está en [`docs/phase-5a/EJECUCION_PILOTO.md`](docs/phase-5a/EJECUCION_PILOTO.md).

En una PC nueva con Windows 11 x64, los tres scripts de [`scripts/windows`](scripts/windows)
instalan y configuran el sistema, registran el arranque automático y descargan actualizaciones
desde una URL de GitHub configurable. Los comandos, requisitos y recuperación están en
[`docs/phase-5a/WINDOWS.md`](docs/phase-5a/WINDOWS.md).

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
- `apps/print-agent`: agente local de impresión con simulador y adaptador TCP ESC/POS.
- `packages/domain`: reglas de dominio independientes de la interfaz.
- `docs/phase-0`: alcance, flujos, estados y permisos iniciales.
- `docs/phase-1`: fundaciones del servidor local y seguridad.
- `docs/phase-2`: catálogo, servicio, recorrido táctil y ejecución en tablets.
- `docs/phase-3`: KDS, impresión durable y pruebas del agente.
- `docs/phase-4`: precuenta, gestión de cuentas y preparación del cobro.
- `docs/phase-4b`: cobro transaccional, ticket y apertura de turno de caja.
- `docs/phase-4b2`: cierre de caja, devoluciones e impresión de tickets y cortes.
- `docs/phase-5a`: despliegue, respaldo, contingencia y validación del piloto.
- `docs/architecture`: decisiones de arquitectura.
- `docs/data`: modelo de datos inicial.
- `SOFT_RESTAURANT_FUNCIONALIDADES.md`: mapa funcional de referencia.
- `PLAN_IMPLEMENTACION_ANTOJITOS.md`: plan de implementación por fases.
