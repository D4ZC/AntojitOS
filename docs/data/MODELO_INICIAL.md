# Modelo de datos inicial

Este documento describe agregados y restricciones; no sustituye las migraciones SQL de la siguiente fase.

## Contexto de sucursal

- `organization`: propietario lógico.
- `site`: sucursal, zona horaria y configuración fiscal.
- `terminal`: dispositivo registrado, perfil y último contacto.
- `register`: caja lógica asociable a una terminal.
- `production_center`: cocina, barra, postres u otro destino.

## Identidad

- `user`, `role`, `permission`, `role_permission`.
- `user_session`: sesión y terminal de origen.
- `supervisor_authorization`: operación, operador, autorizador y motivo.

## Catálogo

- `category`, `product`, `product_price`, `tax_rule`.
- `modifier_group`, `modifier`, `product_modifier_group`.
- Cambiar un catálogo nunca reescribe líneas históricas.

## Servicio y producción

- `dining_area`, `service_table`, `service_account`.
- `order_round`: conjunto confirmado en un envío.
- `order_item`: instantánea de producto, precio, impuesto y estado.
- `order_item_modifier`: elección e importe histórico.
- `kitchen_ticket`: proyección por centro de producción.

## Ventas y caja

- `payment`, `payment_allocation`, `tip`, `receipt`, `refund`.
- `cash_shift`, `cash_movement`, `cash_declaration`, `cash_close`.
- Pagos y caja forman libros de movimientos; no se actualizan saldos sin registrar el movimiento fuente.

## Infraestructura transaccional

- `outbox_event`: evento confirmado en la misma transacción de negocio.
- `idempotency_key`: alcance, clave, hash de solicitud y resultado estable.
- `print_job`: destino, carga congelada, intento, estado y relación de reimpresión.
- `audit_event`: actor, autorizador, terminal, entidad, acción, motivo y cambios.

## Restricciones iniciales

- UUID para identidades; folios humanos separados y únicos por alcance.
- Importe almacenado en centavos o `numeric`, nunca punto flotante.
- `service_account.version` usa concurrencia optimista.
- Una clave idempotente es única dentro de su operación/sucursal.
- Una cuenta no acepta dos cierres exitosos.
- Un artículo enviado no cambia cantidad; se agrega una corrección o cancelación relacionada.
- Fechas persistidas en UTC y representadas en la zona de la sucursal.
- Toda fila transaccional conserva `created_at` y el usuario/terminal de origen.

## Transacción de envío a cocina

En una sola transacción PostgreSQL:

1. validar clave idempotente y versión esperada;
2. bloquear la cuenta;
3. crear `order_round`;
4. mover artículos `pending` a `sent`;
5. insertar eventos outbox por centro de producción;
6. incrementar versión de cuenta;
7. guardar el resultado idempotente;
8. confirmar.

El worker convierte después los eventos en `print_job`; una impresora fuera de línea no altera la ronda ya confirmada.

