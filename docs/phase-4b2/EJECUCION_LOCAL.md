# Ejecución local de la Fase 4B.2

## Actualizar la instalación

Detener los procesos de desarrollo y, con PostgreSQL de Podman activo, ejecutar:

```bash
pnpm --filter @antojit-os/api db:migrate
pnpm --filter @antojit-os/api db:seed
pnpm dev
```

No es necesario ejecutar `pnpm install` si ya se instalaron las dependencias de la fase anterior.

En otra terminal, iniciar el agente de impresión en simulador:

```bash
pnpm dev:print-agent
```

Los tickets y cortes simulados aparecerán como `.txt` y `.bin` bajo `apps/print-agent/var/print-simulator`. La migración asigna los agentes existentes a `Caja principal`; no es necesario eliminar sus credenciales.

Cerrar la sesión del POS e ingresar nuevamente como `ADMIN / 1234` para recibir los permisos nuevos.

## Recorrido manual

1. En el mapa de mesas, tocar `Caja y corte`.
2. Confirmar que aparecen venta neta, efectivo teórico, devoluciones, cuentas abiertas y formas de pago.
3. Registrar una entrada pequeña con motivo y comprobar que aumenta el efectivo teórico.
4. Registrar un `Retiro / gasto` con motivo y comprobar que disminuye el efectivo teórico.
5. En `Tickets recientes`, reimprimir un ticket y confirmar el archivo con encabezado `REIMPRESION DE TICKET`.
6. Crear y cobrar una cuenta de prueba; volver a `Caja y corte` y devolverla indicando el motivo.
7. Confirmar que el ticket queda `Devuelto`, la devolución aparece en el corte y el efectivo se revierte si el cobro fue en efectivo.
8. Abrir una mesa y dejarla activa; verificar que `Cerrar turno de caja` queda bloqueado.
9. Cancelar o cobrar esa cuenta y regresar al corte.
10. Capturar los importes declarados. Para probar diferencias, modificar el efectivo declarado por un importe pequeño.
11. Confirmar dos veces el cierre y revisar el faltante o sobrante mostrado.
12. Confirmar el archivo `CORTE DE CAJA` en el simulador.

Después del cierre, el siguiente cobro deberá pedir abrir un turno nuevo.
