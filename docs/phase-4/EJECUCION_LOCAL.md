# Ejecución local de la Fase 4A

## Actualizar la instalación

Con PostgreSQL de Podman activo:

```bash
pnpm install
podman compose up -d postgres
pnpm --filter @antojit-os/api db:migrate
pnpm --filter @antojit-os/api db:seed
pnpm dev
```

La migración conserva las cuentas existentes y agrega responsables, grupos de división, ajustes, precuentas y trazabilidad de transferencias.

## Usuarios piloto

| Usuario | PIN predeterminado | Uso |
|---|---:|---|
| `ADMIN` | `1234` | Descuentos, cortesías y todas las operaciones de cuenta. |
| `MESERO` | `2345` | Servicio, precuenta y gestión de cuentas sin permiso para descuentos. |

Los PIN pueden cambiarse con `SEED_ADMIN_PIN` y `SEED_WAITER_PIN` antes de ejecutar el seed.

## Recorrido manual

1. Ingresar como `ADMIN` y abrir Mesa 1.
2. Agregar al menos dos productos, uno con cantidad mayor que uno.
3. Tocar `Precuenta` y comprobar subtotal, IVA y total.
4. Abrir `Gestionar cuenta`, escribir un motivo y aplicar 10% de descuento.
5. Comprobar el nuevo total, volver a gestionar y anular el descuento usando otro motivo.
6. Cambiar el responsable a `Mesero de prueba`.
7. Cambiar la cuenta de Mesa 1 a una mesa libre.
8. Seleccionar un artículo, escribir `Pago separado` y tocar `Dividir selección`.
9. Volver al mapa y abrir la mesa: debe aparecer un selector con dos cuentas.
10. En una de ellas, seleccionar un artículo, elegir la otra cuenta como destino y transferirlo.
11. Escribir un motivo y usar `Unir toda la cuenta`.
12. Volver al mapa: la mesa debe mostrar una sola cuenta con todos los artículos e importes conciliados.
13. Abrir una mesa libre sin agregar productos y tocar el acceso rápido `Liberar mesa`.
14. Escribir `Apertura accidental`, confirmar y comprobar que la mesa vuelva a aparecer libre.
15. Repetir la prueba desde `Gestionar cuenta` para confirmar que ambos accesos siguen disponibles.

Una cuenta con artículos activos o descuentos vigentes no puede cancelarse. Primero deben cancelarse o transferirse los artículos y anularse los descuentos.

Para probar concurrencia, abrir la misma cuenta en las dos tablets, realizar una operación en una y luego intentar mutar la versión anterior en la otra. La segunda terminal debe refrescar la cuenta y mostrar un aviso de conflicto.
