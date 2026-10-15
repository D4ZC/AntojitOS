# Fase 4B.2: cierre de caja, devoluciones e impresión

## Objetivo

Completar el ciclo de caja del piloto, desde los movimientos manuales y el corte preliminar hasta la declaración, diferencia y cierre inmutable del turno.

## Alcance

- Pantalla táctil `Caja y corte` disponible para administradores.
- Entradas de efectivo y retiros/gastos con importe, motivo, usuario y terminal.
- Corte preliminar con venta, descuentos, impuestos, propinas, devoluciones, formas de pago, efectivo teórico, tickets y cuentas abiertas.
- Declaración por forma de pago, comparación contra teórico y diferencia positiva o negativa.
- Cierre idempotente que impide nuevos movimientos sobre el turno.
- Bloqueo del cierre cuando existen cuentas abiertas.
- Consulta de tickets recientes.
- Cancelación o devolución total mediante movimiento compensatorio; la venta original nunca se elimina.
- Reimpresión auditada con motivo y leyenda de copia.
- Impresión durable de ticket, reimpresión y corte mediante el agente existente.
- Compatibilidad con agentes previamente registrados: la migración los asigna a la caja activa del sitio.

## Reglas operativas

- Toda entrada o salida requiere un motivo.
- Una devolución requiere un turno abierto y sólo puede ejecutarse una vez por ticket.
- El efectivo devuelto genera una salida en el turno que realiza la devolución.
- Tarjeta y transferencia se registran como reversos administrativos; la conciliación bancaria sigue siendo externa.
- Efectivo teórico = entradas de efectivo menos salidas de efectivo.
- Para efectivo, la declaración se compara contra el efectivo teórico; para medios electrónicos, contra el neto registrado.
- El cierre requiere declarar todas las formas de pago activas.
- Un turno cerrado es histórico e inmutable y su corte queda en una instantánea.

## Criterios de aceptación

- Repetir movimiento, devolución, reimpresión o cierre con la misma clave no duplica efectos.
- No es posible devolver dos veces el mismo ticket.
- Una devolución conserva venta y pagos originales, crea libros compensatorios y ajusta el corte.
- Un retiro disminuye el efectivo teórico y una entrada lo incrementa.
- El cierre conserva teórico, declarado y diferencia por forma de pago.
- Una cuenta abierta impide cerrar el turno.
- Los trabajos de ticket y corte usan concesión, confirmación y reintento del agente de impresión.
- `pnpm check`, `pnpm test` y `pnpm build` terminan correctamente.

## Fuera de este incremento

- Devoluciones parciales por artículo.
- Reapertura de turnos cerrados.
- Conciliación automática con terminal bancaria.
- Arqueo por denominaciones de billetes y monedas.
- Reportes históricos administrativos y exportaciones.
