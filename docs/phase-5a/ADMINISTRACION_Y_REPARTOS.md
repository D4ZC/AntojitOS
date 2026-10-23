# Administración y repartos

Estas funciones se utilizan en el POS conectado a la PC principal. Inicia sesión como administrador para abrir **Contabilidad** y **Repartos** desde la pantalla de servicios.

## Proveedores, cargos y pagos

En **Contabilidad → Proveedores**, registra el nombre del proveedor y, opcionalmente, contacto, teléfono, RFC y notas. Puedes editar sus datos o desactivarlo; su historial permanece disponible. Los proveedores inactivos no reciben cargos nuevos.

En **Cargos y pagos**, registra el concepto, importe y fecha del cargo; vencimiento y referencia son opcionales. Elige un proveedor o **Sin proveedor / gasto general** para renta, luz, gas u otros gastos del negocio. Registrar el cargo crea un saldo pendiente; todavía no registra un pago ni una salida de caja.

Abre los pagos del cargo para registrar un pago completo o un abono. Selecciona efectivo, tarjeta o transferencia, fecha y referencia, si aplica. El importe debe ser mayor a cero y no superar el saldo pendiente. Se registran pagos ya realizados, con fecha de hoy o anterior.

- **Efectivo de caja del negocio:** crea una salida de efectivo que se refleja en el corte. Requiere efectivo, fecha de hoy en México y un turno abierto desde la misma terminal. El pago y el movimiento de caja se guardan juntos.
- **Externo:** registra un pago realizado fuera de la caja, incluso si fue en efectivo. Permite capturar pagos históricos y no cambia el corte del turno.

Estos registros ayudan a llevar el control del negocio; no ejecutan transferencias ni cargos bancarios.

## Resumen y exportación

En **Resumen**, selecciona las fechas y pulsa **Consultar periodo**. Las fechas se interpretan en la zona de México. El resumen muestra ventas netas de devoluciones, pagos vigentes de cargos, otros egresos de caja y el saldo operativo. Los pagos con salida de caja se cuentan una sola vez. Los fondos iniciales, las propinas y las entradas manuales de efectivo no se suman a las ventas.

El **saldo operativo** es ventas netas menos egresos registrados. No representa la utilidad fiscal ni sustituye una contabilidad fiscal. El **saldo pendiente de cargos** muestra la deuda actual de todos los cargos vigentes, independientemente del periodo seleccionado.

**Exportar CSV** descarga el resumen consultado y el detalle de pagos del periodo, con referencias y motivos de anulación, para revisarlos en una hoja de cálculo.

## Corregir un registro

Para corregir un pago, abre su historial y utiliza **Anular pago** con un motivo. Se conserva el registro original y la anulación queda auditada. Si el pago salió de caja, se genera una entrada que revierte ese importe; esto sólo se permite mientras el turno original siga abierto y desde la misma terminal. Un turno cerrado conserva su corte y no puede alterarse con esta operación.

Las anulaciones corrigen el periodo original del pago: si registraste $100 ayer y los anulas hoy, esos $100 dejan de sumar a los pagos del resumen de ayer. No aparecen como un egreso negativo de hoy. El historial conserva las fechas, el importe y el motivo de la corrección.

Un cargo incorrecto puede anularse con un motivo mientras no tenga pagos activos. Si tiene abonos, primero deben anularse éstos. El cargo y su historial permanecen visibles, su saldo pendiente pasa a cero y ya no admite pagos nuevos.

## Asignar una comanda al repartidor

1. Abre una cuenta con productos y pulsa **Asignar repartidor**. También puedes hacerlo desde el ticket después de cobrar, con **Asignar repartidor al pedido pagado**.
2. En **Repartos**, registra al repartidor con su nombre y teléfono opcional. Selecciónalo para el pedido y captura la dirección; puedes agregar cliente, teléfono e indicaciones de entrega.
3. Confirma la asignación. Desde el botón global **Repartos** puedes consultar entregas activas y su historial, aunque ya hayas cerrado el ticket.
4. Revisa la comanda y la **Dirección del sistema para el teléfono**. Usa la dirección de red de la PC, por ejemplo `http://192.168.1.10:8080`; `localhost` sólo funciona en la propia PC.
5. Pulsa **Generar enlace para teléfono** y copia o comparte el enlace generado por el administrador. Su formato es `http://IP-DE-LA-PC:8080/reparto#token=…`.

El enlace permite consultar únicamente esa entrega, sin iniciar sesión en el POS, y vence en 72 horas. Renovarlo invalida el enlace anterior. Cancelar el reparto o cambiar la cuenta también invalida la consulta anterior hasta generar la versión correspondiente.

## Llevar la comanda en el teléfono

Antes de salir, conecta el teléfono al mismo Wi-Fi que la PC principal y abre el enlace. Verifica productos, cantidades, preparaciones, notas, dirección y total. Pulsa **Guardar comanda sin conexión**: se descarga un archivo `comanda-reparto-….html`. Ábrelo desde **Descargas** y comprueba que se vea correctamente antes de desconectarte.

El archivo contiene la comanda y se puede consultar sin conexión. La página servida por HTTP en la red local no dispone de un service worker; conservar solamente la pestaña o el enlace no garantiza poder volver a abrirla fuera del Wi-Fi. La descarga del archivo es el paso para asegurar la consulta durante el recorrido.

La copia descargada conserva la versión que guardaste y puede quedar desactualizada. El archivo ya descargado no puede revocarse ni actualizarse a distancia: renovar o cancelar el enlace afecta la consulta al servidor, no elimina archivos del teléfono. Si cambia el pedido, el repartidor debe guardar la nueva copia y usarla en lugar de la anterior.

## Cambios del pedido y estados del reparto

Si agregas productos, cambias notas, cancelas artículos o cobras después de asignar el reparto, la pantalla avisa que la cuenta cambió. Antes de salir, pulsa **Actualizar comanda**, genera un enlace nuevo y vuelve a abrir y guardar la comanda en el teléfono. Esto conserva la relación con la versión actual del pedido.

Si el cobro se registra después de marcar la entrega, abre **Mostrar → Todos** para actualizar la comanda del reparto entregado y generar un enlace nuevo. Su estado permanece como entregado.

En **Repartos**, utiliza **Marcar en camino**, **Marcar entregado** o **Cancelar reparto** para llevar el seguimiento. Marcar un reparto como entregado no cobra ni cierra la cuenta. Los pagos del cliente se registran en caja con el flujo habitual.

Un pedido vacío, fusionado, cancelado o con la venta totalmente reembolsada ya no permite compartir ni avanzar el reparto. Su enlace deja de consultar la comanda y puedes cancelar el reparto si sigue activo. Las copias que el repartidor haya descargado permanecen en su teléfono.

Si el cliente de la entrega coincide con el de la cuenta, **Actualizar comanda** recoge las correcciones del nombre. Si capturas un nombre distinto para la entrega, se conserva ese destinatario.

## Actualizar la instalación

La actualización incluye `0010_administrative_accounting.sql` y `0011_delivery_assignments.sql`. Al reiniciar la API actualizada del piloto, las migraciones se aplican automáticamente y conservan los pedidos existentes. En desarrollo se ejecutan con `pnpm --filter @antojit-os/api db:migrate`.

Después de actualizar, cierra sesión e inicia sesión otra vez para refrescar los permisos del administrador. Recarga también el POS para cargar la interfaz nueva. La PC principal debe estar encendida y accesible en la red para registrar cambios y abrir o actualizar enlaces.
