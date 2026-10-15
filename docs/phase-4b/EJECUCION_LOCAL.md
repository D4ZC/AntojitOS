# Ejecución local de la Fase 4B.1

## Actualizar la instalación

Con PostgreSQL de Podman activo:

```bash
pnpm install
podman compose up -d postgres
pnpm --filter @antojit-os/api db:migrate
pnpm --filter @antojit-os/api db:seed
pnpm dev
```

Después de migrar, cerrar la sesión del POS e ingresar nuevamente como `ADMIN / 1234` para recibir los permisos de caja y cobro.

## Recorrido manual

1. Abrir una mesa, agregar productos y enviar la comanda.
2. Tocar `Pago`; en el primer cobro aparecerá `Abrir turno de caja`.
3. Capturar un fondo inicial, por ejemplo `$500.00`, y abrir el turno.
4. Elegir `Efectivo`, seleccionar 10% de propina y capturar un importe recibido mayor al total.
5. Confirmar que se muestre el cambio antes de cobrar.
6. Confirmar el pago y revisar folio, artículos, impuestos, propina, efectivo y cambio en el ticket.
7. Cerrar el ticket y comprobar que la mesa queda libre.
8. Repetir con `Tarjeta`; la autorización o referencia debe ser obligatoria.
9. Repetir con `Combinado`; capturar una parte en efectivo y verificar que el resto más la propina se cargue a tarjeta.

Para validar concurrencia, mantener la misma cuenta abierta en dos tablets e intentar cobrarla en ambas. Sólo el primer cobro debe confirmar un ticket; la segunda operación debe rechazarse sin crear otro folio ni pago.
