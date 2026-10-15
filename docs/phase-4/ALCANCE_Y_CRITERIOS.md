# Fase 4A: precuenta y gestión de cuentas

## Objetivo

Preparar una cuenta para el cobro con importes reproducibles y permitir las operaciones habituales de comedor sin perder artículos, historia ni control de concurrencia.

## Alcance

- Motor de totales en centavos enteros.
- Desglose de subtotal, impuesto y total para precios con impuesto incluido o excluido.
- Descuentos porcentuales o fijos y cortesías en el dominio/API.
- Aplicación y anulación de ajustes con permiso, motivo y auditoría.
- Precuentas inmutables con secuencia y fotografía completa de la cuenta.
- Cambio de mesa de todo el grupo de cuentas divididas.
- Cambio de responsable por cuenta.
- División de cantidades completas o parciales.
- Transferencia de artículos entre dos cuentas abiertas.
- Unión de una cuenta en otra y cierre de la cuenta origen.
- Cancelación auditada de cuentas sin artículos activos para liberar la mesa.
- Acceso táctil rápido para liberar una mesa desde el panel de la cuenta.
- Varias cuentas abiertas asociadas a una misma mesa y selector táctil.
- Versión y bloqueo de ambas cuentas en toda operación entre cuentas.
- Datos piloto para `ADMIN` y `MESERO`.

## Reglas operativas

- Una precuenta es informativa: no registra pago ni cierra la cuenta.
- Un ajuste se conserva al anularlo; nunca se elimina de la historia.
- No se mueven artículos mientras alguna cuenta involucrada tenga descuentos o cortesías activos. Primero se anulan y, después del movimiento, se aplican de nuevo sobre la cuenta correcta.
- Los artículos comandados pueden cambiar de cuenta sin crear una nueva intención de producción.
- Los artículos cancelados permanecen en su cuenta histórica y no se transfieren.
- Una cuenta sólo puede cancelarse cuando no tiene artículos activos ni ajustes vigentes.
- Una versión obsoleta produce conflicto y obliga a refrescar la vista.
- Todas las mutaciones aceptan una clave idempotente.

## Criterios de aceptación

- El total de las líneas siempre coincide con el total de la cuenta al centavo.
- El IVA incluido se desglosa después del descuento; el IVA excluido se calcula sobre la base ya descontada.
- Repetir la misma solicitud de precuenta devuelve el mismo resultado sin otra secuencia.
- Anular un descuento restaura el total original y conserva el motivo.
- Una mesa puede mostrar y reabrir dos cuentas después de una división.
- Dividir parcialmente conserva la suma de cantidades e importes entre origen y destino.
- Transferir o unir actualiza la versión de ambas cuentas en la misma transacción.
- Dos terminales con versiones distintas no pueden sobrescribir una transferencia.
- Cambiar una mesa mueve juntas sus cuentas divididas y no permite ocupar una mesa usada por otro grupo.
- Cancelar una cuenta exige motivo, conserva su historial y libera la mesa de inmediato.
- Las acciones quedan registradas en auditoría y outbox.
- La interfaz mantiene objetivos táctiles de al menos 44 px.
- `pnpm check`, `pnpm test` y `pnpm build` terminan correctamente.

## Fuera de este incremento

- Registro de pagos y pagos combinados.
- Propina, cambio y devolución.
- Ticket final y folio de venta.
- Apertura/cierre de turno, movimientos y corte de caja.
- Reportes de venta y excepciones.
- Impresión física de la precuenta; por ahora se conserva y presenta en pantalla.

Esos puntos forman la Fase 4B.
