# Flujos operativos iniciales

## 1. Inicio de terminal y turno

1. La terminal instalada se identifica ante el servidor local.
2. El empleado inicia sesión con credencial individual.
3. AntojitOS valida rol, terminal y sucursal.
4. El cajero abre turno e indica fondo inicial, o el mesero entra en un turno de servicio vigente.
5. La interfaz muestra usuario, terminal, conectividad local y turno activo.

**Invariantes:** una terminal no registrada no opera; el fondo no es una venta; cada movimiento pertenece a un turno.

## 2. Apertura y captura de cuenta

1. El operador elige mesa, venta rápida o para llevar.
2. Registra comensales cuando corresponda.
3. Toca productos y completa modificadores obligatorios.
4. Los artículos nuevos permanecen en estado `pending`.
5. Puede cambiar cantidades o retirar únicamente artículos no enviados.

**Invariantes:** cada cambio incrementa la versión de la cuenta; precio e impuesto se copian a la transacción; un doble toque intencional aumenta cantidad, pero un reintento técnico no crea otra operación.

## 3. Envío de ronda a producción

1. El operador toca “Enviar a cocina”.
2. El cliente genera una clave idempotente y bloquea temporalmente el control.
3. El servidor valida la versión de cuenta.
4. En una transacción marca los artículos pendientes como enviados y crea eventos de comanda.
5. El worker enruta trabajos por centro de producción.
6. La terminal recibe confirmación y muestra “En cocina”.

**Invariantes:** la misma clave no produce dos rondas; una falla de impresión no revierte la cuenta; reimprimir es una acción separada y auditada.

## 4. Adición a una cuenta abierta

1. Los artículos anteriores permanecen enviados.
2. Los nuevos artículos forman una ronda pendiente distinta.
3. El operador envía únicamente la nueva ronda.
4. Cocina recibe una comanda marcada como adición.

## 5. Precuenta y cobro

1. No quedan artículos pendientes o el operador decide enviarlos.
2. Se genera la precuenta sin cerrar la venta ni descontar nuevamente inventario.
3. Caja selecciona una o más formas de pago y registra propina por separado.
4. El servidor bloquea la cuenta, valida saldo y confirma pago/cierre en una transacción.
5. Se emite el ticket y se crean los eventos de inventario, impresión y fiscalidad.

**Invariantes:** una cuenta sólo se cierra una vez; la suma aplicada no excede el saldo salvo efectivo que genera cambio; los pagos nunca se borran.

## 6. Cancelación de un artículo enviado

1. El operador solicita cancelación y captura motivo.
2. Si carece de permiso, un supervisor autoriza con su propia identidad.
3. Se registra un movimiento compensatorio, no se elimina el artículo.
4. Producción recibe aviso de cancelación.
5. Cuando corresponda se solicita registrar merma.

## 7. Pérdida de conectividad

| Falla | Comportamiento esperado |
|---|---|
| Internet | La operación local continúa; trabajos externos quedan pendientes. |
| Wi-Fi de una tablet | Se conserva sólo la interfaz; no se confirman nuevas transacciones hasta reconectar. |
| Una terminal | La cuenta puede continuarse desde la otra con permisos adecuados. |
| Impresora | El trabajo queda pendiente, muestra alerta y puede redirigirse o reintentarse. |
| Servidor principal | Se detiene la operación coordinada y se aplica el procedimiento de contingencia. |

