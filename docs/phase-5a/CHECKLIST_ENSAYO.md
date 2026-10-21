# Checklist de ensayo del piloto

## Preparación

- [ ] La PC principal tiene IP reservada y hora correcta.
- [ ] PWA y API pasan `pnpm pilot:verify`.
- [ ] POS-01, POS-02 y KDS tienen códigos distintos.
- [ ] El administrador y los meseros pueden iniciar sesión.
- [ ] La impresora o simulador confirma un trabajo.
- [ ] Existe un respaldo copiado fuera de la PC principal.

## Turno completo

- [ ] Abrir caja con fondo inicial real.
- [ ] Abrir, capturar y enviar cuentas desde ambas tablets.
- [ ] Confirmar separación de cocina y barra.
- [ ] Probar una adición y una cancelación de artículo enviado.
- [ ] Cobrar en efectivo, tarjeta y pago combinado.
- [ ] Probar descuento autorizado, precuenta y reimpresión.
- [ ] Registrar entrada, retiro o gasto con motivo.
- [ ] Ejecutar corte preliminar y cerrar todas las cuentas.
- [ ] Declarar medios de pago y cerrar el turno.
- [ ] Confirmar ticket y corte impresos una sola vez.

## Contingencias controladas

- [ ] Desconectar una tablet y comprobar que la otra continúa.
- [ ] Detener el agente de impresión, generar un trabajo y confirmar el reintento al volver.
- [ ] Reiniciar la pila y confirmar turno, cuentas y trabajos pendientes.
- [ ] Crear un respaldo posterior al cierre.
- [ ] Ejecutar `pilot:verify-backup` sobre ese respaldo.

## Evidencia

- [ ] Registrar tiempos de respuesta y errores observados.
- [ ] Registrar diferencias de caja y su explicación.
- [ ] Anotar dudas de usabilidad por rol.
- [ ] Conservar folios de ticket, corte y respaldo verificado.
