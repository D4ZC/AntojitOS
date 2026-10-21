# Instalación y operación en Windows

La entrada para todas las operaciones es **`final_script.cmd`**, en la raíz del proyecto. Abrirlo con doble clic para instalar, iniciar, configurar el arranque, actualizar o consultar registros. La ventana muestra el resultado y permanece abierta hasta presionar una tecla, incluso si falla un comando.

Conservar **la carpeta completa del proyecto**: `final_script.cmd`, `final_script.ps1`, `scripts/`, `apps/`, `packages/` y los demás archivos de construcción. Copiar solamente el lanzador no instala la aplicación. Los archivos de `scripts/windows/` son auxiliares internos; el usuario realiza todas las operaciones mediante `final_script`.

| Opción del menú | Acción |
| --- | --- |
| **1. Instalar / completar configuración** | Instala dependencias, configura la aplicación, prepara los datos nuevos, registra el arranque automático e inicia el servicio. |
| **2. Iniciar la aplicación instalada** | Inicia las imágenes y los datos existentes. |
| **3. Configurar / reparar el arranque automático** | Selecciona inicio al encender o al entrar al escritorio y registra la tarea. |
| **4. Actualizar desde GitHub** | Pide la URL si hace falta y la confirmación de mantenimiento antes de desplegar. |
| **5. Abrir la carpeta de logs** | Abre la carpeta que contiene los registros de las ejecuciones. |
| **0. Salir** | Termina sin ejecutar una operación. |

## Preparar la computadora

Usar Windows 11 de escritorio de 64 bits x64, actualizado, con una cuenta administradora, conexión a Internet para instalar y actualizar, y virtualización habilitada en BIOS/UEFI. No se admite ARM64. Windows PowerShell 5.1, incluido en Windows, es suficiente. El instalador descarga los instaladores oficiales y comprueba sus firmas y hashes; no depende de `winget`.

Se recomiendan 16 GB de RAM y SSD con al menos 30–50 GB libres. Son referencias prácticas; todavía no se han medido mínimos de hardware del proyecto. Conviene reservar una IP para la PC en el router, utilizar una red de confianza y proteger su alimentación con un UPS.

El destino predeterminado es `C:\Program Files\AntojitOS`. El código queda protegido para que modificarlo requiera permisos de administrador. Conservar esa ubicación fija, fuera de carpetas temporales y de carpetas sincronizadas.

`final_script` solicita elevación cuando es necesaria. Usar siempre la **misma cuenta administradora de Windows**: esa cuenta es propietaria de la máquina WSL/Podman y de los datos. Si la elevación cambia de cuenta, el proceso se detiene. Otra cuenta o `SYSTEM` no dan acceso a la misma instalación.

El instalador prepara Node.js 24, Git, Podman, el proveedor Compose y WSL2 cuando faltan. PostgreSQL 17, la API, la interfaz y el agente de impresión se ejecutan en contenedores. No es necesario instalar PostgreSQL manualmente.

## 1. Instalar y configurar

Extraer el ZIP o copiar el proyecto completo en una carpeta de preparación, abrir `final_script.cmd` y elegir **1**. Esta opción incluye la configuración y el arranque automático; no es necesario ejecutar otro instalador después.

El programa se copia a `C:\Program Files\AntojitOS`. Se excluyen los archivos `.env` reales, `var/`, `backups/`, `node_modules/` y `dist/` del origen: esta copia instala el programa; no migra la configuración ni la base de otra computadora. Si el origen es un repositorio Git limpio con un directorio `.git` real, conserva su historial. Si proviene de ZIP, de un worktree o incluye cambios locales, prepara una instantánea local con los archivos copiados, sin modificar la carpeta original.

Si WSL2 necesita reiniciar Windows, se muestra el código **3010**. Reiniciar y volver a abrir `final_script.cmd`, opción **1**, con los mismos parámetros si se usaron desde la consola. La PC no se reinicia automáticamente.

La configuración inicial y los códigos se generan una vez en `.env.pilot`. **Los PIN, tokens y contraseñas se ocultan en la pantalla y en los registros.** Para consultar los códigos iniciales, cerrar la consola del instalador y abrir de forma privada `C:\Program Files\AntojitOS\.env.pilot` en un editor local. Guardarlos en un lugar seguro; no copiar ese archivo al reporte de diagnóstico ni a GitHub.

En una instalación existente se conservan la configuración y los datos. Si se pierde `.env.pilot`, es necesario recuperarlo de un respaldo. La carga inicial del restaurante se realiza únicamente cuando la base todavía no contiene una sucursal. Una instalación completada reutiliza sus imágenes y no vuelve a crear la máquina ni a inicializar la base.

La máquina de Podman se llama `antojitos-pilot` y usa almacenamiento **rootless**. Mantener ese nombre y conexión: otra máquina o el modo rootful tienen almacenamiento distinto.

### Usar parámetros desde PowerShell

Abrir una consola en la raíz de la carpeta completa del proyecto:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\final_script.ps1 -Action Install
```

Para escoger una carpeta dentro de `Program Files`, los puertos y una impresora ESC/POS por red:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\final_script.ps1 -Action Install -InstallPath "C:\Program Files\AntojitOS" -HttpPort 8080 -InternalHttpPort 18080 -PrinterHost 192.168.1.50 -PrinterPort 9100
```

Reemplazar la IP por la real. Si no se indica impresora, una instalación nueva usa el simulador. El modelo, los caracteres, el papel y el corte requieren una prueba física.

La ubicación y su propietario se registran en `%ProgramData%\AntojitOS\installation-location.json`. Inicio y actualización consultan ese registro cuando se omite `-InstallPath`, incluso si el lanzador se ejecuta desde la carpeta de preparación. Si ya hay una instalación con otra ruta o propietario, revisar la anterior antes de crear otra que comparta máquina y servicios.

En una instalación nueva se puede abrir `C:\Program Files\AntojitOS\final_script.cmd`. Para los siguientes ejemplos de consola, usar como directorio actual esa carpeta o la carpeta completa del proyecto de preparación.

Al reparar una instalación anterior con auxiliares ausentes o distintos, la opción **1** prepara un lanzador protegido en `%ProgramData%\AntojitOS\launcher` y registra su ruta en `installation.LauncherPath`. Así conserva el árbol Git de la aplicación, `.env.pilot` y los datos. Esa copia auxiliar sirve al arranque automático; para instalar o reparar se sigue usando el proyecto completo. Una actualización desde GitHub no renueva ese lanzador externo: para renovarlo, volver a elegir **1** desde el proyecto completo actualizado.

### Instalar antes de conocer la URL de GitHub

Se puede instalar desde una copia o ZIP sin proporcionar una URL. El instalador crea un repositorio local con la rama `antojitos-local-installation` y registra el origen como `snapshot`. Esa rama conserva una referencia de los archivos instalados.

Cuando se tenga la URL, proporcionarla en la opción **4** o con `-Action Update -RepositoryUrl ...`. La primera actualización adopta la rama de GitHub conservando la rama local inicial y los datos. Después se aceptan únicamente avances `fast-forward` de la rama adoptada. No se toma automáticamente la URL del remoto `origin` ni se presupone un repositorio de GitHub.

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

El arranque diario utiliza las imágenes y los datos instalados. Espera a Podman, inicia los servicios y comprueba la aplicación; no descarga actualizaciones, construye imágenes ni carga otra vez los datos iniciales.

### Acceso desde la PC y las terminales

Con los puertos predeterminados:

- PC principal: `http://localhost:8080`.
- Tablets y otras computadoras: `http://IP-DE-LA-PC:8080`.

El puerto `18080` es interno. Windows publica el `8080` mediante un proxy TCP hacia `127.0.0.1:18080`. El firewall permite el perfil **Privado** y dispositivos de la subred local. Marcar como privada la red de confianza del restaurante. No se configura acceso desde Internet ni apertura de puertos en el router.

Las terminales necesitan un navegador actualizado y acceso a la PC por la red local. La operación diaria no requiere Internet, pero sí necesita que la PC principal, la aplicación y la red funcionen. Si la PC está apagada o inaccesible, una pantalla almacenada en el navegador no confirma pedidos, cobros ni otros datos en el servidor. No continuar suponiendo que se sincronizarán después.

El piloto usa HTTP en la red local. El instalador no configura HTTPS; las funciones de instalación y uso de la PWA que requieran un contexto seguro desde otras computadoras necesitan una configuración adicional.

Antes de abrir el turno, comprobar acceso desde otra terminal y realizar una comanda e impresión de prueba. La impresión actual corresponde a ESC/POS por red; una impresora únicamente USB requiere integración adicional.

## 3. Actualizar desde GitHub

Programar una ventana de mantenimiento. Cerrar las cuentas abiertas y el turno de caja, salir de todas las terminales y comprobar que nadie utilizará la aplicación durante la actualización. Antes de una actualización normal, la aplicación debe estar iniciada y responder correctamente.

Abrir `final_script.cmd`, opción **4**. Escribir la URL real cuando se tenga; Enter reutiliza la que ya quedó guardada. Escribir **ACTUALIZAR** para confirmar el mantenimiento y desplegar. Enter en esa confirmación sólo comprueba y descarga los cambios disponibles, sin desplegarlos.

Desde PowerShell, la primera actualización:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\final_script.ps1 -Action Update -RepositoryUrl https://github.com/PROPIETARIO/REPOSITORIO.git -ConfirmMaintenance
```

Reemplazar el ejemplo por la URL que proporcione el propietario. En una instalación desde ZIP, omitir `-Branch` consulta la rama predeterminada anunciada por GitHub. En una instalación Git se usa la rama registrada o la activa, y debe coincidir con ella.

Después de una actualización correcta, la URL y la rama quedan registradas:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\final_script.ps1 -Action Update -ConfirmMaintenance
```

Sin `-ConfirmMaintenance`, si no hay commits nuevos termina sin detener servicios. Si hay cambios, informa que debe repetirse la operación con mantenimiento antes de desplegar. No se programan actualizaciones automáticas.

El proceso de actualización:

1. Comprueba que Git no tenga cambios locales, archivos sin seguimiento o una rama desacoplada. Rechaza historias divergentes y versiones que intenten versionar `.env`, `.env.pilot`, `var/` o `backups/`.
2. Descarga la rama y comprueba el avance. No reemplaza `origin` ni fuerza la historia con `reset`, `stash` o `clean`.
3. Copia `.env.pilot` a un directorio protegido y registra el intento. Avanza el código y construye las imágenes una por una mientras los contenedores anteriores siguen disponibles.
4. Detiene interfaz, agente de impresión y API para impedir escrituras. PostgreSQL permanece iniciado.
5. Crea y valida un respaldo PostgreSQL y prueba su restauración en una base temporal. Conserva `.dump`, manifiesto y configuración en `backups/windows-update-FECHA-ID/`.
6. Inicia los servicios con las imágenes construidas, aplica migraciones al arrancar la API y verifica disponibilidad. No vuelve a ejecutar la carga inicial ni reemplaza secretos o volúmenes.

Comprobar las terminales, iniciar sesión y realizar una comanda e impresión de prueba antes de reabrir el turno.

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

## Recuperación y respaldos

La configuración de la instalación está en `var/windows/installation.json`. Si una actualización falla antes del despliegue, los contenedores anteriores se mantienen; si ya se habían detenido para respaldar, se intenta iniciarlos de nuevo. El código local puede haber avanzado aunque los contenedores sigan ejecutando la versión anterior.

`var/windows/update-pending.json` conserva ese estado para que otro intento de **Actualizar** despliegue el commit pendiente aunque Git ya no tenga cambios nuevos. Instalación y arranque diario se detienen mientras exista ese estado, para no activar imágenes parcialmente construidas sin completar respaldo y despliegue. No borrar el archivo para ocultar un fallo.

Si falla después de iniciar la nueva API, algunas migraciones pueden haberse aplicado. El proceso intenta detener los servicios de escritura y conserva los respaldos. Revisar error y estado de la base antes de reintentar la actualización con mantenimiento confirmado. Ese intento prepara solamente PostgreSQL para respaldar el estado actual antes de iniciar otra vez la API. Si GitHub ya apunta a otro commit, se rechaza adoptar esa nueva versión hasta resolver el intento pendiente.

No se restaura la base ni se retrocede el código automáticamente. Si el fallo no se resuelve, seguir [CONTINGENCIA.md](CONTINGENCIA.md) y planear una recuperación coherente de código, configuración y base.

Los respaldos contienen información del negocio y la copia de `.env.pilot` contiene secretos. Sus carpetas quedan restringidas al propietario, administradores y `SYSTEM`; modificar el código instalado requiere una sesión elevada. Conservar una copia segura en otra unidad: un respaldo en el mismo disco no protege ante una falla de la PC. Los respaldos de actualización tampoco reemplazan los respaldos diarios después del cierre; el procedimiento general está en [EJECUCION_PILOTO.md](EJECUCION_PILOTO.md).

Queda pendiente validar en una PC Windows real la instalación desde cero, reinicio, tarea de arranque, acceso por LAN, actualización con datos y la impresora del negocio. Las comprobaciones de sintaxis y pruebas automatizadas no sustituyen ese ensayo.
