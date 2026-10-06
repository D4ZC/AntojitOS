# Análisis funcional de Soft Restaurant

**Producto analizado:** Soft Restaurant, de National Soft  
**Fecha de elaboración:** 5 de octubre de 2026  
**Enfoque:** mapa funcional y operativo del punto de venta, administración y ecosistema de integraciones.

> **Importante sobre el alcance:** Soft Restaurant ha tenido distintas versiones, ediciones, esquemas de licencia y complementos. No todas las funciones descritas están incluidas en toda instalación. En este documento se marca como **Base** lo que normalmente forma parte del núcleo del sistema y como **Opcional** lo que suele requerir una edición superior, licencia adicional, servicio en la nube, integración o hardware compatible. Antes de comprar o implementar se debe solicitar al distribuidor una matriz escrita de la versión y licencia exactas.

## 1. Resumen: qué es y cómo opera

Soft Restaurant es un sistema de punto de venta y administración para negocios de alimentos y bebidas. Su función central es conectar cinco procesos:

1. La captura de una orden en caja, mesa, barra, dispositivo móvil o canal externo.
2. El envío de los productos al área que debe prepararlos, por ejemplo cocina o bar.
3. El control de la cuenta: cargos, descuentos, división, pagos, propina, ticket y factura.
4. La afectación administrativa: ventas, caja, impuestos, inventario, costo y auditoría.
5. La consulta de indicadores y reportes por turno, empleado, producto, área o sucursal.

En una instalación típica existe una base de datos compartida por las terminales del establecimiento. Las terminales de venta, administración y producción trabajan sobre esa información según los permisos del usuario. La operación local de venta normalmente puede continuar sin Internet; las funciones de timbrado fiscal, nube, pedidos externos, respaldo remoto o sincronización sí dependen de conectividad.

### 1.1 Conceptos que no deben confundirse

| Concepto | Función dentro del sistema |
|---|---|
| **Terminal** | Equipo desde el que se vende, cobra o administra. Puede tener comportamiento y periféricos propios. |
| **Caja o turno de caja** | Periodo de responsabilidad de un cajero, con fondo inicial, movimientos y corte. |
| **Salón o área de servicio** | Agrupación visual de mesas, por ejemplo terraza, comedor o planta alta. |
| **Mesa o cuenta** | Contenedor de consumos. Una mesa puede tener una o más cuentas dependiendo de la configuración y operación. |
| **Comanda** | Instrucción de preparación enviada a cocina, bar u otro centro de producción. No equivale al comprobante de pago. |
| **Centro de producción** | Destino operativo de los productos: cocina, barra, parrilla, postres, etc. |
| **Ticket** | Comprobante de una venta cerrada en el punto de venta. |
| **CFDI** | Comprobante fiscal timbrado a partir de uno o varios tickets, sujeto a configuración fiscal y servicio de timbrado. |
| **Insumo** | Materia prima inventariable, como queso, aceite o cerveza. |
| **Producto de venta** | Artículo que aparece en el menú, como una hamburguesa o un refresco. Puede descontar uno o varios insumos. |
| **Receta** | Relación entre el producto vendido y los insumos/cantidades que deben consumirse. |

## 2. Arquitectura funcional y modalidades de uso

### 2.1 Operación en red local — Base

- Una computadora actúa como servidor de datos y las terminales se conectan por la red del negocio.
- Todas las terminales consultan mesas, órdenes, existencias y ventas comunes, pero cada una puede tener impresoras, caja y permisos diferentes.
- La base de datos conserva catálogos y transacciones. El administrador debe definir respaldos y probar periódicamente que puedan restaurarse.
- El rendimiento depende de la salud del servidor, la red, la base de datos y el número de terminales concurrentes.
- Un dispositivo móvil de comandas normalmente se conecta por Wi-Fi a la red local y no sustituye al servidor.

### 2.2 Perfiles de terminal — Base

Una terminal puede configurarse para uno o varios usos:

- **Venta rápida o mostrador:** cobra en el mismo flujo en que captura el pedido.
- **Mesas:** mantiene cuentas abiertas durante el servicio.
- **Caja:** recibe pagos de cuentas creadas por meseros u otras terminales.
- **Barra:** maneja cuentas por nombre, número o mesa y envía productos al área correspondiente.
- **Administración:** modifica catálogos, costos, inventarios y reportes.
- **Producción:** recibe comandas en impresora o pantalla si existe el complemento.

### 2.3 Periféricos — Base u Opcional

Según los controladores y la compatibilidad de la versión, puede trabajar con:

- impresoras térmicas de tickets y comandas;
- cajón de dinero conectado a impresora o terminal;
- lector de código de barras;
- monitor táctil;
- visor de cliente;
- báscula para productos vendidos por peso;
- dispositivos móviles para meseros;
- pantalla de cocina o KDS;
- terminal de pago bancaria mediante una integración compatible;
- impresoras convencionales para reportes y documentos.

El software no vuelve compatible automáticamente cualquier dispositivo: se deben validar modelo, interfaz, controlador, versión de Windows y método de conexión.

## 3. Configuración general del negocio

### 3.1 Datos de empresa y parámetros — Base

Permite definir los datos que gobiernan la operación:

- razón social, nombre comercial, RFC y datos de contacto;
- domicilio y datos que aparecen en tickets o formatos;
- moneda, decimales, redondeos y tipo de cambio cuando aplique;
- tasas de impuesto, precios con impuesto incluido o separado y tratamiento fiscal de productos;
- folios o consecutivos de tickets, órdenes y otros documentos;
- formatos de fecha, hora y numeración;
- comportamiento al abrir, cobrar, cancelar o reabrir una cuenta;
- textos legales, agradecimientos, logotipo y encabezados de impresión;
- directorios de datos, respaldos y archivos generados.

Un cambio de impuestos, redondeo o folios puede afectar ventas y reportes; por ello debe estar restringido a administradores y aplicarse fuera del servicio cuando sea posible.

### 3.2 Áreas, salones y mesas — Base

- Se crean salones como comedor, terraza, barra o segundo piso.
- Dentro de cada salón se dan de alta mesas con número o nombre y, según la versión, posición en un plano visual.
- Puede definirse capacidad o número de comensales para medir ocupación y consumo promedio.
- El punto de venta muestra estados visuales: libre, ocupada, con cuenta, pendiente de cobro o en otra condición configurada.
- Una cuenta conserva responsable, hora de apertura, comensales, productos enviados y cambios realizados.

### 3.3 Centros de producción e impresión — Base

- Se crean destinos como cocina caliente, cocina fría, barra y postres.
- A cada producto o familia se le asigna el destino que debe recibirlo.
- Una sola orden puede separarse automáticamente: bebidas a barra y alimentos a cocina.
- Se configuran impresoras, copias, encabezados, tamaño de papel y terminal desde la que se enruta.
- Los modificadores y notas de preparación deben imprimirse junto al artículo, por ejemplo “sin cebolla” o “término medio”.
- La reimpresión debe quedar protegida por permisos para evitar duplicidad en producción.

## 4. Catálogo de menú, productos y recetas

### 4.1 Familias, grupos y presentación visual — Base

- Organiza los artículos en familias o grupos: entradas, bebidas, platos fuertes, postres, etc.
- Define el orden y botones que verá el operador en la pantalla táctil.
- Puede utilizar colores, imágenes, claves rápidas o códigos de barras para acelerar la captura.
- Permite ocultar o desactivar un artículo sin borrar su historial.
- La organización del menú también alimenta reportes por familia y puede definir rutas de impresión o reglas de descuento.

### 4.2 Productos de venta — Base

Para cada artículo se controla, dependiendo de la edición:

- clave interna, descripción corta y descripción para impresión;
- familia, unidad de venta y presentación;
- precio o precios por lista;
- impuestos aplicables;
- código de barras;
- centro de producción e impresora de comanda;
- receta o insumo que debe descontar;
- posibilidad de descuento, cambio de precio o venta abierta;
- disponibilidad, horario o vigencia;
- imagen y posición en la interfaz;
- datos fiscales como clave de producto/servicio y unidad SAT cuando la facturación lo requiera.

### 4.3 Modificadores, complementos y observaciones — Base u Opcional

Los modificadores documentan elecciones del cliente y evitan depender de notas libres:

- punto de cocción, guarnición, sabor, tamaño, tipo de leche o ingrediente a retirar;
- modificadores obligatorios u opcionales;
- selección única o múltiple;
- cantidad mínima y máxima de opciones;
- cargo adicional o sustitución sin costo;
- afectación de receta cuando el complemento añade o reemplaza insumos;
- impresión destacada en la comanda.

Las observaciones libres sirven para excepciones, pero son menos analizables que un modificador catalogado y requieren mayor control operativo.

### 4.4 Recetas e insumos — Base en ediciones con inventario

- Una receta contiene las cantidades de materia prima consumidas por una unidad vendida.
- Puede incluir subrecetas o preparados, por ejemplo salsa de la casa, que a su vez consumen otros insumos.
- Debe registrar unidad y equivalencia: gramos, kilogramos, mililitros, litros, piezas, cajas, etc.
- Al cerrar la venta, el sistema calcula el consumo teórico multiplicando la receta por las unidades vendidas.
- El costo de los insumos permite estimar costo de receta, margen y porcentaje de costo.
- El rendimiento y la merma deben configurarse correctamente; de lo contrario el inventario teórico será incorrecto aunque las ventas estén bien capturadas.

**Ejemplo:** si una hamburguesa consume 0.150 kg de carne y se venden 10, el consumo teórico es 1.500 kg. Si el conteo físico muestra 1.800 kg menos, existe una variación de 0.300 kg que debe investigarse como merma, porcionado excesivo, receta incorrecta o movimiento no registrado.

### 4.5 Combos, paquetes y promociones de producto — Opcional o según edición

- Crea productos compuestos por grupos de elección, por ejemplo bebida + plato + guarnición.
- Obliga al operador a completar las elecciones antes de enviar la orden.
- Permite cargos por sustituciones o tamaños superiores.
- Distribuye el pedido a distintos centros de producción.
- Puede consumir las recetas de los componentes elegidos.
- El tratamiento de precio, impuesto, descuento y representación fiscal debe probarse con la configuración exacta.

### 4.6 Listas de precios y cambios temporales — Según edición

- Diferentes precios para comedor, barra, entrega, evento o tipo de cliente.
- Cambios por día, horario, sucursal o canal cuando el módulo contratado lo permite.
- Actualización masiva de precios por porcentaje, importe o selección de artículos.
- Programación de promociones como hora feliz, descuento por familia o producto bonificado.
- Registro del precio realmente aplicado en la venta para conservar el historial aun cuando el catálogo cambie después.

## 5. Punto de venta y ciclo completo de una cuenta

### 5.1 Inicio de turno — Base

1. El empleado se identifica con usuario, contraseña, PIN o mecanismo configurado.
2. El cajero abre turno y registra fondo inicial si el negocio lo utiliza.
3. La terminal asocia las operaciones posteriores con usuario, caja y horario.
4. El sistema valida permisos y, en instalaciones con inventario por almacén, el contexto operativo correspondiente.

El fondo inicial no es una venta; es efectivo disponible para dar cambio. Debe aparecer por separado en el corte.

### 5.2 Apertura de mesa o cuenta — Base

1. El mesero selecciona salón y mesa, o crea una cuenta de barra/mostrador.
2. Registra número de comensales y cliente si es necesario.
3. Añade productos; el sistema solicita modificadores obligatorios.
4. Antes del envío puede modificar cantidades o retirar capturas que todavía no se han comandado.
5. Al enviar, se genera la comanda y se separa por centro de producción.

Una cuenta permanece abierta y puede recibir pedidos adicionales. Cada envío conserva hora, operador y artículos para diferenciar rondas.

### 5.3 Captura y envío de comandas — Base

- Búsqueda por botón, familia, clave, descripción o código de barras.
- Cantidades, medios productos o porciones cuando el catálogo lo soporta.
- Modificadores y notas de preparación.
- Envío parcial o total de productos pendientes.
- Impresión o visualización en el área productiva asignada.
- Separación de nuevas adiciones respecto de lo ya solicitado.
- Reimpresión controlada y registro de la acción.
- Cancelación de un producto enviado mediante motivo y autorización si así se configuró.

### 5.4 Operaciones sobre mesas y cuentas — Base

Dependiendo de permisos, el personal puede:

- cambiar responsable o mesero;
- mover toda la cuenta a otra mesa;
- transferir productos seleccionados entre cuentas;
- juntar cuentas de varias mesas;
- separar una cuenta por artículos, personas o importes;
- abrir varias cuentas relacionadas con una misma mesa;
- corregir el número de comensales;
- consultar consumos enviados y pendientes;
- imprimir una precuenta sin cerrar la venta;
- reabrir una cuenta o ticket cerrado cuando la configuración y el control administrativo lo permitan.

Cada operación sensible debe exigir motivo o autorización y quedar en bitácora; de lo contrario se pierde trazabilidad sobre ventas, producción y efectivo.

### 5.5 Venta rápida, mostrador y para llevar — Base

- Crea la orden sin ocupar una mesa.
- Puede identificar el pedido por número, nombre o referencia.
- Permite cobrar antes de producir o producir antes de cobrar, según el flujo configurado.
- Imprime ticket del cliente y comanda de producción.
- Puede marcar el tipo de servicio como para llevar para que cocina use el empaque correcto.
- Es adecuado para cafeterías, comida rápida, panadería, bar y mostrador.

### 5.6 Precuenta — Base

La precuenta muestra el consumo para revisión del cliente, pero normalmente no representa un pago ni una factura. Puede incluir:

- artículos, cantidades y precios;
- descuentos, impuestos y total;
- sugerencia o espacio para propina;
- desglose por persona si el flujo lo admite;
- leyendas para solicitar factura.

Imprimir una precuenta no debe disminuir inventario por segunda vez ni cerrar la caja; sólo prepara el cobro.

### 5.7 Cobro — Base

El cajero puede:

- aceptar efectivo, tarjeta, transferencia, vales, crédito u otras formas configuradas;
- combinar varias formas de pago en una misma cuenta;
- recibir pagos parciales derivados de una cuenta dividida;
- calcular cambio en efectivo;
- registrar propina separada de la venta;
- manejar moneda extranjera y tipo de cambio si la configuración lo permite;
- emitir ticket, copia o comprobante interno;
- capturar referencia o autorización de un medio electrónico;
- enviar la venta a factura o dejarla disponible para facturación posterior.

El software registra la forma de pago declarada; una terminal bancaria sólo queda conciliada automáticamente si existe una integración explícita. Sin ella, el operador debe capturar el resultado del cobro y después comparar el corte del banco contra el del sistema.

### 5.8 Descuentos, cortesías y cambios de precio — Base u Opcional

- Descuento por artículo o por cuenta, como porcentaje o cantidad.
- Precio manual para artículos autorizados.
- Cortesía total o parcial con motivo.
- Promoción automática sujeta a producto, horario, cantidad o cliente.
- Autorización de supervisor por contraseña o perfil.
- Reporte posterior de quién solicitó y quién autorizó.

Estas funciones modifican ingreso y margen. Es recomendable impedir que un mismo usuario capture, autorice y cierre una excepción sin revisión.

### 5.9 Cancelaciones y devoluciones — Base

Se distinguen varios casos:

- **Retirar antes de comandar:** corrige una captura que aún no llegó a producción.
- **Cancelar después de comandar:** requiere avisar al centro de producción y registrar merma cuando el producto ya se preparó.
- **Cancelar cuenta o ticket:** revierte una venta completa de acuerdo con permisos y periodo abierto.
- **Devolver o bonificar:** genera la operación administrativa correspondiente; no debe resolverse borrando el historial.
- **Cancelar CFDI:** es un proceso fiscal distinto de cancelar la venta y sigue las reglas del SAT y del proveedor de timbrado.

El sistema debe conservar folio, fecha, motivo, usuario y autorización. Una cancelación no debe desaparecer de los reportes de auditoría.

## 6. Producción: cocina, barra y expedición

### 6.1 Comandas impresas — Base

- Cada centro recibe sólo los productos que le corresponden.
- La comanda incluye mesa o número de orden, mesero, hora, cantidad, artículo, modificadores y notas.
- Las adiciones posteriores deben distinguirse de la orden original.
- Puede imprimirse más de una copia, por ejemplo preparación y expedición.
- La falla de una impresora exige un procedimiento de contingencia; reenviar sin verificar puede duplicar producción.

### 6.2 Pantalla de cocina o KDS — Opcional

Cuando se contrata y configura una pantalla de producción, el flujo puede sustituir o complementar el papel:

- recibe comandas por estación;
- muestra antigüedad y prioridad;
- agrupa o separa artículos de una orden;
- cambia estados como recibido, en preparación y terminado;
- permite marcar o “despachar” una comanda;
- aporta tiempos de preparación y seguimiento;
- facilita que expedición vea qué falta para completar una cuenta.

Los nombres exactos de estados y las métricas disponibles dependen del complemento. Un KDS no corrige por sí mismo una asignación incorrecta de productos a centros de producción.

### 6.3 Control de disponibilidad — Base u Opcional

- Desactivar temporalmente productos agotados.
- Marcar existencias o conteos de preparación cuando el módulo lo permite.
- Comunicar agotados a terminales móviles y de venta.
- Evitar vender un producto desactivado o mostrar una advertencia.

El descuento por receta representa inventario teórico, no disponibilidad instantánea garantizada: las mermas y movimientos no registrados pueden hacer que el sistema muestre existencia cuando físicamente ya no hay producto.

## 7. Caja, turnos y conciliación

### 7.1 Movimientos de caja — Base

Además de cobros, el turno puede registrar:

- fondo inicial;
- entradas de efectivo ajenas a venta;
- retiros o depósitos parciales;
- gastos autorizados;
- cambio de efectivo entre cajas;
- propinas por entregar;
- pagos o ajustes con motivo y responsable.

Estos movimientos no deben confundirse con ingreso por ventas y se muestran separados en el corte.

### 7.2 Consulta o corte preliminar — Base

Permite revisar el turno sin necesariamente cerrarlo:

- venta bruta y neta;
- impuestos;
- descuentos, cortesías y cancelaciones;
- pagos por forma;
- efectivo teórico;
- movimientos de caja;
- propinas;
- número de tickets y consumo promedio;
- ventas por cajero, mesero o terminal.

Según permisos, el negocio puede ocultar el efectivo teórico al cajero antes de que declare su conteo, reduciendo el riesgo de ajustar la cifra para que coincida.

### 7.3 Cierre o corte final — Base

1. El cajero deja de recibir cuentas o las transfiere correctamente.
2. Cuenta efectivo y declara importes por forma de pago cuando el flujo lo solicita.
3. El sistema compara declarado contra teórico.
4. Registra faltante o sobrante.
5. Emite el reporte de corte y bloquea o finaliza el turno conforme a configuración.
6. Administración concilia tarjetas, transferencias, vales, depósitos y efectivo físico.

Cerrar caja no reemplaza el cierre operativo del día ni la conciliación bancaria. También se deben revisar cuentas abiertas, tickets cancelados, folios, CFDI pendientes e inventario crítico.

## 8. Inventarios, compras, recetas y costos

### 8.1 Catálogo de insumos — Base en ediciones con inventario

Cada insumo puede contener:

- clave, descripción y grupo;
- unidad base de inventario;
- unidades de compra y sus conversiones;
- costo y proveedor de referencia;
- impuestos de compra cuando correspondan;
- mínimos, máximos y punto de reorden;
- almacén o ubicación;
- estado activo/inactivo;
- código de barras o referencia del proveedor.

**Ejemplo de conversión:** una caja contiene 12 botellas y la unidad base es botella. Recibir 5 cajas debe incrementar 60 botellas. Si la equivalencia está mal, compras, costo y recetas quedarán distorsionados.

### 8.2 Almacenes — Según edición

- Separa existencias de almacén general, cocina, bar u otras ubicaciones.
- Permite consultar existencia por almacén y existencia total.
- Una transferencia genera salida en el origen y entrada en el destino; no es compra ni consumo.
- Los permisos deben limitar quién solicita, entrega y recibe transferencias.
- El almacén que descuenta una receta debe corresponder al flujo real de abastecimiento.

### 8.3 Compras y entradas — Base u Opcional según edición

El flujo de abastecimiento puede abarcar:

1. proveedor y, si está disponible, solicitud u orden de compra;
2. recepción de productos con cantidad, unidad y costo;
3. conversión a unidad base;
4. afectación de existencia y costo;
5. registro de referencia del documento del proveedor;
6. devolución o ajuste cuando la recepción fue incorrecta.

La disponibilidad de órdenes de compra, cuentas por pagar o comparación detallada contra factura varía por edición; no debe asumirse que Soft Restaurant sustituye a un ERP contable.

### 8.4 Salidas, mermas y ajustes — Base en inventario

- **Salida:** consumo no originado por una venta, entrega o baja autorizada.
- **Merma:** pérdida por caducidad, derrame, error de preparación, invitación interna u otra causa.
- **Ajuste:** corrección de diferencia con justificación.
- **Transferencia:** movimiento entre almacenes sin cambiar el total de la empresa.
- **Devolución a proveedor:** salida relacionada con una recepción previa o documento de devolución.

Los motivos catalogados permiten medir por qué se pierde inventario. Usar “ajuste” para todo oculta problemas de compra, porcionado, robo o captura.

### 8.5 Inventario físico — Base en inventario

1. Se define fecha de corte y almacén.
2. Se suspenden o controlan movimientos durante el conteo.
3. Se capturan cantidades físicas en su unidad correcta.
4. El sistema compara físico contra teórico.
5. Un responsable revisa diferencias relevantes.
6. Se autoriza el ajuste, conservando evidencia y motivo.

El conteo puede apoyarse en hojas, lector o captura por zonas según las funciones disponibles. Conviene hacer conteos cíclicos de insumos de alto valor además del inventario general.

### 8.6 Consumo teórico y costo de venta — Base en inventario

- Las ventas cerradas multiplican cantidades vendidas por la receta vigente o asociada.
- El consumo teórico se compara con movimientos y conteos físicos.
- El costo de receta cambia cuando cambian costos de insumos, equivalencias, rendimientos o porciones.
- Reportes de margen relacionan precio neto y costo estimado.
- Una receta sin insumos o un producto no vinculado produce ventas sin consumo, por lo que debe existir un reporte de auditoría de artículos sin receta.

El costo mostrado por el sistema es tan confiable como las compras, equivalencias y recetas capturadas. No equivale automáticamente al costo contable oficial.

### 8.7 Preparados y producción interna — Opcional o según edición

- Convierte materias primas en un preparado o subreceta.
- Registra rendimiento real del lote.
- Descuenta insumos y aumenta existencia del preparado si éste se controla como inventariable.
- Permite documentar merma del proceso.
- Facilita comparar rendimiento estándar contra real.

Es útil para salsas, masas, jarabes, porciones de carne o producción centralizada.

## 9. Clientes, crédito, lealtad y reservaciones

### 9.1 Catálogo de clientes — Base

Puede conservar:

- nombre o razón social;
- teléfonos y correo;
- domicilio y direcciones de entrega;
- RFC, régimen fiscal, código postal y uso de CFDI;
- notas, grupo o clasificación;
- límite o condición de crédito si esa función está habilitada;
- historial de compras asociado cuando el flujo identifica al cliente.

Los datos fiscales deben validarse antes de timbrar y protegerse mediante permisos y políticas de privacidad.

### 9.2 Crédito y cuentas de clientes — Según edición

- Permite cerrar una venta contra saldo o crédito en vez de recibir pago inmediato.
- Registra abonos y saldos.
- Puede imponer límite, autorización o bloqueo.
- Genera estados o reportes para cobranza.

Debe definirse si el módulo sólo controla saldos operativos o si se integra con la contabilidad. Conceder crédito sin límites y conciliación convierte ventas registradas en cartera difícil de recuperar.

### 9.3 Lealtad, monedero, puntos o promociones personalizadas — Opcional

El ecosistema puede incorporar identificación de cliente, acumulación y redención de beneficios. La lógica exacta —puntos, vigencia, niveles, cupones o monedero— depende del producto o integración contratada. Se debe verificar:

- qué ventas acumulan;
- cuándo se devuelven puntos por cancelación;
- si el saldo es compartido entre sucursales;
- quién puede hacer ajustes manuales;
- tratamiento fiscal y contable del beneficio;
- protección y consentimiento sobre datos del cliente.

### 9.4 Reservaciones y lista de espera — Opcional

Cuando se usa una función o integración de reservaciones, normalmente administra fecha, hora, cliente, número de personas, notas y estado. Debe relacionarse con la disponibilidad real de mesas y distinguir reservado, llegado, sentado, cancelado y no presentado. No todas las licencias incluyen una agenda de reservaciones completa.

## 10. Servicio a domicilio, recolección y canales digitales

### 10.1 Pedido telefónico o capturado en caja — Base u Opcional según edición

- Busca cliente por teléfono o nombre.
- Selecciona o registra dirección y referencias.
- Captura productos, cargos, descuento, forma esperada de pago y hora prometida.
- Identifica si es entrega o recolección.
- Envía a producción como cualquier otra orden.
- Asigna repartidor y registra salida/entrega cuando el flujo lo soporta.
- Conserva ticket, cliente y dirección relacionados.

### 10.2 Menú QR y pedido digital — Opcional

Dependiendo del servicio contratado, un cliente puede consultar el menú y, en algunos casos, generar una solicitud o pedido. Se debe confirmar si la solución sólo muestra el menú o también:

- acepta pedido y modificadores;
- identifica mesa;
- solicita aprobación del mesero;
- cobra en línea;
- manda directamente a producción;
- respeta disponibilidad y promociones;
- sincroniza precios en tiempo real.

“Menú digital” no implica necesariamente “pedido y pago autónomos”.

### 10.3 Plataformas de entrega y agregadores — Opcional

Una integración puede recibir pedidos de aplicaciones externas en el punto de venta y reducir la recaptura. El flujo esperado es:

1. llega el pedido con folio del canal;
2. se valida correspondencia entre productos y modificadores externos e internos;
3. el restaurante acepta o rechaza;
4. se envía a producción;
5. se registra el estado y la forma de pago del canal;
6. se concilian venta bruta, comisión, descuentos y depósito neto.

La existencia de una integración, los canales compatibles y el nivel de sincronización cambian con el tiempo. Aun con integración, las comisiones y depósitos deben conciliarse fuera del simple total de ventas.

### 10.4 Comanda móvil para meseros — Opcional

- Consulta salones, mesas y cuentas autorizadas.
- Captura productos y modificadores junto a la mesa.
- Envía la orden por Wi-Fi al sistema y de ahí a cocina/bar.
- Añade consumos sin regresar a una terminal fija.
- Puede mostrar precuenta, estado o disponibilidad según la aplicación.

Su confiabilidad depende de cobertura Wi-Fi, batería, permisos y sincronización. Se necesita un procedimiento para capturar pedidos si el dispositivo o la red fallan.

## 11. Facturación electrónica e impuestos

### 11.1 Preparación fiscal — Base u Opcional con servicio de facturación

Para emitir CFDI se configuran:

- emisor, régimen fiscal, lugar de expedición y certificados o mecanismo del servicio;
- claves SAT de productos y unidades;
- impuestos y tasas;
- receptor: RFC, nombre/razón social, régimen, código postal y uso de CFDI;
- forma y método de pago;
- proveedor autorizado de certificación o servicio de timbrado compatible.

La validez fiscal depende de la normativa vigente, datos correctos y timbrado, no sólo de que el punto de venta imprima un formato.

### 11.2 Factura desde ticket — Según licencia e integración

1. Se localiza el ticket elegible.
2. Se valida que no haya sido facturado o cancelado.
3. Se asigna el receptor y datos fiscales.
4. Se genera y envía el CFDI al servicio de timbrado.
5. Se guardan UUID, XML y representación PDF.
6. Se entrega por descarga, impresión o correo según la herramienta.

El sistema debe relacionar factura y ticket para impedir doble facturación.

### 11.3 Factura global — Según licencia e integración

- Agrupa operaciones con público en general no facturadas individualmente.
- Excluye tickets cancelados o ya facturados.
- Utiliza periodicidad y datos fiscales vigentes.
- Conserva relación con los folios incluidos para auditoría.

Una factura global no es simplemente la suma del corte: deben respetarse exclusiones, impuestos, descuentos y reglas fiscales vigentes.

### 11.4 Cancelación fiscal — Según licencia e integración

- Solicita cancelación usando UUID y motivo fiscal.
- Puede requerir folio sustituto y, según el caso, aceptación del receptor.
- Consulta o registra el estado de la solicitud.
- No borra XML ni historial.
- Debe conciliarse con la cancelación o devolución comercial dentro del punto de venta.

Para decisiones fiscales se debe utilizar documentación vigente del SAT y del proveedor de timbrado; las reglas pueden cambiar después de la versión instalada.

## 12. Usuarios, perfiles, autorizaciones y auditoría

### 12.1 Usuarios y roles — Base

Permite crear perfiles como mesero, cajero, capitán, gerente, almacenista y administrador. Los permisos pueden abarcar:

- entrar a módulos administrativos;
- ver o cambiar costos y precios;
- aplicar descuentos o cortesías;
- cancelar productos, cuentas o tickets;
- reimprimir comandas y tickets;
- transferir mesas o consumos;
- abrir cajón sin venta;
- ver cortes y efectivo teórico;
- modificar inventario;
- facturar o cancelar CFDI;
- cambiar configuración, usuarios o permisos.

Se recomienda asignar usuarios individuales. Compartir la contraseña de “administrador” elimina la atribución de acciones.

### 12.2 Autorización de supervisor — Base

Una acción restringida puede solicitar credenciales de un usuario con mayor permiso. La transacción debe conservar tanto al operador original como al autorizador. Autorizar no significa reemplazar al usuario que hizo la captura.

### 12.3 Bitácora y trazabilidad — Base, con detalle según versión

Los controles de auditoría deben permitir investigar:

- inicio y cierre de sesión;
- aperturas y cierres de caja;
- cancelaciones y devoluciones;
- descuentos, cortesías y cambios de precio;
- transferencias de mesa o artículos;
- reimpresiones;
- movimientos y ajustes de inventario;
- cambios administrativos sensibles;
- usuario, terminal, fecha, hora, folio y motivo.

La profundidad y retención de la bitácora debe comprobarse en la versión contratada. Los reportes de excepción deben revisarse diariamente, no sólo cuando aparece un faltante.

## 13. Reportes y análisis

La oferta exacta de reportes cambia por versión. Funcionalmente se agrupan así:

### 13.1 Ventas

- ventas por fecha, turno, hora y terminal;
- venta bruta, descuentos, impuestos y venta neta;
- tickets, comensales, consumo promedio y artículos por ticket;
- ventas por producto, familia, presentación y modificador;
- productos más y menos vendidos;
- ventas por tipo de servicio: mesa, mostrador, entrega o recolección;
- comparación de periodos cuando el módulo lo permite.

### 13.2 Personal y servicio

- venta por mesero, cajero o repartidor;
- mesas y cuentas atendidas;
- descuentos, cancelaciones y autorizaciones por usuario;
- propinas registradas;
- tiempo de permanencia de cuenta o producción cuando se capturan los estados necesarios;
- productividad por horario o área.

### 13.3 Caja y formas de pago

- cortes por caja y turno;
- pagos por efectivo, tarjeta, transferencia, vales, crédito y otras formas;
- fondos, entradas, retiros y gastos;
- efectivo teórico contra declarado;
- sobrantes y faltantes;
- propina y cambio;
- tickets cancelados, reabiertos o reimpresos.

### 13.4 Inventario y compras

- existencia por insumo y almacén;
- kardex o historial de movimientos cuando está disponible;
- compras y costos por proveedor o periodo;
- transferencias, mermas, salidas y ajustes;
- inventario teórico contra físico;
- consumo teórico por ventas;
- insumos bajo mínimo o sin movimiento;
- recetas sin componentes o productos sin receta;
- costo y margen estimado de productos.

### 13.5 Clientes y fiscal

- ventas por cliente;
- saldos y abonos si se utiliza crédito;
- tickets facturados y pendientes;
- relación de CFDI, UUID, receptor, importe y estado;
- impuestos trasladados o desglosados;
- operaciones incluidas en factura global.

### 13.6 Consulta, filtros y exportación

Normalmente los reportes permiten filtrar por fechas y otros criterios, previsualizar e imprimir. La exportación a formatos como hoja de cálculo, PDF o archivo de datos depende del reporte y la versión. Exportar no garantiza que el reporte tenga estructura contable lista para importar; debe validarse el formato de la integración destino.

## 14. Administración remota, nube y múltiples sucursales

### 14.1 Indicadores en la nube — Opcional

Los servicios en línea del ecosistema pueden centralizar ventas e indicadores para consulta remota. Según el plan, pueden mostrar:

- venta acumulada y por sucursal;
- tickets y consumo promedio;
- productos o familias destacadas;
- comparación de periodos;
- formas de pago y desempeño operativo.

Se debe verificar frecuencia de actualización, tiempo de retención, permisos, exportación y qué ocurre si una sucursal pierde Internet.

### 14.2 Operación multisucursal — Opcional

Una organización con varias unidades necesita resolver por separado:

- catálogos y precios comunes o locales;
- recetas y costos por sucursal;
- usuarios y permisos;
- consolidación de ventas;
- inventario y transferencias entre unidades;
- clientes y beneficios compartidos;
- facturación por razón social y lugar de expedición;
- conexión y sincronización.

Un tablero consolidado no implica necesariamente administración central bidireccional de todos los catálogos. Debe confirmarse qué datos sólo se consultan y cuáles se publican hacia las sucursales.

## 15. Mantenimiento, respaldo y continuidad operativa

### 15.1 Copias de seguridad — Base

- Programar respaldos de la base de datos con frecuencia acorde al volumen de ventas.
- Guardar al menos una copia fuera del equipo servidor.
- Cifrar o proteger copias que contienen datos fiscales y de clientes.
- Verificar espacio disponible y fecha del último respaldo correcto.
- Probar restauraciones; un archivo no probado no constituye una recuperación garantizada.
- Coordinar respaldo de XML, configuraciones, formatos e imágenes que no estén dentro de la base.

### 15.2 Actualizaciones — Base como tarea administrativa

- Revisar compatibilidad de versión, base de datos, Windows, controladores y complementos.
- Respaldar antes de actualizar.
- Aplicar primero en una ventana de mantenimiento.
- Probar venta, impresión, comandas, cobro, inventario y factura.
- Actualizar terminales y servidor según el orden indicado por el proveedor.

No se debe actualizar el servidor a mitad del servicio sin un plan de reversión y prueba.

### 15.3 Contingencias

El negocio debe documentar qué hacer ante:

- servidor o terminal fuera de servicio;
- pérdida de red local;
- impresora de cocina sin papel o conexión;
- falta de Internet para timbrado o canal externo;
- terminal bancaria sin servicio;
- dispositivo móvil descargado;
- base de datos dañada;
- corte de energía.

El plan debe evitar folios duplicados, producción duplicada y cobros no registrados al recapturar operaciones.

## 16. Flujo operativo completo: del pedido al cierre

| Etapa | Acción en Soft Restaurant | Resultado / control |
|---|---|---|
| 1. Preparación | Configurar menú, recetas, usuarios, cajas, salones e impresoras. | Catálogos y rutas listas. |
| 2. Apertura | Cajero abre turno y registra fondo. | Responsabilidad de caja iniciada. |
| 3. Orden | Mesero abre mesa o caja crea pedido rápido. | Cuenta con responsable, hora y comensales. |
| 4. Captura | Se agregan productos y modificadores. | Precio, impuesto y receta identificados. |
| 5. Comanda | Se envía la ronda. | Cocina/bar recibe sólo lo que le corresponde. |
| 6. Producción | Área prepara y, con KDS, actualiza estado. | Pedido listo para servir/entregar. |
| 7. Ajustes | Se añaden rondas, transfieren o dividen consumos. | Historial de cambios y autorizaciones. |
| 8. Precuenta | Cliente revisa consumo. | Total previo al cobro, cuenta aún abierta. |
| 9. Pago | Se aplican formas de pago y propina. | Venta cerrada y ticket emitido. |
| 10. Inventario | Venta consume recetas teóricas. | Existencia y costo teórico actualizados. |
| 11. Factura | Ticket se timbra si el cliente la solicita. | XML/PDF y UUID ligados a la venta. |
| 12. Corte | Cajero declara y compara valores. | Diferencias y formas de pago documentadas. |
| 13. Revisión | Gerencia revisa excepciones y resultados. | Cancelaciones, mermas y márgenes supervisados. |

## 17. Límites: lo que no debe asumirse

- No es automáticamente un sistema contable, de nómina o ERP completo.
- El inventario es teórico si compras, recetas, mermas y conteos no se capturan disciplinadamente.
- Registrar “tarjeta” no concilia el depósito del banco salvo que exista una integración específica.
- Tener datos fiscales no garantiza un CFDI válido sin timbrado y configuración vigente.
- Un menú QR puede ser sólo informativo; pedido, pago y envío a cocina son capacidades separadas.
- Un tablero en la nube no significa que toda la administración funcione desde navegador.
- La compatibilidad con aplicaciones de entrega, bancos, básculas y otros servicios debe comprobarse para la versión y proveedor exactos.
- La base de datos no reemplaza una política de respaldos, restauración, seguridad y continuidad.
- Los reportes sólo son confiables si los usuarios operan con cuentas propias y no comparten credenciales.

## 18. Recomendaciones de implementación

1. Documentar la versión, edición, número de terminales, complementos y vigencia de cada servicio.
2. Diseñar primero el flujo real del restaurante y después configurar botones, impresoras y permisos.
3. Cargar unidades y equivalencias antes de recetas; probar diez productos representativos de principio a fin.
4. Separar permisos de captura, autorización, corte y ajuste de inventario.
5. Hacer una venta de prueba por cada tipo de servicio y forma de pago.
6. Verificar comandas con modificadores y adiciones en todas las áreas de producción.
7. Simular división, transferencia, descuento, cancelación y devolución.
8. Conciliar un corte completo contra efectivo y vouchers bancarios.
9. Probar factura individual, global y cancelación en un ambiente controlado.
10. Levantar inventario inicial sólo después de depurar unidades, almacenes y recetas.
11. Capacitar por rol con casos reales y un procedimiento de contingencia.
12. Realizar y restaurar un respaldo antes de la salida a producción.

## 19. Lista de verificación para comparar una licencia o demostración

Solicitar al proveedor una respuesta **Incluido / Adicional / No disponible** para cada punto:

- número de terminales y usuarios concurrentes;
- mesas, venta rápida, barra, entrega y recolección;
- dispositivos móviles y cantidad de licencias;
- impresoras por centro de producción;
- KDS y número de pantallas;
- modificadores, combos y promociones;
- listas de precios y programación por horario;
- división, unión y transferencia de cuentas;
- múltiples formas de pago y propinas;
- moneda extranjera y redondeo;
- crédito, puntos o monedero;
- reservaciones y lista de espera;
- insumos, recetas, subrecetas y producción;
- múltiples almacenes, compras y transferencias;
- inventario físico, kardex, mermas y costos;
- facturación CFDI, timbres, factura global y cancelación;
- auto-facturación del cliente;
- integraciones bancarias y de entrega;
- menú QR, pedido web y pago en línea;
- tableros remotos y consolidación de sucursales;
- publicación central de catálogos y precios;
- exportación de reportes e integración contable;
- bitácora detallada y retención de historial;
- respaldos locales/remotos y soporte de restauración;
- actualizaciones, soporte, capacitación y tiempos de atención;
- hardware y versiones de Windows/SQL compatibles;
- costo inicial, mensualidades, timbres, activaciones y renovaciones.

## 20. Fuentes y criterio de validación

Este documento es una **síntesis funcional**, no una ficha contractual de una edición específica. Para validar una compra o implementación deben prevalecer, en este orden:

1. cotización y matriz de funciones firmada para la versión ofrecida;
2. contrato, licencia y términos del servicio;
3. manual y ayuda incluidos con esa versión;
4. demostración usando los flujos reales del establecimiento;
5. portal oficial del producto: [Soft Restaurant](https://softrestaurant.com/);
6. portal del fabricante: [National Soft](https://www.nationalsoft.com.mx/);
7. normativa fiscal vigente: [SAT](https://www.sat.gob.mx/).

Los nombres comerciales, compatibilidades e integraciones pueden cambiar. Las funciones fiscales deben revisarse contra la normativa y proveedor de timbrado vigentes al momento de operar.
