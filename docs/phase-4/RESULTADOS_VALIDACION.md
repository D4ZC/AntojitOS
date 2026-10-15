# Resultados de validación de la Fase 4A

**Fecha:** 2026-10-14  
**Estado:** validación automatizada y recorrido táctil principal aprobados

## Validación automatizada prevista

| Comando | Estado |
|---|---|
| `pnpm check` | Correcto: dominio, API, POS/KDS y agente sin errores de TypeScript. |
| `pnpm test` | Correcto: 46 pruebas aprobadas. |
| `pnpm build` | Correcto: dominio, API, PWA y agente compilados. |

## Cobertura agregada

- Impuestos incluidos y excluidos después de descuentos.
- Prorrateo determinista de centavos entre líneas.
- Aplicación, anulación e idempotencia de precuentas.
- Cambio de mesa y responsable.
- División parcial, transferencia y unión conservando cantidades.
- Selector táctil de varias cuentas por mesa.
- Motivo obligatorio en operaciones sensibles.
- Cancelación idempotente y auditada de cuentas sin artículos activos, liberando la mesa.
- Acceso rápido y acceso administrativo para cancelar una cuenta desde la interfaz táctil.

## Recorrido táctil ejecutado

- Generación de precuenta con subtotal, IVA y total correctos.
- Aplicación y anulación de un descuento porcentual con motivo.
- Cambio de responsable a `Mesero de prueba`.
- Cambio de la cuenta a una mesa libre.
- División de artículos y selector de dos cuentas en la misma mesa.
- Transferencia de artículos entre cuentas conservando cantidades y totales.
- Unión de cuentas y recuperación de una sola cuenta con el total correcto.
- Cancelación de una cuenta vacía desde el acceso rápido, con motivo, confirmación y liberación inmediata de la mesa.

El conflicto de versión entre dos terminales queda como prueba manual opcional; la concurrencia optimista está cubierta por las pruebas automatizadas de integración.
