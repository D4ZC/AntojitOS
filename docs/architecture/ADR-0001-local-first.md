# ADR-0001: Servidor autoritativo local por sucursal

- **Estado:** aceptado para el piloto
- **Fecha:** 2026-10-06

## Contexto

Venta, cocina y caja no pueden depender de Internet. Dos o más terminales necesitan compartir cuentas y pagos sin crear conflictos.

## Decisión

Cada sucursal tendrá un servidor local autoritativo con PostgreSQL. Las terminales sólo usan API HTTPS y eventos WebSocket. Internet se reserva para servicios externos y sincronización mediante outbox.

No se aceptarán ventas independientes en las terminales cuando el servidor local no esté disponible durante el MVP.

## Consecuencias

- La sucursal continúa operando cuando falla Internet.
- Se necesita UPS, respaldo, monitoreo y recuperación del servidor.
- La PWA puede cargar su shell sin red, pero no confirma transacciones sin la autoridad local.
- La nube recibirá eventos y proyecciones; no estará en la ruta crítica de cobro.

