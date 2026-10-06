# Visión y alcance inicial

## Visión

AntojitOS será un punto de venta web local-first para restaurantes mexicanos. La sucursal debe poder abrir cuentas, enviar comandas, cobrar, cerrar caja e imprimir dentro de su red local aun cuando Internet no esté disponible.

## Instalación piloto conocida

- Dos mini tablets Windows touch como terminales POS.
- PWA instalada en Microsoft Edge y ejecutada en modo aplicación.
- Un servidor principal local, por confirmar si será dedicado o una PC Windows existente.
- Catálogos y transacciones compartidos en tiempo real por ambas terminales.

## Supuestos provisionales

Hasta validar el restaurante piloto se diseñará para una combinación de servicio en mesa, venta rápida y para llevar. Estos supuestos permiten avanzar con el prototipo, pero no autorizan una salida productiva:

- moneda MXN e importes con dos decimales;
- precios con IVA incluido;
- una sucursal y una caja en el primer piloto;
- productos dirigidos a cocina o barra;
- efectivo, tarjeta y pago combinado;
- el CFDI y el inventario completo quedan fuera del MVP del piloto.

## Usuario objetivo del primer incremento

Una persona que atiende una terminal touch debe completar con el dedo, sin teclado ni mouse:

1. identificarse y abrir o recuperar su turno;
2. elegir mesa o venta rápida;
3. localizar productos y agregar cantidades;
4. ver pendientes y enviados;
5. mandar una ronda a cocina sin duplicarla;
6. revisar el total y preparar el cobro.

## Alcance de la Fase 0

- Contratos de dominio iniciales y vocabulario común.
- Decisiones de arquitectura local-first, monolito modular y PWA táctil.
- Modelo inicial de órdenes con artículos pendientes/enviados.
- Prototipo táctil de captura de productos y envío simulado de comanda.
- Manifest y shell PWA para instalación en Windows.
- Pruebas unitarias de reglas que ya no deben depender de la pantalla.
- Documentación de estados, permisos y modelo de datos.

## Fuera de la Fase 0

- Persistencia, autenticación real y comunicación entre terminales.
- Impresión física y agente de hardware.
- Cobro y caja transaccionales.
- KDS productivo, inventario y CFDI.
- Operación distribuida cuando falla el servidor local.

## Indicadores de éxito del piloto futuro

- Ningún cobro o envío duplicado por doble toque o reintento.
- Una acción común del POS requiere pocos toques y no usa controles menores de 44 px.
- La segunda terminal ve los cambios confirmados en menos de un segundo dentro de la LAN.
- Una caída de Internet no interrumpe venta, cocina, caja ni impresión local.
- Todas las excepciones conservan operador, autorizador, terminal, fecha y motivo.
- Una restauración probada recupera transacciones, configuración y archivos asociados.

## Decisiones abiertas

- Tipo y flujo principal del restaurante piloto.
- Modelo, resolución y escala de Windows de las tablets.
- Equipo que actuará como servidor principal.
- Cajas, impresoras, KDS y periféricos del piloto.
- Momento de incorporación de inventario y CFDI.

