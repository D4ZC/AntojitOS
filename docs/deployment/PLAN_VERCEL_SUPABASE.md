# Plan de despliegue en Vercel y Supabase

Fecha: 21 de octubre de 2026. Estado: propuesta basada en la revisión del repositorio; no se han creado servicios ni desplegado cambios.

## Objetivo y supuestos

Publicar el POS y KDS en Vercel y usar PostgreSQL administrado por Supabase, conservando las reglas de cuentas, caja, cobros, permisos, auditoría e impresión existentes.

La ruta base contempla únicamente Vercel y Supabase como proveedores de nube. Mantiene un agente de impresión en el restaurante. La API conserva NestJS/Fastify y SQL mediante `pg`; no hace falta convertir la aplicación a Next.js ni migrar inmediatamente a Supabase Auth.

Esta ruta supone que la primera versión puede depender de Internet. Es una decisión pendiente de confirmar: el diseño vigente exige operación local sin Internet. Si ese requisito continúa, se debe elegir la variante híbrida descrita abajo antes de mover la autoridad de las ventas a Supabase. La caché de la PWA actual no permite confirmar ventas sin conexión.

## Lo que ya existe

| Componente | Situación actual | Consecuencia para el despliegue |
| --- | --- | --- |
| `apps/pos` | React 19, Vite, PWA; POS y KDS | Publicación estática en Vercel; configurar modo conectado y rutas API. |
| `apps/api` | NestJS/Fastify, REST, permisos y sesiones propias | Conservar contratos `/api/v1/...`; validar empaquetado y ejecución en Vercel. |
| Base de datos | PostgreSQL, `pg`, siete migraciones SQL | Migrar el esquema y los datos necesarios a Supabase sin reescribir el dominio. |
| Eventos | Socket.IO y worker outbox cada 500 ms | Adaptar ciclo de vida, entrega y coordinación entre instancias. |
| `apps/print-agent` | Proceso Node continuo, credenciales en disco, impresora TCP local | Mantenerlo en la sucursal y conectar por HTTPS a la API publicada. |
| Calidad | CI con tipos, pruebas y build | Conservarla y añadir validación contra PostgreSQL real de staging. |

## Arquitectura propuesta

```text
Tablets POS y pantalla KDS
            |
          HTTPS
            |
Vercel: frontend React/Vite
            |
       /api/v1/...
            |
Vercel: API NestJS HTTP
            |
Supabase: PostgreSQL
  - cuentas, ventas y caja
  - sesiones, roles y auditoría
  - cola de impresión y outbox
  - mecanismo durable para tareas/eventos

PC del restaurante: agente de impresión
  - HTTPS saliente hacia la API de Vercel
  - TCP LAN:9100 hacia la impresora local
```

Para aislar configuración y despliegues, comenzar con dos proyectos de Vercel del mismo monorepo: frontend y API. El frontend puede publicar `/api/*` mediante un rewrite al proyecto de API para conservar el contrato de mismo origen. Validar el prefijo `/api`, la protección de previews y el acceso del agente; el proxy de Vite sólo funciona en desarrollo.

La alternativa para reducir cambios iniciales es Vercel para la interfaz, Supabase para PostgreSQL y un servicio persistente para la API y su worker. Conserva más código actual, pero añade un proveedor o runtime de alojamiento. No resuelve por sí sola la operación sin Internet.

Si se exige vender sin Internet, la variante debe conservar API y PostgreSQL autoritativos en la sucursal; Supabase recibiría sincronización y Vercel serviría funciones de administración o consulta. Esa sincronización requiere su propio diseño y pruebas. No permitir escrituras independientes en dos bases de datos para la misma operación.

## Etapa 0: cerrar las decisiones operativas

- Confirmar si la sucursal acepta depender de Internet o conserva la autoridad local.
- Confirmar si el alojamiento debe limitarse a Vercel y Supabase o admite una API persistente adicional.
- Identificar si producción comienza vacía o hay catálogo, cuentas, turnos y ventas reales que migrar.
- Definir dominio, región de API y base de datos, número de terminales y presupuesto operativo.
- Registrar un ADR que actualice la decisión local-first cuando corresponda.

**Criterio de cierre:** una arquitectura elegida, una fuente de verdad para las ventas y un procedimiento de contingencia acordado.

## Etapa 1: preparar Supabase y separar ambientes

1. Crear staging y producción aislados. Los previews no reciben credenciales de producción; usar staging o ramas de base de datos si se habilitan.
2. Revisar las siete migraciones y ejecutarlas primero sobre una base vacía de staging. Mantener inicialmente el registro actual `schema_migrations` para no duplicar historiales de migración.
3. Cerrar el acceso a las tablas antes de incorporar información real. Actualmente las migraciones crean tablas sin RLS, incluidas credenciales, sesiones y caja. Deshabilitar la Data API si no se usa; si se utiliza, delimitar esquemas, privilegios y políticas. Separar explícitamente lo necesario para Realtime.
4. Crear credenciales distintas para migraciones y para la aplicación, con privilegios adecuados. Probar que las credenciales públicas no permiten leer ni modificar datos sensibles.
5. Configurar URL agrupada para la API serverless y conexión directa o de sesión apropiada para migraciones y respaldos. Verificar TLS, conectividad IPv4/IPv6 y presupuesto de conexiones. El pool actual de diez conexiones por instancia debe ajustarse al despliegue.
6. Separar el alta inicial de producción del seed piloto: ese seed contiene PIN predeterminados y puede sobrescribir credenciales al repetirse. No ejecutarlo automáticamente en cada deploy.
7. Definir frecuencia de respaldos, retención, recuperación disponible en el plan contratado y una restauración de ensayo.

**Criterio de cierre:** esquema completo en staging, permisos verificados, conexión segura desde el runtime objetivo y restauración comprobada.

## Etapa 2: probar la API en Vercel y reforzar configuración

1. Realizar una prueba técnica con la API real en un runtime Node compatible con el proyecto. Verificar NestJS/Fastify, decoradores, `@node-rs/argon2`, dependencias del workspace y arranque en frío.
2. Probar salud, alta de una terminal, inicio con PIN y una transacción real de cuenta/cobro contra staging.
3. Separar la inicialización HTTP de los procesos continuos. No depender de `@Interval`, memoria local o trabajo que continúe después de responder para completar una operación durable.
4. Reutilizar la inicialización de la aplicación y el pool cuando lo permita el runtime, sin suponer que las instancias comparten memoria.
5. Ejecutar migraciones mediante un paso de release serializado y con bloqueo; nunca por cada petición ni desde builds de previews sobre producción.
6. Exigir secretos explícitos y rechazar valores de desarrollo y placeholders. La validación actual sólo comprueba longitudes y puede aceptar los valores predeterminados incluso en producción.
7. Restringir registro de terminales/agentes, proteger credenciales de instalación, añadir límites a endpoints públicos y revisar exposición de documentación y mensajes de error. Configurar CORS por ambiente cuando se use acceso entre dominios.
8. Mantener permisos, transacciones, control de versiones e idempotencia en la API. No pasar escrituras de caja y ventas directamente al navegador.

**Criterio de cierre:** API desplegada en staging, login y transacciones correctas, secretos inválidos rechazados y conexiones dentro del límite definido. Si la prueba detecta un impedimento relevante, elegir la API persistente antes de ampliar la migración.

## Etapa 3: resolver eventos y tareas durables

Vercel documenta actualmente WebSockets nativos en beta, incluido Socket.IO. Esto permite evaluar conservar el transporte, pero no demuestra que el gateway Nest/Fastify actual funcione sin ajustes. Las conexiones tienen duración limitada y la reconexión puede llegar a otra instancia; las salas en memoria no coordinan todos los despliegues.

Para la ruta de dos proveedores, evaluar primero Supabase Realtime para los avisos de cambios y un despachador de outbox por lotes, activado mediante Supabase Cron o un mecanismo durable equivalente. Evitar introducir un tercer servicio de coordinación sólo para conservar las salas de Socket.IO.

- Sustituir el intervalo en memoria por reclamación transaccional de eventos, reintentos, recuperación de trabajos interrumpidos y protección frente a ejecuciones concurrentes.
- Mantener la escritura de negocio y el evento en una misma transacción. Un aviso fallido no debe perder una venta ni un trabajo de impresión.
- Si se usa Realtime, implementar y verificar identidad compatible y canales privados por sucursal. Las sesiones opacas actuales no son JWT de Supabase; no conectarlas a canales públicos como atajo.
- Conservar la API como fuente de datos al reconectar. Los avisos sirven para refrescar; no sustituyen la recuperación de estado confirmado.
- Mantener polling como recuperación controlada cuando corresponda. El KDS actual ya consulta cada tres segundos; medir latencia y carga antes de cambiarlo.
- Si se conserva Socket.IO, probar adaptación del gateway, reconexión y distribución de eventos entre instancias. No considerar suficiente una prueba con una sola instancia.

**Criterio de cierre:** dos terminales y KDS reflejan cambios confirmados; una reconexión o el reinicio de una instancia no pierde trabajos. Los eventos no cruzan sucursales y se cumplen los tiempos de actualización operativos definidos.

## Etapa 4: publicar POS/KDS y conectar impresoras

Configuración inicial del proyecto frontend en Vercel, usando la raíz del monorepo:

| Campo | Valor propuesto |
| --- | --- |
| Instalación | `pnpm install --frozen-lockfile` |
| Build | `pnpm --filter @antojit-os/domain build && pnpm --filter @antojit-os/pos build` |
| Directorio de salida | `apps/pos/dist` |
| `VITE_REMOTE_MODE` | `true` |
| `VITE_APP_MODE` | `pos`; KDS disponible con `?mode=kds` o con un build configurado en `kds` |
| `VITE_API_URL` | `/api` con rewrite configurado; alternativamente URL HTTPS de la API con CORS |

- Mantener `DATABASE_URL`, secretos de sesión, bootstrap y claves privadas fuera de `VITE_*`: esas variables quedan visibles en el frontend. Si Realtime necesita URL y clave publicable, añadir únicamente valores diseñados para el cliente.
- Versionar la caché y revisar la estrategia del service worker. Actualmente usa caché fija y HTML cache-first, lo que puede dejar tablets con una versión anterior. Definir actualización segura entre operaciones.
- Mostrar estado de conexión, antigüedad de los datos y expiración de sesión. El KDS no debe aparentar normalidad cuando falla el refresco.
- Conservar la clave de idempotencia para reintentos de una misma acción y ofrecer conciliación del resultado cuando se pierde una respuesta. Actualmente una llamada nueva genera otra clave.
- Registrar nuevamente las terminales al cambiar de dominio, porque sus credenciales locales pertenecen al origen anterior.
- Configurar el agente local con `PRINT_AGENT_API_URL` HTTPS, credenciales propias y arranque automático. No hace falta publicar la impresora en Internet.
- Revisar la frecuencia de polling del agente y añadir espera adaptativa cuando esté inactivo, sin perder la recuperación de trabajos pendientes.
- Probar especialmente el caso en que el papel sale pero falla la confirmación HTTP. Definir recuperación y reimpresión auditada: no prometer impresión física exactamente una vez sólo por tener idempotencia en la API.

**Criterio de cierre:** POS y KDS instalados en las tablets reales, nueva versión visible tras un deploy y tickets/comandas impresos desde la nube mediante el agente local.

## Etapa 5: validar un turno completo en staging

- Ejecutar `pnpm check`, `pnpm test` y `pnpm build`; conservarlos como requisito de CI.
- Probar transacciones y concurrencia sobre PostgreSQL real, además de las pruebas existentes.
- Registrar terminales y validar PIN, roles, expiración y revocación de acceso.
- Abrir caja, capturar desde dos terminales, enviar cocina/barra, dividir o transferir cuentas, cobrar, devolver y cerrar turno.
- Repetir una solicitud con la misma clave y confirmar que no se duplica el movimiento. Simular respuesta perdida antes de reintentar un cobro o una comanda.
- Probar edición simultánea de una cuenta y comprobar rechazo de versiones obsoletas.
- Desconectar Internet antes y después de confirmar una operación; recuperar estado desde la API al volver. En la ruta cloud, no presentar operaciones sin confirmar como ventas realizadas.
- Apagar impresora/agente y recuperar trabajos; ensayar confirmación de impresión perdida.
- Reiniciar o reemplazar instancias de API y validar outbox, sesiones y reconexión.
- Verificar ausencia de acceso público a credenciales, ventas y caja; verificar aislamiento de sucursales cuando existan varias.
- Actualizar la PWA y restaurar un respaldo en un ambiente aislado.
- Medir latencias, errores, conexiones de PostgreSQL, backlog de eventos/impresión y consumo por polling.

**Criterio de cierre:** un turno completo conciliado, sin cobros duplicados, con impresión recuperable y evidencia de restauración.

## Etapa 6: pasar a producción y operar

1. Preparar un release identificado, dominio, variables de producción, alertas y procedimiento de contingencia.
2. Respaldar y definir una ventana de corte si existen datos reales. Detener escrituras en el origen, migrar y conciliar cuentas abiertas, turnos, folios, pagos y trabajos pendientes.
3. Aplicar migraciones una sola vez y publicar API y frontend compatibles.
4. Cambiar terminales y agente al destino elegido, evitando que ambas instalaciones reciban ventas simultáneamente.
5. Ejecutar una comprobación operativa y vigilar el primer turno completo.
6. Definir reversión por componente. Revertir un deploy de Vercel no revierte el esquema ni los cobros: cualquier retorno después de nuevas ventas requiere preservar y conciliar esos movimientos.

**Criterio de cierre:** URL productiva funcionando, terminales y agente registrados, turno conciliado, respaldo verificado y responsable de operación identificado.

## Variables por componente

| Componente | Configuración prevista |
| --- | --- |
| Frontend | `VITE_REMOTE_MODE`, `VITE_API_URL`, `VITE_APP_MODE`; valores públicos adicionales sólo si se integra Realtime. |
| API | `NODE_ENV`, URL agrupada de PostgreSQL, secretos explícitos `BOOTSTRAP_TOKEN` y `SESSION_PEPPER`, TTL de sesión y configuración del runtime. |
| Release/migraciones | Conexión administrativa apropiada, separada del usuario de aplicación; no embebida en el frontend. |
| Tareas/eventos | Credenciales de ejecución privadas y autenticación del despachador; nunca endpoint público sin protección. |
| Agente local | URL HTTPS, ID/token propios, ruta de credenciales, impresora, centros/cajas e intervalo de consulta. |

## Costos y observabilidad

No fijar presupuesto usando sólo el tamaño del frontend. Contemplar plan de Vercel adecuado al uso comercial y al runtime elegido; cómputo, conexiones, respaldos y Realtime de Supabase; dominio y equipo local de impresión.

Con los intervalos actuales y encendido continuo durante 24 horas, un agente inactivo genera aproximadamente 86,400 solicitudes diarias y una pantalla KDS unas 28,800. Son cifras de consultas periódicas, antes de sumar ventas y otras operaciones; medirlas y optimizarlas antes de elegir límites y alertas.

Supervisar disponibilidad de API/base, fallos de autenticación, agotamiento de conexiones, demora del outbox, trabajos sin imprimir y éxito de respaldos. Acordar el máximo aceptable de pérdida de datos y el tiempo de recuperación.

## Orden de trabajo recomendado

1. Resolver autoridad local/nube y alcance de proveedores.
2. Preparar Supabase de staging y corregir secretos/seed.
3. Validar la API real en Vercel con una transacción completa.
4. Adaptar tareas/eventos y reforzar recuperación ante respuestas perdidas.
5. Publicar POS/KDS y conectar el agente local.
6. Ensayar turno completo, fallos y restauración.
7. Migrar producción y acompañar el primer turno.

No hace falta comenzar por una reescritura del frontend ni por sustituir toda la autenticación. La primera entrega técnica debe demostrar API, base y cobro en staging antes de ampliar el despliegue.

## Referencias

Documentación oficial consultada el 21 de octubre de 2026. Verificar de nuevo capacidades en beta y condiciones del plan al implementar:

- [Vercel: WebSockets, Socket.IO, reconexión y estado compartido](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections).
- [Vercel: NestJS](https://vercel.com/docs/frameworks/backend/nestjs).
- [Vercel: ciclo de vida y `waitUntil`](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package).
- [Vercel: administración de cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
- [Supabase: conexiones PostgreSQL y poolers](https://supabase.com/docs/guides/database/connecting-to-postgres).
- [Supabase: endurecimiento de la Data API](https://supabase.com/docs/guides/database/hardening-data-api).
- [Supabase: autorización de Realtime](https://supabase.com/docs/guides/realtime/authorization).
- [Supabase: Cron](https://supabase.com/docs/guides/cron).

Código y decisiones revisados: `apps/api/src/config/app-config.service.ts`, `apps/api/src/database`, `apps/api/migrations`, `apps/api/src/auth`, `apps/api/src/events`, `apps/api/src/outbox`, `apps/pos/src/api/pos-api.ts`, `apps/pos/src/KdsApp.tsx`, `apps/pos/public/sw.js`, `apps/print-agent/src` y `docs/architecture/ADR-0001-local-first.md`.
