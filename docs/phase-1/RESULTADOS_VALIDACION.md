# Resultados de validación de la Fase 1

**Fecha:** 2026-10-06  
**Estado:** validación automatizada aprobada

## Resultados

| Comando | Resultado |
|---|---|
| `pnpm check` | Correcto: dominio, API y POS sin errores de TypeScript. |
| `pnpm test` | Correcto: 15 pruebas aprobadas. |
| `pnpm build` | Correcto: dominio, API ESM y PWA compilados. |

## Cobertura integrada

- Migración PostgreSQL completa y repetible.
- Registro de terminal con secreto almacenado únicamente como hash.
- Inicio de sesión con PIN desde dispositivo registrado.
- Sesión opaca y resolución de permisos.
- Rechazo de otro dispositivo y bloqueo temporal tras cinco PIN incorrectos.
- Actualización con concurrencia optimista.
- Repetición idempotente sin duplicar auditoría ni evento.
- Conflicto cuando una clave idempotente se reutiliza con otro contenido.
- Auditoría y outbox dentro de la misma transacción.
- Worker que publica el evento y marca su entrega.
- Arranque del módulo Nest completo y endpoints `live`/`ready` usando PostgreSQL embebido.

## Validación pendiente en entorno instalado

Docker no está disponible en el entorno de desarrollo actual. Antes de desplegar en el restaurante se debe ejecutar el flujo documentado contra PostgreSQL 17 real, conectar dos clientes WebSocket y verificar apagado/recuperación del proceso. Las pruebas actuales usan PGlite, PostgreSQL compilado a WebAssembly, para ejercer SQL, transacciones, restricciones e índices sin sustituir esa prueba de instalación.
