# Resultados de validación de la Fase 2

**Fecha:** 2026-10-06  
**Estado:** validación automatizada aprobada

## Resultados

| Comando | Resultado |
|---|---|
| `pnpm check` | Correcto: dominio, API y POS sin errores de TypeScript. |
| `pnpm test` | Correcto: 24 pruebas aprobadas (3 dominio, 12 API y 9 POS). |
| `pnpm build` | Correcto: dominio, API ESM y PWA compilados para producción. |

## Cobertura automatizada

- Aplicación repetible de las dos migraciones.
- Catálogo, mapa de mesas y aislamiento por sucursal.
- Apertura de servicio en mesa, venta rápida y para llevar.
- Instantáneas de precio e impuesto al agregar artículos.
- Validación de modificadores y edición exclusiva de pendientes.
- Concurrencia optimista desde dos terminales sobre una misma cuenta.
- Envío exactamente una vez de una ronda y creación de outbox.
- Encabezados de autorización e idempotencia del cliente web.
- Configuración de terminal, acceso, selección táctil de mesa, captura y envío desde el POS.

## Validación pendiente en entorno instalado

Docker no está disponible en el entorno automatizado actual. Antes del despliegue se debe repetir la migración y el recorrido manual contra PostgreSQL 17 real, desde las dos mini tablets Windows y a través de la red local del restaurante.
