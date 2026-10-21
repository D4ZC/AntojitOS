# Fase 5A: entorno de piloto y recuperación

## Objetivo

Ejecutar AntojitOS en la PC principal con una pila reproducible y aislada, sin depender de procesos de desarrollo, y demostrar que sus datos pueden respaldarse y restaurarse antes de operar turnos completos.

## Alcance

- Imágenes separadas para API, PWA y agente de impresión.
- PostgreSQL 17 persistente y no expuesto a la red del restaurante.
- Un único acceso web para tablets, API y eventos en tiempo real.
- Compatibilidad con Podman Compose y Docker Compose.
- Generación local de secretos, códigos iniciales y token de instalación.
- Migraciones automáticas al iniciar la API y carga inicial explícita.
- Reinicio automático de servicios después de una falla o reinicio de la PC.
- Respaldo PostgreSQL en formato portable con manifiesto y SHA-256.
- Restauración de prueba en una base temporal sin afectar la operación.
- Restauración real protegida por confirmación y respaldo preventivo.
- Manual de contingencia y lista de verificación para el ensayo.

## Criterios de aceptación

- La pila inicia desde un checkout limpio usando `.env.pilot` y conserva los datos al detenerse.
- La PWA responde por el puerto configurado y la API reporta PostgreSQL conectado.
- Las tablets acceden mediante la IP de la PC principal sin exponer directamente PostgreSQL.
- El agente conserva sus credenciales y trabajos simulados entre reinicios.
- Un respaldo puede listarse y restaurarse en una base temporal con las seis migraciones y la sucursal.
- Una restauración real no puede iniciarse sin `--confirm-restore`.
- Antes de reemplazar la base activa se crea un respaldo preventivo.
- `pnpm check`, `pnpm test`, `pnpm build` y la construcción de contenedores terminan correctamente.

## Fuera de este incremento

- Instalador nativo y actualizaciones automáticas.
- Respaldo remoto o almacenamiento en la nube.
- Alta disponibilidad con una segunda PC principal.
- Certificación de una impresora física específica.
- Inventario y CFDI.
