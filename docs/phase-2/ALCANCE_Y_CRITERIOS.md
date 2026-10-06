# Fase 2: catálogo, mesas y toma de orden

## Objetivo

Conectar las terminales táctiles al servidor local para operar catálogo, mesas, cuentas y rondas de producción con datos persistentes y control de concurrencia.

## Alcance

- Áreas, mesas y centros de producción por sucursal.
- Categorías, productos, precios, impuestos y disponibilidad.
- Grupos de modificadores y opciones por producto.
- Servicios en mesa, venta rápida y para llevar.
- Cuenta persistente con instantáneas de producto, precio, impuesto y modificadores.
- Captura de productos, cantidades y notas antes de comandar.
- Rondas enviadas a producción con número de secuencia.
- Versión optimista de la cuenta para coordinar dos terminales.
- Idempotencia, auditoría y outbox para las mutaciones de servicio.
- Modo remoto del POS activable sin eliminar el prototipo local.
- Configuración inicial de terminal, acceso por PIN y almacenamiento local de su identidad.
- Interfaz táctil adaptable a las mini tablets Windows.
- PWA con caché de la interfaz, pero tráfico de cuentas y eventos siempre dirigido al servidor local.

## Criterios de aceptación

- El catálogo devuelve únicamente categorías, productos, precios y modificadores activos de la sucursal autenticada.
- El mapa muestra las mesas libres y las que ya tienen una cuenta abierta.
- Una terminal puede abrir una mesa libre o recuperar la cuenta de una mesa ocupada.
- Se puede iniciar una venta rápida o una orden para llevar sin seleccionar mesa.
- Agregar un producto crea una instantánea histórica y valida sus modificadores.
- Sólo los artículos pendientes permiten cambiar cantidad o nota.
- Enviar una ronda asigna todos los artículos pendientes y evita una ronda vacía.
- Repetir una mutación con la misma clave idempotente no duplica sus efectos.
- Una versión obsoleta se rechaza; el POS recarga la cuenta modificada por la otra terminal.
- Cada mutación confirmada produce auditoría y evento outbox dentro de la misma transacción.
- Los objetivos principales de toque miden al menos 44 px y no dependen de hover.
- `pnpm check`, `pnpm test` y `pnpm build` terminan correctamente.

## Fuera de alcance

- Cancelar o borrar artículos; requerirá permisos, motivos y auditoría específica.
- Cambiar o transferir mesa, dividir o unir cuentas.
- Cobro, turnos de caja, propinas y formas de pago.
- Impresión física, agente de hardware y pantalla de cocina.
- Edición administrativa del catálogo desde la interfaz.
- Sincronización fuera de la red local o alta disponibilidad.
