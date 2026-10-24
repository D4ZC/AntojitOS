# Instalación y operación en Windows

La entrada para todas las operaciones es **`final_script.cmd`**, en la raíz del proyecto. Abrirlo con doble clic para instalar, iniciar, configurar el arranque, actualizar o consultar registros. La ventana muestra el resultado y permanece abierta hasta presionar una tecla, incluso si falla un comando.

Conservar **la carpeta completa del proyecto**: `final_script.cmd`, `final_script.ps1`, `scripts/`, `apps/`, `packages/` y los demás archivos de construcción. Copiar solamente el lanzador no instala la aplicación. Los archivos de `scripts/windows/` son auxiliares internos; el usuario realiza todas las operaciones mediante `final_script`.

| Opción del menú | Acción |
| --- | --- |
| **1. Instalar / completar configuración** | Instala dependencias, configura la aplicación, prepara los datos nuevos, registra el arranque automático e inicia el servicio. |
| **2. Iniciar la aplicación instalada** | Inicia las imágenes y los datos existentes. |
| **3. Configurar / reparar el arranque automático** | Selecciona inicio al encender o al entrar al escritorio y registra la tarea. |
| **4. Actualizar aplicación** | Desde un proyecto extraído, aplica esa carpeta a la instalación existente después de confirmar el mantenimiento. También conserva el flujo Git explícito. |
| **5. Abrir la carpeta de logs** | Abre la carpeta que contiene los registros de las ejecuciones. |
| **0. Salir** | Termina sin ejecutar una operación. |

## Preparar la computadora

Usar **Windows 10 22H2 de escritorio x64 (compilación 19045 o posterior)** o **Windows 11 de escritorio x64**, actualizado, con una cuenta administradora y conexión a Internet para instalar y actualizar. No se admiten Windows de 32 bits, ARM64 ni Windows Server. Windows PowerShell 5.1 de 64 bits, incluido en Windows, es suficiente. El instalador descarga los instaladores oficiales y comprueba sus firmas y hashes; no depende de `winget`.

En la computadora con Windows 10, presionar `Win + R`, escribir `winver` y comprobar que indica **22H2** y **19045** o una compilación posterior. Si tiene una versión anterior, actualizar Windows 10 antes de instalar; no hace falta cambiar a Windows 11. Usar **el mismo `final_script.cmd` y la carpeta completa del proyecto** en cualquiera de los dos sistemas.

La virtualización debe estar habilitada en BIOS/UEFI (Intel VT-x o AMD-V). Se puede consultar en **Administrador de tareas > Rendimiento > CPU > Virtualización**. WSL2 necesita esa función incluso en Windows 10 Home; no se requiere cambiar a la edición Pro.

Se recomiendan 16 GB de RAM y SSD con al menos 30–50 GB libres. Son referencias prácticas; todavía no se han medido mínimos de hardware del proyecto. Conviene reservar una IP para la PC en el router, utilizar una red de confianza y proteger su alimentación con un UPS.

El destino predeterminado es `C:\Program Files\AntojitOS`. El código queda protegido para que modificarlo requiera permisos de administrador. Conservar esa ubicación fija, fuera de carpetas temporales y de carpetas sincronizadas.

`final_script` solicita elevación cuando es necesaria. Usar siempre la **misma cuenta administradora de Windows**: esa cuenta es propietaria de la máquina WSL/Podman y de los datos. Si la elevación cambia de cuenta, el proceso se detiene. Otra cuenta o `SYSTEM` no dan acceso a la misma instalación.

El instalador prepara Node.js 24, Git, Podman, el proveedor Compose y WSL2 cuando faltan. En Windows 10 descarga **Podman 5.8.9**, de la rama compatible con ese sistema; en Windows 11 puede descargar la versión estable actual. **Podman 6 requiere Windows 11**. WSL2 debe usar un runtime actualizado, además de las características opcionales de Windows. PostgreSQL 17, la API y la interfaz se ejecutan en contenedores. El agente de impresión usa un contenedor para Ethernet o simulación, y se ejecuta directamente en Windows para acceder a una impresora USB. No es necesario instalar PostgreSQL manualmente.

La guía oficial de [Podman 5.8.9 para Windows](https://github.com/podman-container-tools/podman/blob/v5.8.9/docs/tutorials/podman-for-windows.md#prerequisites) contempla Windows 10 y Windows 11 con WSL2. El mínimo de Windows 10 del instalador de AntojitOS es 22H2, aunque esa guía permita versiones anteriores.

## 1. Instalar y configurar

Extraer el ZIP o copiar el proyecto completo en una carpeta de preparación, abrir `final_script.cmd` y elegir **1**. Esta opción incluye la configuración y el arranque automático; no es necesario ejecutar otro instalador después.

El programa se copia a `C:\Program Files\AntojitOS`. Se excluyen los archivos `.env` reales, `var/`, `backups/`, `node_modules/` y `dist/` del origen: esta copia instala el programa; no migra la configuración ni la base de otra computadora. Si el origen es un repositorio Git limpio con un directorio `.git` real, conserva su historial. Si proviene de ZIP, de un worktree o incluye cambios locales, prepara una instantánea local con los archivos copiados, sin modificar la carpeta original.

Si WSL2 necesita reiniciar Windows, se muestra el código **3010**. Reiniciar y volver a abrir `final_script.cmd`, opción **1**, con los mismos parámetros si se usaron desde la consola. La PC no se reinicia automáticamente.

La configuración inicial y los códigos se generan una vez en `.env.pilot`. **Los PIN, tokens y contraseñas se ocultan en la pantalla y en los registros.** Para consultar los códigos iniciales, cerrar la consola del instalador y abrir de forma privada `C:\Program Files\AntojitOS\.env.pilot` en un editor local. Guardarlos en un lugar seguro; no copiar ese archivo al reporte de diagnóstico ni a GitHub.

En una instalación existente se conservan la configuración y los datos. Si se pierde `.env.pilot`, es necesario recuperarlo de un respaldo. La carga inicial del restaurante se realiza únicamente cuando la base todavía no contiene una sucursal. Una instalación completada reutiliza sus imágenes y no vuelve a crear la máquina ni a inicializar la base.

El instalador comprueba las máquinas de Podman antes de crear una. Reutiliza `antojitos-pilot` si existe; en otro caso elige la única máquina WSL encendida, la predeterminada o la única disponible, en ese orden. Si hay varias sin una selección clara, muestra sus nombres para que se establezca una como predeterminada en Podman. Si no hay ninguna compatible, crea `antojitos-pilot`.

La máquina seleccionada queda guardada en `var/windows/installation.json`. Si ya está encendida se usa directamente; si está detenida se inicia. Los siguientes arranques y actualizaciones conservan esa selección, aunque cambie la máquina predeterminada de Podman. Se utiliza almacenamiento **rootless**: mantener el nombre y la conexión guardados, porque otra máquina o el modo rootful tienen almacenamiento distinto.

Una máquina creada manualmente no implica que exista una instalación anterior de AntojitOS. El instalador permite reutilizarla si está vacía o contiene otros proyectos. Si detecta volúmenes o contenedores de AntojitOS y falta `.env.pilot`, solicita recuperar esa configuración antes de generar credenciales nuevas. La instalación conserva un `.env.pilot` que ya exista.

### Usar parámetros desde PowerShell

Abrir una consola en la raíz de la carpeta completa del proyecto:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\final_script.ps1 -Action Install
```

Para escoger una carpeta dentro de `Program Files`, los puertos y una impresora ESC/POS por red:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\final_script.ps1 -Action Install -InstallPath "C:\Program Files\AntojitOS" -HttpPort 8080 -InternalHttpPort 18080 -PrinterHost 192.168.1.50 -PrinterPort 9100
```

Reemplazar la IP por la real. Para una impresora USB ya instalada en Windows, utilizar `-PrinterQueue "BIXOLON SRP-F310"` con su nombre real, en lugar de los parámetros de red. Se prepara el agente nativo para que el arranque de AntojitOS lo inicie automáticamente. Si no se indica impresora, una instalación nueva usa el simulador. El modelo, los caracteres, el papel y el corte requieren una prueba física.

La ubicación y su propietario se registran en `%ProgramData%\AntojitOS\installation-location.json`. Inicio y actualización consultan ese registro cuando se omite `-InstallPath`, incluso si el lanzador se ejecuta desde la carpeta de preparación. Si ya hay una instalación con otra ruta o propietario, revisar la anterior antes de crear otra que comparta máquina y servicios.

En una instalación nueva se puede abrir `C:\Program Files\AntojitOS\final_script.cmd`. Para los siguientes ejemplos de consola, usar como directorio actual esa carpeta o la carpeta completa del proyecto de preparación.

Al reparar una instalación anterior con auxiliares ausentes o distintos, la opción **1** prepara un lanzador protegido en `%ProgramData%\AntojitOS\launcher` y registra su ruta en `installation.LauncherPath`. Así conserva el árbol Git de la aplicación, `.env.pilot` y los datos. Esa copia auxiliar sirve al arranque automático; para instalar o reparar se sigue usando el proyecto completo. La actualización desde carpeta también renueva los auxiliares de ese lanzador al completar el despliegue y conserva la referencia que usa la tarea de arranque.

### Instalaciones desde ZIP y Git

Se puede instalar desde una copia o ZIP sin proporcionar una URL. El instalador crea un repositorio local con la rama `antojitos-local-installation` y registra el origen como `snapshot`. Esa rama conserva una referencia de los archivos instalados.

Para actualizar esa instalación basta descargar un ZIP nuevo, extraerlo y ejecutar el procedimiento de la sección **3**. No es necesario configurar Git ni proporcionar una URL en la PC de caja. Se conserva cualquier directorio `.git` existente, pero la actualización por carpeta no ejecuta `fetch`, `merge` ni cambia su historia. Las siguientes actualizaciones de una instalación actualizada por carpeta deben utilizar también una carpeta nueva del proyecto.

El flujo Git sigue disponible para instalaciones que lo utilizan y aún no se han actualizado por carpeta. Con `-Action Update -RepositoryUrl ...`, la primera actualización de una instantánea adopta la rama de GitHub conservando la rama local inicial y los datos. Después se aceptan únicamente avances `fast-forward` de la rama adoptada. No se toma automáticamente la URL del remoto `origin`.

Si se conoce la URL durante la instalación, también se pueden usar `-RepositoryUrl` y `-Branch` con `-Action Install`. Se admiten URLs HTTPS de GitHub y SSH con formato `git@github.com:propietario/repositorio.git`. Un repositorio privado requiere autenticación de Git configurada en la cuenta propietaria; no escribir tokens ni credenciales dentro de la URL.

## 2. Arranque automático y arranque manual

Durante la instalación se elige el modo de arranque:

- **Startup:** inicia al encender Windows, antes de iniciar sesión. Solicita la contraseña real de la misma cuenta propietaria; el PIN de Windows Hello no sirve. La contraseña se entrega al Programador de tareas y no se guarda en los archivos de AntojitOS.
- **Logon:** inicia cuando esa cuenta entra al escritorio. No requiere registrar una contraseña y la aplicación estará disponible después de iniciar sesión.

La opción **3** configura o repara la tarea. Usarla también después de cambiar la contraseña de Windows. Desde PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\final_script.ps1 -Action AutoStart -AutoStartMode Startup -ForceRegister
```

Para elegir el inicio al entrar al escritorio:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\final_script.ps1 -Action AutoStart -AutoStartMode Logon
```

También se puede agregar `-AutoStartMode Logon` a `-Action Install`. Las tareas anteriores compatibles se pueden migrar al mismo lanzador conservando sus credenciales. La tarea nueva ejecuta `final_script.ps1 -Action Start -Unattended` desde la instalación o desde el lanzador protegido registrado al reparar una versión anterior; ese modo no presenta preguntas ni pausas y sólo admite iniciar la aplicación.

Para iniciar manualmente, elegir **2** o ejecutar:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\final_script.ps1 -Action Start
```

El arranque diario utiliza las imágenes y los datos instalados. Espera a Podman y comprueba también la conexión del proveedor Compose al canal local de la máquina seleccionada antes de iniciar los servicios. Si esa conexión falla, intenta recuperar `win-sshproxy.exe` una vez y vuelve a comprobar la API. El intento conserva la máquina y los contenedores en ejecución; no descarga actualizaciones, construye imágenes ni carga otra vez los datos iniciales.

### Acceso desde la PC y las terminales

Con los puertos predeterminados:

- PC principal: `http://localhost:8080`.
- Tablets y otras computadoras: `http://IP-DE-LA-PC:8080`.

El puerto `18080` es interno. Windows publica el `8080` mediante un proxy TCP hacia `127.0.0.1:18080`. El firewall permite el perfil **Privado** y dispositivos de la subred local. Marcar como privada la red de confianza del restaurante. No se configura acceso desde Internet ni apertura de puertos en el router.

Las terminales necesitan un navegador actualizado y acceso a la PC por la red local. La operación diaria no requiere Internet, pero sí necesita que la PC principal, la aplicación y la red funcionen. Si la PC está apagada o inaccesible, una pantalla almacenada en el navegador no confirma pedidos, cobros ni otros datos en el servidor. No continuar suponiendo que se sincronizarán después.

El piloto usa HTTP en la red local. El instalador no configura HTTPS; las funciones de instalación y uso de la PWA que requieran un contexto seguro desde otras computadoras necesitan una configuración adicional.

Antes de abrir el turno, comprobar acceso desde otra terminal y realizar una comanda e impresión de prueba. Se admite ESC/POS por red y una impresora USB mediante su cola de Windows y un agente nativo en la PC de caja; consultar [BIXOLON_SRP_F310.md](../phase-3/BIXOLON_SRP_F310.md).

## 3. Actualizar desde un ZIP

Descargar el ZIP de la rama `main` del repositorio y **extraerlo por completo en una carpeta nueva**, por ejemplo `Descargas\AntojitOS-main`. Conservar la instalación en `C:\Program Files\AntojitOS`: no extraer encima ni copiar manualmente los archivos sobre ella.

Programar una ventana de mantenimiento. Cerrar las cuentas abiertas y el turno de caja, salir de todas las terminales y comprobar que nadie utilizará la aplicación durante la actualización. La aplicación debe estar iniciada y responder correctamente, salvo al recuperar un despliegue pendiente.

1. Con la misma cuenta propietaria de la instalación, abrir **`ACTUALIZAR-APP.cmd`** de la carpeta recién extraída. También se puede abrir su `final_script.cmd` y elegir **4**.
2. Revisar las carpetas de origen e instalación. Si se ofrece activar una impresora USB, elegir su cola instalada en Windows o escribir su nombre exacto, siguiendo la [guía de la Bixolon](../phase-3/BIXOLON_SRP_F310.md). Enter conserva la configuración actual.
3. Escribir **ACTUALIZAR** cuando se solicite el mantenimiento y mantener abierta la ventana hasta que termine.
4. Comprobar las terminales, iniciar sesión y realizar una comanda e impresión de prueba antes de reabrir el turno.

El lanzador de la carpeta nueva reconoce la instalación registrada y usa los archivos extraídos como origen. No necesita descargar la rama con Git ni autenticar un repositorio privado desde la PC de caja. La construcción puede necesitar Internet para obtener imágenes y dependencias que todavía no estén en caché.

Desde PowerShell, usar el lanzador nuevo y señalar explícitamente la carpeta extraída:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\final_script.ps1 -Action Update -SourcePath "C:\Users\CAJA\Downloads\AntojitOS-main" -ConfirmMaintenance
```

Reemplazar la ruta por la real. `-InstallPath` es opcional: si se omite, se consulta la instalación registrada. Para activar USB desde la consola se puede agregar `-PrinterQueue "BIXOLON SRP-F310"`, usando el nombre real; al omitirlo se conserva la configuración existente. Ejecutar desde la carpeta nueva permite usar las correcciones del actualizador incluso cuando la instalación conserva auxiliares anteriores.

El proceso valida el proyecto y conserva una copia de sus fuentes identificada mediante SHA-256 en `var/windows/update-source/`. Construye las imágenes antes de reemplazar el código instalado y conserva un respaldo del código anterior y de la configuración. Al aplicar el programa, retira los archivos de código gestionados que ya no existen en el origen; conserva `.git`, los archivos `.env` reales, `var/`, `backups/` y los datos de los volúmenes.

Después detiene la interfaz, API y agente de impresión para impedir escrituras, crea un respaldo PostgreSQL y prueba su restauración en una base temporal. Conserva los respaldos en `backups/windows-update-FECHA-ID/`. Sólo entonces inicia las nuevas imágenes: la API aplica las migraciones incluidas en el proyecto. El proceso no ejecuta la carga inicial ni restaura la base automáticamente.

Si falla, conservar los registros y seguir **Recuperación y respaldos**. No borrar el estado pendiente ni sustituir el origen por otro ZIP para intentar ocultar el error.

### Actualización mediante Git

Para una instalación que conserva el flujo Git, proporcionar explícitamente su URL y confirmar el mantenimiento:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\final_script.ps1 -Action Update -RepositoryUrl https://github.com/PROPIETARIO/REPOSITORIO.git -ConfirmMaintenance
```

Este flujo requiere Git limpio, rama activa compatible y un avance `fast-forward`. Rechaza cambios locales, archivos sin seguimiento, historias divergentes y rutas locales protegidas versionadas. No reemplaza `origin` ni fuerza la historia con `reset`, `stash` o `clean`. No usarlo después de actualizar mediante carpeta: conservar el procedimiento ZIP para las siguientes versiones.

### Reparación de una pantalla KDS anterior

Si `/?mode=kds` conserva la URL pero muestra «Selecciona una mesa», la pantalla
servida no corresponde a la entrada KDS actual. Reparar el arranque con la opción
1 conserva las imágenes instaladas: no despliega una nueva pantalla.

Para una instalación existente, el paquete **AntojitOS-cocina-corregida.zip**
incluye la pantalla compilada y `ABRIR-COMANDAS.cmd`. Extraerlo en Windows y
ejecutar ese archivo como administrador, con la cuenta propietaria y AntojitOS
iniciado. `04-reparar-cocina.ps1` utiliza el nginx instalado para preparar una
imagen local sin descargar dependencias, conserva la imagen anterior y recrea
únicamente `web`. Comprueba por HTTP el HTML y los archivos publicados; si falla,
intenta restaurar la imagen anterior. PostgreSQL, API e impresión siguen activos.
La imagen actualizada conserva la etiqueta que usa Compose en el próximo inicio.
El registro queda en `var/windows/logs/repair-kds.log` y la referencia de respaldo
en `var/windows/web-repair.json`. Una futura actualización completa
vuelve a construir la aplicación desde el código de la versión elegida.

Al finalizar abre `/recuperar-cocina.html?v=...`, que retira el service worker
anterior y solamente las cachés `antojit-os-shell-*`, conservando `localStorage`,
PIN y terminales registradas. Después entra en `/kds/`; también sigue admitiéndose
`/?mode=kds`. La nueva caché consulta primero el servidor al abrir una pantalla y
reserva el HTML guardado para cuando no hay conexión.

## Registros y ventanas de diagnóstico

Cada ejecución muestra su carpeta de registros y el resultado: **0** significa que terminó correctamente, **1** indica un error y **3010** solicita reiniciar Windows y continuar la instalación. La ventana de `final_script.cmd` espera una tecla al terminar. Al ejecutar el `.ps1` directamente, espera Enter salvo que se use `-NoPause`. La tarea de arranque utiliza `-Unattended` y guarda registros sin esperar interacción.

La carpeta habitual es:

```text
%ProgramData%\AntojitOS\logs\FECHA-PID\
```

Si no se puede escribir allí, se intenta `%LOCALAPPDATA%\AntojitOS\logs\` y después `%TEMP%\AntojitOS\logs\`. Usar la ruta que muestra la ejecución; el proceso elevado conserva esa misma carpeta de sesión.

- `final_script.log`: transcripción de la consola, resultado y errores, incluida la preparación anterior a cargar los módulos.
- `commands.log`: diagnósticos de comandos, salidas y errores de procesos externos.
- `bootstrap-error.log`: detalle adicional si falla la carga inicial antes de disponer del registro compartido.

La opción **5**, o `final_script.ps1 -Action Logs`, abre la carpeta de sesiones. Los auxiliares también conservan registros por operación en `var/windows/logs/` dentro de la instalación. Los instaladores pueden producir registros adicionales en `installers/` junto al registro de operación activo; la ruta exacta se indica en el diagnóstico. Conservar esos archivos cuando falle un MSI o instalador externo.

Para solicitar ayuda, compartir la carpeta de registros de esa ejecución y describir la opción elegida. Los secretos del proyecto se ocultan en las salidas registradas; mantener fuera del reporte `.env.pilot`, claves privadas y respaldos de la base. No leer el contenido de `.env.pilot` dentro de una consola cuya salida esté siendo grabada.

La ayuda del lanzador se puede consultar con `Get-Help .\final_script.ps1 -Full`.

### El instalador rechaza la URL oficial de Podman

Si la instalación se detiene con `La URL del instalador de containers/podman no pertenece a su publicacion oficial`, se está usando una versión anterior del instalador. El repositorio oficial de Podman cambió a `podman-container-tools/podman`; GitHub redirige la consulta anterior, pero los archivos de la publicación ya usan la dirección nueva.

Extraer el proyecto completo actualizado en una carpeta de preparación nueva, abrir su `final_script.cmd` y elegir **1** con la misma cuenta de Windows. Se comprueban y reutilizan las dependencias ya instaladas, y se conserva la configuración y la base existentes. No es necesario volver a formatear ni borrar WSL, Podman o los datos. Las validaciones de repositorio, hash y firma del instalador permanecen activas.

### Windows 10 ya tiene Podman 6 instalado

El instalador detecta que Podman 6 no es compatible con Windows 10 y se detiene con un diagnóstico. No lo sustituye ni cambia sus máquinas o datos automáticamente. Antes de cambiar de versión, revisar si esa instalación contiene otros proyectos y conservar sus respaldos. Preparar Podman 5.8.9 compatible con Windows 10 y volver a abrir `final_script.cmd`, opción **1**, con la misma cuenta. No borrar máquinas WSL ni volúmenes para resolver esta incompatibilidad.

### Podman inicia, pero Compose no encuentra su canal

Los mensajes `win-sshproxy.exe failed to start` y `failed to connect to the docker API at npipe:...` indican que falló el puente de Windows que utiliza Compose. `podman info` puede responder correctamente en ese estado. El código de salida 0 del auxiliar tampoco demuestra que haya levantado el canal.

Si aparece `Podman no informa el canal local que necesita Compose` aunque la salida de `machine inspect` sí contiene `ConnectionInfo.PodmanPipe.Path`, el lanzador anterior está interpretando incorrectamente los arreglos JSON de Windows PowerShell 5.1. La versión corregida normaliza esa respuesta antes de leer la máquina, y aplica el mismo manejo a las listas de máquinas, volúmenes y contenedores. Las pruebas incluyen la respuesta de Podman 6.1.4 de la ejecución que falló y reproducen la semántica de PowerShell 5.1.

Para aplicar la corrección a una instalación existente:

1. Extraer el proyecto completo actualizado en una carpeta de preparación nueva en la PC Windows.
2. Abrir su `final_script.cmd`, con la cuenta propietaria de la instalación, y elegir **1. Instalar / completar configuración**. Esto actualiza el lanzador protegido registrado en `ProgramData`, conservando la instalación y los datos existentes.
3. Comprobar el acceso a `http://localhost:8080` (o al puerto configurado). Reiniciar Windows y comprobar también el inicio automático y el acceso desde una terminal.

El arranque corregido consulta `ls --format json` directamente al proveedor Compose, sin necesitar `.env.pilot` para esa comprobación. Fija `DOCKER_HOST` al canal que informa la máquina seleccionada y descarta los contextos y opciones TLS heredados de otra instalación de Docker. Si el puente anterior ya terminó, ejecuta el auxiliar de Podman con un único reenvío al socket rootless de esa máquina, sin solicitar el canal global `docker_engine` ni el socket Unix de Windows. Si el auxiliar sigue activo, espera a su API sin duplicarlo.

Si la conexión continúa fallando, el inicio termina con el error de Compose y el detalle de recuperación. Conservar los archivos `win-sshproxy-*.stderr.log` de esa ejecución y consultar el Visor de eventos, **Registros de Windows > Aplicación**, origen **.NET Runtime**, en la hora del fallo. No recrear la máquina ni cambiarla a rootful como reparación: esos cambios seleccionan otro almacenamiento.

La recuperación del auxiliar utiliza el protocolo de argumentos de Podman y debe comprobarse con la versión instalada en la PC afectada. Las pruebas automatizadas incluyen una respuesta de Podman 6.1.4 y verifican la lógica con mocks; la comprobación física con Podman 5 en Windows 10 y con Podman 6 en Windows 11 sigue pendiente.

## Recuperación y respaldos

La configuración de la instalación está en `var/windows/installation.json`. Si una actualización falla antes de iniciar las nuevas migraciones, los contenedores anteriores se mantienen; si ya se habían detenido para respaldar, se intenta iniciarlos de nuevo. El flujo ZIP construye primero desde una copia separada y, si falla después de copiar código pero antes de las migraciones, intenta reponer el código y la configuración anteriores. En el flujo Git el código local puede haber avanzado aunque los contenedores sigan ejecutando la versión anterior.

`var/windows/update-pending.json` conserva ese estado para que otro intento de **Actualizar** complete el despliegue pendiente. Instalación y arranque diario se detienen mientras exista ese estado, para no activar imágenes parcialmente construidas sin completar respaldo y despliegue. No borrar el archivo para ocultar un fallo.

Si falla después de iniciar la nueva API, algunas migraciones pueden haberse aplicado. El proceso intenta detener los servicios de escritura y conserva los respaldos. Revisar error y estado de la base antes de reintentar la actualización con mantenimiento confirmado. Ese intento prepara solamente PostgreSQL para respaldar el estado actual antes de iniciar otra vez la API.

Para una actualización desde carpeta, el estado pendiente identifica las fuentes congeladas y su hash. Reintentar esa misma versión: después de un posible cambio del esquema se rechaza sustituirla por fuentes distintas. Conservar la carpeta `var/windows/update-source/` y el respaldo del código anterior. Para un despliegue Git pendiente se conserva el commit objetivo; si GitHub ya apunta a otro, se debe resolver el intento anterior antes de adoptar esa nueva versión o cambiar al procedimiento ZIP.

Después de iniciar las nuevas migraciones no se restaura la base ni se retrocede el código automáticamente. Si el fallo no se resuelve, seguir [CONTINGENCIA.md](CONTINGENCIA.md) y planear una recuperación coherente de código, configuración y base.

Los respaldos contienen información del negocio y la copia de `.env.pilot` contiene secretos. Sus carpetas quedan restringidas al propietario, administradores y `SYSTEM`; modificar el código instalado requiere una sesión elevada. Conservar una copia segura en otra unidad: un respaldo en el mismo disco no protege ante una falla de la PC. Los respaldos de actualización tampoco reemplazan los respaldos diarios después del cierre; el procedimiento general está en [EJECUCION_PILOTO.md](EJECUCION_PILOTO.md).

Queda pendiente validar en computadoras reales con **Windows 10 22H2 x64 y Windows 11 x64** la instalación desde cero, reinicio, tarea de arranque, acceso por LAN, actualización con datos y la impresora del negocio. Las comprobaciones de sintaxis y pruebas automatizadas no sustituyen esos ensayos.
