# ADR-0002: Monolito modular para la primera versión

- **Estado:** aceptado
- **Fecha:** 2026-10-06

## Contexto

Caja, pago, cuenta, inventario y outbox requieren transacciones consistentes. La instalación debe ser sencilla en un servidor local con recursos limitados.

## Decisión

La API se implementará como monolito modular NestJS/Fastify con PostgreSQL. Identidad, catálogo, servicio, producción, ventas, caja, inventario, fiscal e integraciones tendrán límites y contratos internos explícitos.

Los workers podrán ejecutarse como procesos separados usando la misma base y módulos. No se crearán microservicios hasta demostrar una necesidad de despliegue o escala independiente.

## Consecuencias

- Menos piezas para instalar, respaldar y diagnosticar.
- Transacciones locales sencillas para invariantes críticas.
- Los límites deben revisarse para evitar dependencias circulares.
- Una futura extracción se apoyará en eventos outbox ya definidos.

