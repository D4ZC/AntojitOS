# Fase 1: fundaciones técnicas

## Objetivo

Demostrar la columna vertebral local de AntojitOS antes de implementar catálogo y órdenes persistentes.

## Alcance

- API NestJS/Fastify con validación global y documentación OpenAPI.
- PostgreSQL autoritativo y migraciones versionadas.
- Datos piloto reproducibles.
- Registro de terminal mediante secreto de instalación.
- Autenticación de usuario por PIN ligado a terminal registrada.
- Sesiones opacas, roles y permisos atómicos.
- Actualización concurrente de terminal con versión esperada.
- Idempotencia durable para mutaciones reintentables.
- Auditoría y evento outbox dentro de la transacción de negocio.
- Publicación WebSocket autenticada por sucursal.
- Salud de proceso y disponibilidad de base de datos por separado.

## Criterios de aceptación

- `GET /api/health/live` responde aunque PostgreSQL esté temporalmente caído.
- `GET /api/health/ready` sólo responde correctamente cuando PostgreSQL está disponible.
- Una instalación con `x-bootstrap-token` válido puede registrar una terminal y recibe un secreto que no se almacena en claro.
- Un usuario válido inicia sesión únicamente desde una terminal registrada.
- Cinco PIN incorrectos bloquean temporalmente la credencial.
- Un usuario sin `terminal.manage` no puede modificar terminales.
- Repetir una actualización con la misma clave y contenido devuelve el primer resultado sin duplicar auditoría ni outbox.
- Reutilizar la clave con otro contenido produce conflicto.
- Una versión obsoleta no sobrescribe cambios concurrentes.
- El cambio confirmado crea un evento `terminal.updated` y llega únicamente a sesiones de la misma sucursal.
- La migración puede ejecutarse repetidamente sin reaplicar archivos ya registrados.
- `pnpm check`, `pnpm test` y `pnpm build` terminan correctamente.

## Fuera de alcance

- Catálogo y órdenes persistentes.
- Impresión y agente de hardware.
- Administración visual de usuarios/terminales.
- Rotación y recuperación operativa de secretos.
- Alta disponibilidad del servidor local.

