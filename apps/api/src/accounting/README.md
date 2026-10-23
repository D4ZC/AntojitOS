# Contabilidad administrativa

El permiso `accounting.manage`, asignado al rol `ADMINISTRATOR`, permite registrar proveedores, cargos y pagos parciales. Un cargo puede no tener proveedor para gastos generales como renta o servicios. Los importes se guardan en centavos; las fechas contables usan `America/Mexico_City`.

El resumen del periodo presenta ventas menos devoluciones, pagos registrados y salidas manuales de efectivo. No incluye fondos iniciales, propinas ni entradas manuales como ventas. Los movimientos de caja asociados a pagos de proveedores y devoluciones se excluyen de las salidas manuales para evitar duplicarlos. El saldo pendiente muestra todos los cargos vigentes a la fecha de consulta.

## Correcciones e historial

Anular un pago corrige su registro histórico: deja de contarse en el periodo de su fecha `paidOn`, aunque la anulación ocurra después. No se registra como un egreso negativo del día de la anulación. Por ejemplo, un pago de $100 registrado ayer y anulado hoy deja de sumar esos $100 al resumen de ayer. El historial conserva el importe, la fecha de creación, la fecha de anulación y el motivo; también se genera un evento de auditoría.

Un pago con origen `business_cash` crea una salida de efectivo en la misma transacción. Requiere efectivo, fecha de hoy y un turno abierto en la misma terminal. Su anulación genera una entrada de reverso y sólo se permite mientras ese mismo turno siga abierto. Los cortes cerrados conservan su snapshot y no se modifican. Los pagos con origen `external` no alteran caja y permiten registrar pagos históricos.

Un cargo sólo puede anularse sin pagos activos. Si tiene abonos, primero deben anularse éstos. El cargo anulado conserva su importe y su historial, muestra saldo pendiente cero, queda fuera del saldo global y rechaza nuevos pagos. Todas las anulaciones exigen motivo, versión vigente e `Idempotency-Key`.
