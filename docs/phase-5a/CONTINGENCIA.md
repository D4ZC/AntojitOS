# Manual de contingencia del piloto

## Regla principal

No improvisar cambios sobre PostgreSQL ni borrar volúmenes durante servicio. Registrar la hora, terminal, usuario y último folio visible. Si AntojitOS no puede vender con seguridad, continuar temporalmente en el sistema anterior y conservar la evidencia para conciliación.

## Una tablet no conecta

1. Comprobar que siga en la misma red que la PC principal.
2. Abrir nuevamente `http://IP-DE-LA-PC:8080`.
3. Probar desde otra tablet.
4. Si sólo falla una, reiniciar su navegador; no volver a registrar el mismo código en otro dispositivo.
5. Si fallan todas, revisar la PC principal.

## La aplicación no abre en ninguna terminal

1. Ejecutar `pnpm pilot:status` en la PC principal.
2. Ejecutar `pnpm pilot:verify`.
3. Consultar `pnpm pilot:logs` y guardar el texto del error.
4. Reiniciar con `pnpm pilot:down` y `pnpm pilot:up`.
5. Confirmar las cuentas, turno y trabajos pendientes antes de continuar.

## La impresora no responde

1. La venta y la comanda permanecen registradas aunque falle la impresión.
2. Revisar energía, papel, red y dirección IP de la impresora.
3. Consultar `pnpm pilot:logs -- print-agent`.
4. Corregir la conexión y esperar el reintento durable.
5. Usar reimpresión autorizada con motivo; no volver a cobrar ni crear otra cuenta.

## Se pierde la red local

- No cambiar a datos móviles: AntojitOS opera dentro de la red del restaurante.
- Mantener encendidos router y PC principal.
- Las acciones que no llegaron a confirmarse visualmente deben revisarse antes de repetirse.
- Cuando vuelva la red, recargar la vista y comprobar mesa, cuenta y última ronda.

## Se apaga la PC principal

1. Las tablets dejan de operar; no son servidores independientes.
2. Restaurar energía y esperar el inicio de Podman o Docker.
3. Ejecutar `pnpm pilot:up` y luego `pnpm pilot:verify`.
4. Verificar turno, cuentas abiertas e impresiones pendientes.
5. Si PostgreSQL no inicia, no eliminar su volumen; usar el último respaldo verificado en otra instalación.

## Diferencia o duplicidad aparente

- No editar tablas ni borrar ventas.
- No repetir un cobro que ya generó ticket sin revisar `Tickets recientes`.
- Registrar folio, importe, forma de pago, hora y usuario.
- Usar cancelación/devolución compensatoria cuando corresponda.
- Conciliar el corte contra vouchers y efectivo antes de cerrar el incidente.

## Recuperación mediante respaldo

1. Preservar la carpeta `backups/` y el volumen actual.
2. Elegir el último respaldo cuyo manifiesto tenga SHA-256 y cuya verificación haya sido correcta.
3. Preferir primero `pilot:verify-backup`.
4. Ejecutar `pilot:restore` únicamente con autorización del responsable.
5. Documentar el periodo de datos que deba recapturarse o conciliarse.

## Evidencia mínima de un incidente

- Fecha y hora.
- Terminal y empleado.
- Mesa, folio o corte relacionado.
- Mensaje exacto o fotografía.
- Resultado de `pilot:status`, `pilot:verify` y logs relevantes.
- Acción tomada y persona que la autorizó.
