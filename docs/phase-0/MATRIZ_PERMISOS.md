# Matriz inicial de permisos

Los permisos se asignan a roles, pero la auditoría siempre registra usuarios individuales. Una autorización conserva operador y autorizador.

| Acción | Mesero | Cajero | Capitán | Gerente | Almacén | Admin |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Abrir mesa/cuenta | Sí | Sí | Sí | Sí | No | Sí |
| Agregar y enviar artículos | Sí | Sí | Sí | Sí | No | Sí |
| Transferir mesa/artículos | Solicita | Sí | Sí | Sí | No | Sí |
| Imprimir precuenta | Sí | Sí | Sí | Sí | No | Sí |
| Cobrar | No | Sí | Sí | Sí | No | Sí |
| Aplicar descuento permitido | Solicita | Según límite | Sí | Sí | No | Sí |
| Cancelar antes de comandar | Sí | Sí | Sí | Sí | No | Sí |
| Cancelar después de comandar | Solicita | Solicita | Sí | Sí | No | Sí |
| Reimprimir comanda/ticket | Solicita | Solicita | Sí | Sí | No | Sí |
| Abrir turno y registrar fondo | No | Sí | Sí | Sí | No | Sí |
| Ver efectivo teórico antes de declarar | No | No | No | Sí | No | Sí |
| Cerrar turno propio | No | Sí | Sí | Sí | No | Sí |
| Ajustar inventario | No | No | No | Autoriza | Sí | Sí |
| Cambiar precios/recetas | No | No | No | Sí | Según permiso | Sí |
| Administrar usuarios/permisos | No | No | No | No | No | Sí |

## Permisos atómicos iniciales

- `service.account.open`, `service.account.transfer`, `service.item.add`, `service.round.send`;
- `service.item.cancel.pending`, `service.item.cancel.sent`;
- `sales.discount.apply`, `sales.discount.override`, `sales.payment.capture`, `sales.refund.create`;
- `print.prebill`, `print.receipt.reprint`, `print.kitchen.reprint`;
- `cash.shift.open`, `cash.shift.close`, `cash.expected.view`;
- `inventory.movement.create`, `inventory.adjustment.authorize`;
- `catalog.price.manage`, `catalog.recipe.manage`;
- `security.user.manage`, `security.role.manage`.

Los límites monetarios y porcentuales serán atributos de política, no roles duplicados como “cajero 5%” y “cajero 10%”.

