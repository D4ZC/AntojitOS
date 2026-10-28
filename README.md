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

El uso de cliente opcional y envío automático a cocina se describe en [`docs/phase-5a/PEDIDOS_PROGRAMADOS.md`](docs/phase-5a/PEDIDOS_PROGRAMADOS.md).

Las correcciones del menú, la impresión de precuentas, el usuario cajero con cierre sin importes registrados y los clientes frecuentes se describen en [`docs/phase-5a/CORRECCIONES_MENU_CAJA_CLIENTES.md`](docs/phase-5a/CORRECCIONES_MENU_CAJA_CLIENTES.md).

La administración de proveedores, cargos y pagos, y las comandas de reparto en el teléfono se describen en [`docs/phase-5a/ADMINISTRACION_Y_REPARTOS.md`](docs/phase-5a/ADMINISTRACION_Y_REPARTOS.md).

Las comandas se encolan para impresión automática al enviarlas y muestran **Imprimir comanda** para solicitar una impresión manual. La configuración de la impresora de caja y los tickets de 80 mm en la Bixolon SRP-F310 por USB o Ethernet está en [`docs/phase-3/BIXOLON_SRP_F310.md`](docs/phase-3/BIXOLON_SRP_F310.md); el modo simulador confirma trabajos sin imprimir en papel.

La PWA queda en `http://localhost:8080`; la guía de operación y recuperación está en [`docs/phase-5a/EJECUCION_PILOTO.md`](docs/phase-5a/EJECUCION_PILOTO.md).

En una PC nueva con **Windows 10 22H2 x64 (compilación 19045 o posterior)** o **Windows 11 x64**, conservar la carpeta completa del proyecto y abrir
[`final_script.cmd`](final_script.cmd) con doble clic. Su menú instala y configura el sistema,
registra el arranque automático, inicia la aplicación y permite aplicar actualizaciones desde
un ZIP del proyecto. Para actualizar, descargar la rama `main`, extraerla en una carpeta nueva
y abrir `ACTUALIZAR-APP.cmd`, o su `final_script.cmd` y elegir **4**. Se conserva la instalación,
la configuración y la base de datos. La ventana permanece abierta para revisar el resultado y muestra la
carpeta de registros de esa ejecución.

En Windows 10, comprobar la versión con `Win + R`, `winver` y actualizar a 22H2 si hace falta;
no se exige pasar a Windows 11. El instalador prepara WSL2 y selecciona Podman 5.8.9 compatible
con Windows 10; Podman 6 requiere Windows 11.

La misma entrada se puede usar desde PowerShell con [`final_script.ps1`](final_script.ps1).
Los requisitos, parámetros, registros y recuperación están en
[`docs/phase-5a/WINDOWS.md`](docs/phase-5a/WINDOWS.md). La instalación y el reinicio completos
todavía requieren validación en computadoras reales con Windows 10 y Windows 11.

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
- `apps/print-agent`: impresión ESC/POS con simulador, conexión TCP y colas USB del sistema.
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
