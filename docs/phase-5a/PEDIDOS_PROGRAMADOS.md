# Pedidos programados y datos del cliente

El nombre del cliente es opcional, con un máximo de 80 caracteres. Se guarda en la cuenta; la lista de clientes frecuentes se incorporará después.

En el POS, **Cliente y programación** permite editar esos datos dentro de la cuenta. Para comenzar un pedido sin mesa con fecha futura, usa **Programar pedido** en la selección de servicio. Activa la programación, elige fecha y hora, guarda y agrega los productos. El pedido permanece visible en **Servicios abiertos**, con el cliente y su horario.

La fecha y hora programada indica cuándo enviar los artículos pendientes a cocina. La API recibe una fecha ISO 8601 con zona horaria. Sólo se puede establecer una fecha futura. El operador puede cambiarla o quitarla; mientras esté pendiente no puede dividir, unir ni transferir los artículos a otra cuenta sin quitar primero la programación.

El servidor revisa los pedidos cada cinco segundos y crea la misma ronda, comanda e impresión durable que el envío manual. La tablet puede cerrar el pedido o desconectarse. La PC que ejecuta la API debe permanecer encendida: si se apaga, al reiniciar se envían los pedidos vencidos que siguen abiertos y tienen artículos pendientes. Los bloqueos y la marca persistida de despacho evitan enviarlos dos veces con varios procesos. Una falla de producción revierte toda la operación, conserva el error visible en la cuenta y vuelve a intentar después de 30 segundos.

Mientras la fecha siga en el futuro no se puede enviar la comanda manualmente. Quitar la programación permite enviarla de inmediato. Tras el despacho se conserva la fecha solicitada y se registra la hora real de envío. Los artículos agregados después se envían manualmente, o se puede establecer una nueva programación.

Los pedidos con fecha futura y sin artículos enviados no impiden el corte de caja del día; permanecen abiertos para el siguiente turno. Las cuentas ordinarias, los pedidos vencidos sin despachar y los pedidos que ya tienen artículos enviados siguen impidiendo el cierre hasta resolverse.

También se pueden editar las observaciones de un artículo enviado o entregado, manteniendo su cantidad. Cocina recibe la nota actualizada y una impresión identificada como actualización, con la indicación de no volver a preparar el producto. No se crea una nueva comanda de producción. La cancelación de una venta rápida o para llevar permite descartar sus artículos pendientes en una sola operación auditada; los artículos enviados y los descuentos activos deben resolverse antes.

Al salir de una venta rápida vacía se descarta automáticamente. Si tiene productos, el POS permite conservarla y salir o cancelar el pedido pendiente. **Cancelar pedido** también está disponible al recuperar un servicio abierto.

La instalación actualizada incluye las migraciones `0008` (Mesa 9 y Flauta a $35) y `0009` (datos y programación). El contenedor del piloto las aplica al arrancar la API; en desarrollo se ejecutan con `pnpm --filter @antojit-os/api db:migrate`. Las migraciones conservan los precios capturados en pedidos anteriores.

El modo demostración persiste una orden en el navegador y simula el despacho mientras está abierto o al reabrirlo. Para que el envío funcione con la tablet cerrada se utiliza el modo conectado al servidor local.

## Contrato de API

- `POST /v1/accounts`: admite `customerName` y `scheduledFor` opcionales.
- `PATCH /v1/accounts/:id/details`: recibe `expectedVersion` y los campos que se desean cambiar. `null` borra el nombre o quita la programación. Un operador puede editar sus pedidos; la gestión de otras cuentas requiere permiso de administración.
- La cuenta, las cuentas de una mesa y el listado de mostrador devuelven `customerName`, `scheduledFor`, `scheduleDispatchedAt` y `scheduleError`.
- `PATCH /v1/accounts/:id/items/:itemId`: conserva la nota si se omite `note`; `null` o una cadena vacía la borra. En artículos enviados la cantidad debe permanecer igual.

Las operaciones de escritura conservan el control de versión y el encabezado `Idempotency-Key` del resto de la API.
