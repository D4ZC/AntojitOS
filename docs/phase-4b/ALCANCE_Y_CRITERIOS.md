# Fase 4B.1: cobro, ticket y apertura de caja

## Objetivo

Cerrar una cuenta mediante un cobro transaccional y auditable, emitir un ticket inmutable y liberar la mesa sin permitir cobros duplicados.

## Alcance

- Caja piloto `Caja principal` compartida por las terminales autorizadas.
- Apertura idempotente de turno con fondo inicial separado de las ventas.
- Formas configurables de pago: efectivo, tarjeta y transferencia en API.
- Flujo táctil para efectivo, tarjeta y pago combinado efectivo/tarjeta.
- Propina separada del importe de venta.
- Cálculo exacto del cambio únicamente para efectivo.
- Referencia obligatoria para tarjeta y transferencia.
- Folio consecutivo por sucursal y fotografía inmutable del ticket.
- Pagos, asignaciones, propinas y movimientos de efectivo como libros históricos.
- Cierre de la cuenta y liberación automática de la mesa.
- Concurrencia optimista, idempotencia, auditoría y outbox.

## Reglas operativas

- Debe existir un turno de caja abierto antes de cobrar.
- El fondo inicial no es una venta.
- No se cobra una cuenta con artículos pendientes de enviar o cancelar.
- Las cantidades aplicadas por forma de pago deben sumar exactamente el total de la cuenta.
- La propina no reduce el saldo ni se mezcla con el ingreso de venta.
- Sólo efectivo admite importe recibido mayor y produce cambio.
- Una cuenta cerrada no acepta un segundo cobro.
- Si una cuenta dividida se cobra, otra cuenta abierta del grupo se convierte en principal.

## Criterios de aceptación

- Repetir la apertura de turno o el cobro con la misma clave devuelve el mismo resultado.
- Un intento concurrente de cobrar una cuenta ya cerrada se rechaza.
- Un pago combinado conserva por separado efectivo, tarjeta, propina y cambio.
- El movimiento de efectivo registra el importe neto retenido, no el efectivo entregado antes del cambio.
- El ticket conserva artículos, impuestos, descuentos, pagos, propina, cambio y folio.
- Cerrar la última cuenta de una mesa la muestra libre inmediatamente.
- La interfaz mantiene objetivos táctiles de al menos 44 px.
- `pnpm check`, `pnpm test` y `pnpm build` terminan correctamente.

## Fuera de este incremento

- Cierre y declaración del turno.
- Corte preliminar/final y diferencias de caja.
- Entradas, retiros y gastos manuales.
- Cancelación, devolución o reimpresión de tickets.
- Impresión física del ticket; este incremento lo conserva y presenta en pantalla.
- Moneda extranjera y conciliación automática con terminal bancaria.

Estos puntos continúan en la Fase 4B.2.
