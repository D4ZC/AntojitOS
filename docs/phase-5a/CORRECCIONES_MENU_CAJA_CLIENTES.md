# Menú, cobro y clientes frecuentes

## Menú

- **Chamorros:** 1/2 chamorro $100; 1 Chamorro completo $170.
- **Bebidas:** agua fresca 1/2 litro $25, con selección de sabor.
- **Extras:** pieza tostada $3; Pata $20; Frijoles Adobados $30; Arroz porción $30; Tortillas $5.
- **Enchiladas:** la orden de cuatro admite **Combinadas (2 carne, 2 queso)**. La pieza conserva sus preparaciones individuales.
- Las notas de cocina incluyen **Sin verdura**, **Sin rábano** y **Con rábano**. Al seleccionar indicaciones opuestas se sustituye la anterior.

Los precios se administran desde **Precios del menú**. La actualización incorpora los productos nuevos y conserva precios personalizados, pedidos y tickets históricos.

## Precuenta y cobro

1. En el pedido, abre **Precuenta**.
2. **Imprimir precuenta** envía el documento a la impresora de caja configurada. También puedes usar **Imprimir precuenta desde navegador (80 mm)** en el equipo con la impresora instalada.
3. La precuenta identifica la cuenta como **pendiente de pago**. Imprimirla no registra una venta ni un pago, no abre un turno y no cierra el pedido.
4. Cuando el cliente pague, pulsa **Pagar**, selecciona el método y confirma el pago. Los productos deben haberse enviado a cocina para cobrar.
5. Además de efectivo, tarjeta y combinado, se ofrece **Transferencia**, con su referencia.
6. En efectivo, los botones **$50, $100, $150, $200 y $500** establecen el importe recibido. El sistema calcula el cambio y rechaza importes insuficientes.

La precuenta conserva los productos y precios que tenía al generarse. Si el pedido cambia, genera otra precuenta. Los reintentos de impresión recuperan el trabajo pendiente o fallido sin duplicar cobros.

Los tickets y precuentas muestran:

> Antojitos Mexicanos Frank  
> Carretera al Salto #6  
> San Jose del Castillo  
> Tel: 3330147392

## Cajero y conciliación

El usuario **CAJERO** registra pedidos y cobros, abre caja y captura su declaración de cierre. No tiene acceso a ventas históricas, contabilidad, importes esperados ni diferencias. Su comprobante de cierre contiene únicamente lo declarado.

En **Caja y corte**, el administrador consulta **Cortes registrados por cajero** para comparar lo registrado, lo declarado y la diferencia por forma de pago. Cada corte nuevo identifica al usuario que lo declaró. Al cerrar sesión se limpian los datos y paneles financieros de la terminal.

El PIN de CAJERO se configura mediante `SEED_CASHIER_PIN`. El valor predeterminado de desarrollo es `3456`; las instalaciones de piloto generan un PIN independiente. Las migraciones conservan las credenciales existentes. Consulta también [ejecución local y usuarios](../phase-4/EJECUCION_LOCAL.md).

## Clientes frecuentes

En cualquier pedido, abre **Cliente y programación**:

1. Busca un cliente frecuente por nombre o teléfono y selecciónalo, o pulsa **Nuevo cliente frecuente**.
2. Registra el nombre y, opcionalmente, teléfono, dirección y notas. Al guardarlo queda seleccionado.
3. Pulsa **Guardar datos** para vincularlo al pedido. La selección está disponible en venta rápida, para llevar y pedidos programados.

Puedes seguir escribiendo nombres ocasionales sin crear una ficha. Cambiar el nombre manualmente desvincula la ficha anterior. Los pedidos conservan una copia de los datos del cliente para que futuras ediciones de su ficha no alteren el historial.

## Actualización

Las migraciones `0014` a `0017` se aplican al iniciar la API actualizada. Incluyen el menú, clientes frecuentes, permisos/cajero e impresión de precuentas. En Windows se utiliza el proceso habitual de **ACTUALIZAR-APP.cmd**; para instalaciones locales de desarrollo, ejecuta `pnpm --filter @antojit-os/api db:migrate` antes de iniciar la versión nueva. No es necesario volver a cargar los datos iniciales de una instalación existente.
