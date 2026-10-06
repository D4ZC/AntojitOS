# Plan de implementación de AntojitOS

**Base funcional:** `SOFT_RESTAURANT_FUNCIONALIDADES.md`  
**Objetivo:** construir una plataforma web local-first para restaurantes, con una PC/servidor principal, terminales de venta, cajas, comandas móviles, estaciones de producción y administración, sin depender de Internet para la operación diaria.

## 1. Decisión recomendada

AntojitOS no debe diseñarse como un SaaS que necesite Internet para vender. Cada establecimiento tendrá un **servidor local autoritativo** conectado a la red del restaurante. Las terminales accederán por navegador o PWA y compartirán en tiempo real mesas, órdenes, turnos, pagos e inventario.

- Si se cae Internet, la venta local, cocina, caja e impresión continúan.
- Si se cae una terminal, se puede continuar desde otra terminal autorizada.
- Si se cae la PC/servidor principal, no es seguro permitir ventas independientes en varias terminales porque se crearían conflictos de cuentas, folios y pagos. La primera versión lo resolverá mediante servidor dedicado, UPS, respaldo y procedimiento de recuperación; un modo de contingencia distribuido se evaluará después.
- CFDI, respaldo remoto, pedidos externos y sincronización con nube usarán una cola transaccional y se reintentarán al recuperar Internet.
- La nube será complementaria para consulta remota y multisucursal, no un requisito para operar una sucursal.

### Topología

```text
                         Internet (opcional)
                                 |
                +----------------+----------------+
                | CFDI/PAC, nube, delivery, correo |
                +----------------+----------------+
                                 |
                      cola de sincronización
                                 |
+----------------------- Red local del restaurante -----------------------+
|                                                                        |
|  +--------------------+       HTTPS / WebSocket                        |
|  | Servidor principal |<-----------------------+                       |
|  | API + PostgreSQL   |                        |                       |
|  | jobs + respaldos   |             +----------+-----------+           |
|  +----------+---------+             |          |           |           |
|             |                       POS       Admin     Comanda móvil   |
|             |                                                        |
|      trabajos de impresión            +-------------------------+      |
|             +------------------------>| KDS cocina / barra       |      |
|             |                         +-------------------------+      |
|     +-------+----------------+                                           |
|     | agente(s) de hardware  |--> impresoras, cajón, báscula, visor     |
|     +------------------------+                                           |
+--------------------------------------------------------------------------+
```

## 2. Stack recomendado

### Aplicación

| Capa | Tecnología | Motivo |
|---|---|---|
| Monorepo | TypeScript, pnpm y Turborepo | Tipos, contratos y herramientas compartidas entre aplicaciones. |
| POS, administración y KDS | React + Vite + PWA | Inicio rápido, interfaz táctil, caché de la aplicación y despliegue sencillo en LAN. |
| Diseño de interfaz | Tailwind CSS + Radix UI | Componentes accesibles y una interfaz consistente sin atarse a un tema rígido. |
| Estado del servidor | TanStack Query | Caché, invalidación y reintentos controlados; el servidor sigue siendo la fuente de verdad. |
| Estado local | Zustand | Estado efímero de interfaz, sin duplicar las reglas de negocio. |
| API | NestJS sobre Fastify, REST/OpenAPI | Módulos claros, validación, documentación y buen soporte para una aplicación de negocio grande. |
| Tiempo real | WebSocket/Socket.IO | Actualización inmediata de mesas, cuentas, comandas y KDS. |
| Base de datos | PostgreSQL | Transacciones, bloqueos, restricciones e integridad adecuadas para caja e inventario. |
| Acceso a datos | Drizzle ORM + SQL explícito en flujos críticos | Migraciones tipadas sin ocultar las transacciones y bloqueos importantes. |
| Tareas y reintentos | Cola basada en PostgreSQL (`pg-boss` o equivalente) | Impresión, CFDI y sincronización durables sin agregar Redis en la primera versión. |
| Agente de hardware | Servicio pequeño en Go | Ejecutable estable para Windows/Linux, impresión ESC/POS y acceso a USB/serial/LAN. |
| Archivos | Disco local administrado + respaldo cifrado | XML, PDF, logotipos y exportaciones; metadatos y hashes quedan en PostgreSQL. |

### Requisitos táctiles para las dos mini tablets Windows

- Instalar la PWA en Microsoft Edge y ejecutarla en modo aplicación o pantalla completa, sin barras del navegador durante el servicio.
- Diseñar primero para uso con dedo: objetivos táctiles de al menos 44–48 px, separación suficiente, contraste alto y estados presionado/deshabilitado claramente visibles.
- No depender de `hover`, clic derecho, atajos de teclado ni controles pequeños propios de escritorio.
- Usar teclados numéricos y selectores dentro de AntojitOS para cantidades, importes, PIN y comensales; invocar el teclado de Windows sólo para texto libre.
- Optimizar el POS para orientación horizontal y soportar vertical cuando la resolución lo permita; las ventanas no usarán diálogos que queden fuera del área visible al aparecer el teclado virtual.
- Evitar selecciones accidentales, zoom por doble toque y envíos repetidos; las acciones sensibles tendrán bloqueo visual e idempotencia en el servidor.
- Mantener siempre visibles las acciones primarias de la orden y reducir desplazamientos durante la captura.
- Validar el diseño en la resolución, escala de Windows y tamaño físico exactos de ambas tablets, no sólo con la emulación del navegador.
- Permitir teclado, lector o mouse opcionales sin crear una experiencia distinta.

### Calidad y operación

- Vitest y Testing Library para unidades y componentes.
- Pruebas de integración contra PostgreSQL real para dinero, caja, inventario y concurrencia.
- Playwright para recorridos completos por rol.
- Simuladores de impresora, PAC, terminal bancaria y canal externo.
- OpenTelemetry, logs estructurados y panel local de salud.
- Docker Compose para desarrollo y para el servidor Linux del piloto.
- Instalador y servicios del sistema para producción; no depender de Docker Desktop como runtime definitivo en Windows.
- CI con lint, tipos, migraciones, pruebas, análisis de dependencias y creación de artefactos firmados.

### Hardware recomendado para el primer piloto

- Servidor local dedicado o mini-PC con Linux LTS, SSD en espejo si el presupuesto lo permite, red Ethernet y UPS.
- Dos mini tablets Windows touch como terminales POS, con PWA instalada y terminal registrada individualmente.
- Router/switch administrable y puntos Wi-Fi separados para operación e invitados.
- Impresoras de producción preferentemente Ethernet; USB sólo mediante un agente cercano.
- Para las tablets, Wi-Fi operativo con cobertura medida; usar adaptador/dock Ethernet si permanecerán fijas y el modelo lo permite.
- Respaldo automático en un segundo dispositivo local y, cuando haya Internet, copia remota cifrada.

La PC administrativa puede seguir funcionando como “principal” desde la perspectiva del usuario, pero es más confiable que los servicios vivan en un equipo dedicado. Si el requisito es usar una PC Windows existente, se preparará un perfil de instalación compatible como servicio de Windows.

## 3. Principios técnicos no negociables

1. **Una sola autoridad local por sucursal.** Las terminales nunca acceden directamente a PostgreSQL.
2. **Operaciones idempotentes.** Cobrar, enviar a cocina, cancelar, imprimir y sincronizar aceptan una clave única para no duplicarse por doble toque o reintento.
3. **Transacción + outbox.** La venta y el evento que dispara impresión, inventario o nube se confirman juntos.
4. **Sin borrado de historia.** Pagos, cancelaciones, movimientos de caja e inventario se corrigen con movimientos compensatorios.
5. **Datos históricos inmutables.** Cada venta guarda instantáneas de descripción, precio, impuesto, costo/receta aplicable y autorizaciones; cambiar el catálogo no reescribe el pasado.
6. **Concurrencia explícita.** Las cuentas tendrán versión; transferencias, divisiones, pagos y cierre validarán que otro usuario no haya cambiado la cuenta.
7. **Dinero y cantidades exactas.** Importes en centavos o `numeric`, nunca punto flotante; unidades y conversiones con precisión definida.
8. **Máquinas de estado.** Orden, comanda, turno, pago, CFDI e inventario sólo aceptan transiciones válidas.
9. **Auditoría desde el inicio.** Usuario operador, autorizador, terminal, fecha, motivo y valores antes/después en toda acción sensible.
10. **Fiscalidad desacoplada.** El conector PAC y las reglas CFDI serán módulos versionados, no lógica mezclada con el cobro.

## 4. Alcance por versión

### 4.1 MVP de piloto: operación esencial

El MVP debe probar el ciclo completo del pedido al corte en un restaurante real:

- empresa, sucursal, terminales, cajas y centros de producción;
- usuarios individuales, roles, PIN y autorización de supervisor;
- salones, mesas, venta rápida, comedor y para llevar;
- familias, productos, impuestos, listas básicas de precios, modificadores y notas;
- apertura de turno y fondo inicial;
- abrir cuenta, capturar, enviar rondas y recibir adiciones;
- impresión de comanda por cocina/bar con estado, reintento y reimpresión auditada;
- precuenta, cambio de mesa/responsable, división, unión y transferencia de artículos;
- descuentos, cortesías y cancelaciones con permiso y motivo;
- efectivo, tarjeta, transferencia, pagos combinados, cambio y propina;
- ticket y folios locales;
- movimientos de caja, corte preliminar y cierre con declarado contra teórico;
- bitácora y reportes básicos de ventas, formas de pago, usuarios y excepciones;
- respaldos, restauración probada, monitoreo y contingencias.

**Fuera del MVP del piloto:** CFDI productivo, inventario completo, compras, lealtad, delivery, pago bancario integrado, multisucursal y administración central. Se pueden simular interfaces para no bloquear el diseño posterior.

### 4.2 Versión 1 comercial

Agrega lo necesario para una puesta en producción más amplia:

- insumos, unidades, equivalencias, almacenes, recetas y subrecetas;
- consumo teórico, kardex, compras/entradas, transferencias, mermas, ajustes e inventario físico;
- KDS con recibido, preparación, listo y despacho;
- clientes y datos fiscales;
- CFDI individual, global, cancelación, XML/PDF y conexión con un PAC;
- exportaciones y reportes operativos completos;
- actualización segura, diagnóstico y soporte remoto autorizado;
- respaldo remoto cifrado y prueba automatizada de recuperabilidad.

### 4.3 Expansiones posteriores

- comanda móvil avanzada y modo instalable;
- pedidos QR, recolección y entrega propia;
- agregadores y conciliación de comisiones/depósitos;
- terminal bancaria integrada;
- lealtad, monedero, crédito y reservaciones;
- promociones avanzadas, combos y horarios;
- nube de indicadores y administración multisucursal;
- publicación central de catálogos/precios con aprobación local;
- alta disponibilidad o servidor local de reemplazo.

## 5. Módulos y límites de dominio

1. **Identidad y acceso:** usuarios, roles, sesiones, PIN, autorizaciones y terminal registrada.
2. **Configuración:** empresa, sucursal, impuestos, folios, parámetros y formatos.
3. **Catálogo:** familias, productos, precios, modificadores, combos y disponibilidad.
4. **Servicio:** salones, mesas, cuentas, comensales, rondas, transferencias y divisiones.
5. **Producción:** centros, comandas, KDS, tiempos y enrutamiento.
6. **Ventas y pagos:** totales, impuestos, descuentos, propina, pagos, tickets y devoluciones.
7. **Caja:** turnos, fondos, retiros, gastos, cortes y diferencias.
8. **Inventario:** insumos, recetas, compras, almacenes y libro de movimientos.
9. **Fiscal:** clientes fiscales, CFDI y PAC.
10. **Reportes:** proyecciones optimizadas a partir de las transacciones, sin alterar su fuente.
11. **Integraciones:** impresión, hardware, nube, delivery, pagos y notificaciones.
12. **Auditoría:** registro transversal, consulta y retención.

Se comenzará como un **monolito modular**, no como microservicios. Esto simplifica transacciones, instalación local, respaldos y soporte. Los workers de impresión, fiscal y sincronización podrán ejecutarse como procesos separados con los mismos módulos y contratos. Sólo se extraerá un servicio cuando exista una necesidad operativa demostrada.

## 6. Modelo transaccional mínimo

Las entidades centrales serán:

- `organization`, `site`, `terminal`, `register`, `production_center`, `printer`;
- `user`, `role`, `permission`, `session`, `supervisor_authorization`;
- `dining_area`, `table`, `service_account`, `guest`;
- `category`, `product`, `price_list`, `modifier_group`, `modifier`, `tax_rule`;
- `order`, `order_round`, `order_item`, `item_modifier`, `kitchen_ticket`;
- `payment`, `payment_allocation`, `tip`, `receipt`, `refund`;
- `cash_shift`, `cash_movement`, `cash_declaration`, `cash_close`;
- `ingredient`, `unit`, `conversion`, `recipe`, `warehouse`, `stock_ledger`;
- `customer`, `fiscal_profile`, `fiscal_document`;
- `print_job`, `integration_job`, `outbox_event`, `audit_event`.

Pagos, caja e inventario serán libros de movimientos. Los saldos se calculan/proyectan desde esos libros y se validan dentro de la misma transacción.

## 7. Plan de ejecución

Las duraciones asumen un equipo estable de 4 a 6 personas: responsable de producto con experiencia restaurantera, líder técnico/backend, frontend, QA/automatización y apoyo parcial de UX/infraestructura/hardware.

### Fase 0 — Descubrimiento y especificación operativa (2 semanas)

- Seleccionar un restaurante piloto y observar apertura, hora pico, cierre y contingencias.
- Definir tipos de servicio, terminales, periféricos, formas de pago e impuestos.
- Convertir el análisis funcional en recorridos, reglas, estados y criterios de aceptación.
- Priorizar MVP, v1 y posteriores; crear glosario y matriz de permisos.
- Levantar modelos exactos de impresoras/cajones/básculas y topología de red.
- Registrar modelo, resolución, escala de Windows, orientación y navegador de las dos mini tablets.
- Hacer y validar en esas tablets los prototipos táctiles de venta, mapa de mesas, cobro y KDS.

**Salida:** alcance firmado, mapa operativo, prototipo validado y casos de prueba de negocio.

### Fase 1 — Fundaciones técnicas (3 semanas)

- Monorepo, entornos, CI, convenciones y arquitectura modular.
- PostgreSQL, migraciones, datos iniciales y estrategia de actualización.
- identidad, roles, terminales, sesiones y auditoría base;
- API/OpenAPI, WebSocket, idempotencia, outbox y worker;
- PWA, sistema de diseño, manejo de errores y diagnóstico;
- respaldo/restauración y observabilidad desde el primer incremento.

**Salida:** una terminal registrada inicia sesión, modifica un dato autorizado, otra terminal lo recibe en tiempo real y toda acción queda auditada.

### Fase 2 — Catálogo, mesas y toma de orden (4 semanas)

- Configuración de sucursal, áreas, mesas y centros de producción.
- Catálogo, precios, impuestos, modificadores y disponibilidad.
- Venta de mesa, rápida y para llevar.
- Rondas, notas, cambios antes/después de comandar y estados concurrentes.
- Primer simulador de cocina y pruebas de doble toque/concurrencia.

**Salida:** orden completa capturada desde dos terminales sin perder ni duplicar productos.

### Fase 3 — Producción e impresión confiable (3 semanas)

- Enrutamiento por producto/familia/centro.
- Agente de hardware y adaptadores ESC/POS de los modelos del piloto.
- Cola durable, confirmación, reintento, cambio de impresora y reimpresión autorizada.
- Comandas diferenciadas para alta, adición y cancelación.
- KDS inicial y avisos de antigüedad.

**Salida:** todas las pruebas de corte de red, impresora apagada y reintento preservan exactamente una intención de producción y dejan trazabilidad.

### Fase 4 — Cobro, caja y auditoría del MVP (4 semanas)

- Precuenta, división, unión, transferencias y cambio de responsable.
- Motor de totales, descuentos, cortesías e impuestos.
- Pagos combinados, propina, cambio, cancelación/devolución y ticket.
- Turnos, movimientos, declarado contra teórico y cierre.
- Reportes esenciales y revisión de excepciones.
- Endurecimiento de permisos y pruebas de concurrencia de cobro.

**Salida:** ciclo del pedido al corte conciliado; no es posible cobrar dos veces, alterar una venta cerrada ni ocultar una excepción.

### Fase 5 — Piloto controlado y estabilización (3 a 4 semanas)

- Instalación paralela sin sustituir de inmediato el sistema existente.
- Capacitación por rol y manual de contingencia.
- Ensayo con turnos completos y luego operación limitada en vivo.
- Medición de latencia, impresión, errores, diferencias de caja y usabilidad.
- Restauración real de un respaldo en un equipo limpio.
- Corrección de defectos y decisión formal de salida.

**Salida:** MVP aceptado con evidencia de operación en hora pico y plan de reversión.

### Fase 6 — Inventario y costos (6 a 8 semanas)

- Unidades, conversiones, insumos, recetas y subrecetas versionadas.
- Almacenes, compras/entradas, transferencias, mermas y ajustes.
- Consumo teórico transaccional y recalculo controlado.
- Inventario físico, diferencias, kardex, costo y margen.
- Pruebas de redondeo, rendimientos y reversión de ventas.

**Salida:** diez productos representativos cuadran desde compra hasta venta, cancelación, receta y conteo físico.

### Fase 7 — Fiscal, reportes y versión 1 (5 a 7 semanas)

- Adaptador de PAC en ambiente de pruebas y manejo seguro de credenciales.
- CFDI individual/global/cancelación, relación con ticket y archivos.
- Cola offline, reintentos e interfaz para resolver rechazos.
- Reportes ampliados, exportación y políticas de retención.
- Instalador, actualización con reversión y soporte de producción.
- Revisión legal, privacidad, seguridad y pruebas de penetración enfocadas.

**Salida:** versión 1 con certificación funcional/fiscal del proveedor elegido y corrida de cierre completa.

### Horizonte estimado

- **MVP listo para piloto:** 16 a 20 semanas.
- **Versión 1 con inventario y CFDI:** 27 a 35 semanas.
- **Paridad amplia con el mapa funcional:** 9 a 15 meses, según integraciones, hardware y número de personas.

No conviene comprometer una fecha definitiva hasta cerrar la Fase 0 y probar el hardware real.

## 8. Estrategia de pruebas y aceptación

Además de pruebas técnicas, se mantendrá una batería de escenarios de negocio:

- dos meseros agregan productos a la misma cuenta;
- una terminal reintenta el envío al perder Wi-Fi;
- captura completa con dedo en ambas tablets, incluyendo teclado virtual, rotación y escala de Windows;
- doble toque involuntario sobre agregar, enviar a cocina y cobrar sin duplicar operaciones;
- una impresora se apaga después de recibir o antes de confirmar;
- se transfiere y divide una cuenta con artículos ya comandados;
- dos cajas intentan cobrar la misma cuenta;
- pago mixto con cambio y propina;
- cancelación después de preparar y movimiento de merma;
- cierre con faltante/sobrante y formas de pago no conciliadas;
- cambio de precio/receta después de una venta histórica;
- pérdida de Internet durante timbrado;
- respaldo y restauración con ventas, XML y configuración;
- migración de una versión anterior de la base de datos.

Cada fase exige pruebas de roles, auditoría, concurrencia, accesibilidad táctil, tiempos de respuesta y recuperación, no sólo el “camino feliz”.

## 9. Seguridad y continuidad

- Contraseñas con Argon2id; PIN separado y limitado por intentos.
- Sesiones cortas en terminales compartidas y bloqueo rápido por cambio de operador.
- Registro previo de cada terminal y permisos por dispositivo.
- TLS dentro de LAN mediante certificado administrado por la instalación.
- Cifrado de secretos y copias remotas; credenciales del PAC nunca en el navegador.
- Mínimo privilegio, permisos por acción y doble identidad operador/autorizador.
- Bitácora protegida contra edición desde la aplicación.
- Copia frecuente, retención definida y restauración ensayada.
- UPS, apagado ordenado, comprobación al arrancar y panel de estado.
- Actualizaciones firmadas, migraciones compatibles y reversión documentada.
- Política de privacidad para clientes y datos fiscales.

## 10. Riesgos principales

| Riesgo | Tratamiento |
|---|---|
| Alcance de “igual a Soft Restaurant” sin prioridad | MVP y v1 explícitos, matriz de cobertura y control de cambios. |
| Impresión duplicada o perdida | Outbox, identificador de trabajo, confirmación del agente, reintento y auditoría. |
| Cobros duplicados por concurrencia | Bloqueo/versionado de cuenta, idempotencia y restricciones de base de datos. |
| Inventario incorrecto | Versionado de recetas, unidades estrictas, libro de movimientos y pruebas representativas. |
| Falla de la PC principal | Servidor dedicado, UPS, respaldo probado, equipo de reemplazo y procedimiento manual. |
| Hardware heterogéneo | Matriz de modelos certificados; adaptadores por dispositivo, no promesa genérica. |
| Cambios del SAT/PAC | Módulo fiscal desacoplado, ambiente de pruebas y responsable de actualización normativa. |
| Red Wi-Fi deficiente | Estudio de cobertura, Ethernet para puntos fijos y red operativa separada. |
| Complejidad prematura de nube/microservicios | Monolito modular local y extracción sólo por evidencia. |
| Replicar propiedad intelectual ajena | Reproducir capacidades y flujos propios, sin copiar código, interfaz, recursos o marcas de terceros. |

## 11. Decisiones que deben confirmarse antes de implementar

1. Tipo de restaurante piloto y flujo prioritario: mesas, comida rápida, bar, reparto o combinación.
2. Además de las dos terminales POS ya definidas: comandas móviles, KDS, impresoras, cajas, usuarios concurrentes y sucursales.
3. Modelo, tamaño, resolución, orientación y escala configurada de las dos mini tablets Windows touch.
4. Sistema operativo y si habrá servidor dedicado o debe usarse una PC Windows existente.
5. Modelos exactos de impresoras, cajones, básculas, lectores, visores y terminal bancaria.
6. Si el primer go-live requiere inventario completo y CFDI, o si pueden seguir al MVP operativo.
7. PAC de facturación, banco/adquirente, agregadores e integraciones contables requeridas.
8. Reglas reales de precios, impuestos, propinas, descuentos, cancelaciones y cortes del negocio piloto.
9. Equipo disponible, presupuesto y fecha objetivo, para ajustar el alcance sin degradar controles críticos.

## 12. Primer entregable después de aprobar el plan

El primer sprint no debe empezar escribiendo pantallas aisladas. Debe producir:

- `VISION_Y_ALCANCE.md` con MVP aprobado;
- recorridos operativos y criterios de aceptación;
- modelo de estados de cuenta, comanda, turno y pago;
- matriz de roles/permisos;
- modelo de datos inicial y decisiones de arquitectura (ADR);
- prototipo navegable del POS, mapa de mesas, cobro y KDS;
- prueba técnica de WebSocket, transacción/outbox e impresión en el hardware del piloto;
- backlog ordenado por dependencias y riesgo.

Con esa base se puede estimar con mayor precisión y comenzar la implementación sin comprometer la integridad de caja, producción o inventario.
