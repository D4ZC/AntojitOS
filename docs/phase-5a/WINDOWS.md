# Instalación y operación en Windows

Los tres puntos de entrada están en `scripts/windows/`:

| Script | Uso |
| --- | --- |
| `01-instalar.ps1` | Instala dependencias, prepara la configuración, inicia la aplicación y registra su arranque automático. |
| `02-iniciar.ps1` | Inicia la aplicación instalada y, con `-RegisterAutoStart`, registra o actualiza su tarea de arranque. |
| `03-actualizar.ps1` | Descarga una rama de GitHub, respalda los datos y despliega la nueva versión. |

Los archivos `.psm1` de esa carpeta son auxiliares compartidos. Deben conservarse junto con los tres scripts.

## Preparar la computadora

Usar Windows 11 de 64 bits actualizado, con acceso a una cuenta administradora, conexión a Internet para instalar y actualizar, y virtualización habilitada en BIOS/UEFI. WSL2 y Podman requieren que el equipo admita virtualización. El instalador descarga los instaladores oficiales directamente y comprueba sus firmas y hashes; no depende de `winget`.

Como referencia práctica se recomiendan 16 GB de RAM y SSD con al menos 30–50 GB libres. Estos valores son recomendaciones; todavía no se han medido mínimos de hardware del proyecto. Conviene reservar una IP para la PC en el router, utilizar una red de confianza y proteger su alimentación con un UPS.

El destino predeterminado es `C:\Program Files\AntojitOS`. El instalador protege el código para que modificarlo requiera permisos de administrador. Conservar esa ubicación fija, fuera de carpetas temporales y de carpetas sincronizadas. Ejecutar los scripts con **Windows PowerShell como administrador**, usando siempre la misma cuenta de Windows. Esa cuenta es propietaria de la máquina WSL/Podman y de los datos. Cambiar a otra cuenta o a `SYSTEM` no da acceso a la misma instalación.

El instalador prepara Node.js 24, Git, Podman, el proveedor Compose y WSL2 cuando faltan. PostgreSQL 17, la API, la interfaz y el agente de impresión se ejecutan en contenedores. No es necesario instalar PostgreSQL manualmente.

## 1. Instalar y configurar

Copiar el proyecto o extraer su ZIP en una carpeta de preparación. Desde esa carpeta, abrir Windows PowerShell como administrador y ejecutar:

```powershell
cd C:\Preparacion\AntojitOS
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\01-instalar.ps1
```

El instalador copia el programa a `C:\Program Files\AntojitOS`. Excluye los archivos `.env` reales, `var/`, `backups/`, `node_modules/` y `dist/` de la carpeta de origen: esta copia instala el programa; no migra la configuración ni la base de otra computadora. Si el origen es un repositorio Git limpio con un directorio `.git` real, conserva su historial. Si proviene de ZIP, de un worktree o incluye cambios locales, prepara una instantánea local con los archivos copiados, sin modificar la carpeta original.

Si Windows necesita reiniciarse para habilitar WSL2, el instalador termina con código `3010`. Reiniciar Windows y volver a ejecutar el mismo comando, con los mismos parámetros. El script no reinicia la PC por su cuenta.

Para escoger una carpeta dentro de `Program Files` y los puertos:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\01-instalar.ps1 -InstallPath "C:\Program Files\AntojitOS" -HttpPort 8080 -InternalHttpPort 18080
```

La ubicación activa y su propietario se registran en `%ProgramData%\AntojitOS\installation-location.json`. Los scripts de inicio y actualización consultan ese registro si se omite `-InstallPath`, incluso cuando se ejecutan desde la carpeta de preparación. Una instalación existente con otra ubicación o propietario requiere revisar la instalación anterior antes de crear otra que comparta la misma máquina y servicios.

Para los ejemplos siguientes se puede trabajar directamente desde la copia instalada:

```powershell
cd "C:\Program Files\AntojitOS"
```

El instalador crea `.env.pilot` con secretos nuevos durante la primera instalación. En una instalación existente conserva su configuración; si después se pierde ese archivo, exige recuperarlo de un respaldo. Inicializa los datos del restaurante solamente cuando la base todavía no contiene una sucursal. Una instalación completada reutiliza sus imágenes y no vuelve a crear la máquina de Podman ni a inicializar la base.

Para configurar una impresora ESC/POS por red durante la instalación, agregar `-PrinterHost 192.168.1.50 -PrinterPort 9100`, reemplazando la IP por la real. Si no se indica una impresora, la instalación nueva usa el simulador. El modelo, los caracteres, el papel y el corte requieren una prueba física.

Guardar los códigos iniciales y el token de registro de terminales en un lugar seguro. `.env.pilot` contiene contraseñas y secretos: no debe subirse a GitHub ni compartirse con los registros de diagnóstico.

La máquina de Podman se llama `antojitos-pilot` y usa almacenamiento **rootless**. Mantener ese nombre y esa conexión; otra máquina o el modo rootful tienen almacenamiento distinto.

### Instalar antes de tener el repositorio de GitHub

Se puede instalar desde una copia o ZIP sin conocer todavía la URL. El instalador crea un repositorio Git local con una rama inicial `antojitos-local-installation` y registra el origen como `snapshot`. Esa rama conserva una referencia de los archivos instalados.

Cuando se tenga la URL, proporcionarla al actualizador. En esa primera actualización se adopta la rama de GitHub conservando la rama local inicial y los datos. Después se aceptan únicamente avances `fast-forward` de la rama adoptada. El script no toma automáticamente la URL del remoto `origin`.

Si ya se conoce el repositorio durante la instalación, se pueden usar `-RepositoryUrl` y `-Branch`. Las URLs admitidas son HTTPS de GitHub o SSH con el formato `git@github.com:propietario/repositorio.git`. Para repositorios privados se necesita autenticación de Git configurada en la cuenta propietaria; los scripts no aceptan tokens dentro de la URL.

## 2. Arranque automático y arranque manual

Por defecto, la instalación registra una tarea del Programador de tareas para ejecutarse al iniciar Windows, antes de iniciar sesión. Solicita las credenciales de la misma cuenta propietaria. Se necesita la **contraseña de Windows**; el PIN de Windows Hello no sirve. La contraseña se entrega al Programador de tareas y no se guarda en los archivos de AntojitOS.

Para registrar de nuevo ese arranque, por ejemplo después de cambiar la contraseña de Windows:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\02-iniciar.ps1 -RegisterAutoStart -ForceRegister -AutoStartMode Startup
```

Si se prefiere iniciar después de que el usuario entre en su sesión, sin registrar una contraseña:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\02-iniciar.ps1 -RegisterAutoStart -AutoStartMode Logon
```

También se puede elegir ese modo desde la instalación con `01-instalar.ps1 -AutoStartMode Logon`. En ese modo la aplicación estará disponible después de iniciar sesión con la cuenta propietaria.

Para arrancar manualmente sin cambiar la tarea:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\02-iniciar.ps1
```

El arranque diario utiliza las imágenes y los datos instalados: no descarga actualizaciones, construye imágenes ni vuelve a cargar los datos iniciales. Espera a que Podman esté disponible, inicia los servicios y comprueba la aplicación.

### Acceso desde la PC y las terminales

Con los valores predeterminados, abrir:

- PC principal: `http://localhost:8080`.
- Tablets y otras computadoras: `http://IP-DE-LA-PC:8080`.

El puerto `18080` es interno. Windows publica el puerto `8080` mediante un proxy TCP hacia `127.0.0.1:18080`. El instalador configura una regla de firewall para el perfil **Privado** y dispositivos de la subred local. La red de Windows debe estar marcada como privada si corresponde a la red de confianza del restaurante. No se configura acceso desde Internet ni apertura de puertos en el router.

Las terminales necesitan un navegador actualizado y acceso a la PC por la red local. La operación diaria no requiere Internet, pero sí requiere que la PC principal, la aplicación y la red local funcionen. Si la PC está apagada o inaccesible, una pantalla almacenada en el navegador no confirma pedidos, cobros ni otros datos en el servidor. No continuar operando sobre la suposición de que se sincronizarán después.

El piloto actual usa HTTP en la red local. Estos scripts no configuran HTTPS; las funciones de instalación y uso de la PWA que requieran un contexto seguro desde otras computadoras necesitan una configuración adicional.

Antes de abrir el turno, comprobar acceso desde otra terminal y realizar una comanda e impresión de prueba. El soporte actual de impresión corresponde a impresoras ESC/POS por red; una impresora únicamente USB requiere integración adicional.

## 3. Actualizar desde GitHub

Programar una ventana de mantenimiento. Cerrar las cuentas abiertas y el turno de caja, salir de todas las terminales y confirmar que nadie utilizará la aplicación durante la actualización. La aplicación debe estar iniciada y responder correctamente antes de actualizar.

En la primera actualización:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\03-actualizar.ps1 -RepositoryUrl https://github.com/PROPIETARIO/REPOSITORIO.git -ConfirmMaintenance
```

Reemplazar la URL del ejemplo por la URL real. En una instalación desde ZIP, si se omite `-Branch`, se consulta la rama predeterminada anunciada por GitHub. En una instalación Git se usa la rama registrada o la rama local activa, y debe coincidir con ella.

Después de una actualización correcta, la URL y la rama quedan registradas:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\03-actualizar.ps1 -ConfirmMaintenance
```

Para comprobar si hay cambios sin autorizar una ventana de mantenimiento, ejecutar sin `-ConfirmMaintenance`. Si no hay commits nuevos, termina sin detener la aplicación. Si hay una actualización, la descarga y solicita repetir el comando con el parámetro durante el mantenimiento. No es una actualización automática programada.

El proceso:

1. Comprueba que Git no tenga cambios locales, archivos sin seguimiento o una rama desacoplada. Rechaza historias divergentes y versiones que intenten versionar `.env`, `.env.pilot`, `var/` o `backups/`.
2. Descarga la rama indicada y comprueba que pueda avanzar sin forzar la historia. No reemplaza `origin` ni ejecuta `reset`, `stash` o `clean`.
3. Copia `.env.pilot` a un directorio protegido y registra el estado del intento. Avanza el código y construye las imágenes mientras los contenedores anteriores siguen disponibles.
4. Detiene la interfaz, el agente de impresión y la API para impedir escrituras durante el respaldo. PostgreSQL permanece iniciado.
5. Crea un respaldo PostgreSQL, valida el archivo y prueba su restauración en una base temporal. Conserva el `.dump`, su manifiesto y la configuración en `backups/windows-update-FECHA-ID/`.
6. Inicia los servicios con las imágenes construidas, aplica las migraciones al arrancar la API y verifica la disponibilidad. No ejecuta `seed` ni reemplaza secretos o volúmenes.

Después de actualizar, verificar acceso desde las terminales, iniciar sesión y realizar una comanda e impresión de prueba antes de reabrir el turno.

## Fallos, respaldos y diagnóstico

Los registros de los scripts están en `var/windows/logs/`. La configuración de la instalación está en `var/windows/installation.json`. Para consultar la ayuda de cada script se puede usar `Get-Help .\scripts\windows\03-actualizar.ps1 -Full`, cambiando el nombre según corresponda.

Si una actualización falla antes del despliegue, se mantienen los contenedores anteriores; si ya se habían detenido para respaldar, el script intenta iniciarlos de nuevo. El código local puede haber avanzado aunque los contenedores sigan ejecutando la versión anterior. `var/windows/update-pending.json` conserva ese estado para que otro intento despliegue el commit pendiente aunque Git ya no tenga cambios nuevos. El instalador y el arranque diario se detienen mientras exista ese estado, para evitar activar imágenes parcialmente construidas sin completar el respaldo y el despliegue. No borrar ese archivo para ocultar un fallo.

Si falla después de iniciar la nueva API, algunas migraciones pueden haberse aplicado. El script intenta detener los servicios de escritura y conserva los respaldos. Revisar el error y el estado de la base antes de reintentar con `-ConfirmMaintenance`. Ese intento prepara solamente PostgreSQL para respaldar el estado actual antes de volver a iniciar la API; conserva la indicación de que pudo haber migraciones. Si la rama de GitHub ya apunta a otro commit, rechaza adoptar esa nueva versión hasta resolver la actualización pendiente. No se restaura la base ni se retrocede el código automáticamente. Si el fallo no se resuelve, seguir [CONTINGENCIA.md](CONTINGENCIA.md) y planear una recuperación coherente de código, configuración y base.

Los respaldos contienen información del negocio y la copia de `.env.pilot` contiene secretos. Sus carpetas quedan restringidas al propietario, administradores y `SYSTEM`; el código instalado se modifica mediante una sesión elevada de administrador. Conservar una copia segura en otra unidad: un respaldo en el mismo disco no protege ante una falla de la PC. Los respaldos de actualización tampoco reemplazan una política de respaldos diarios después del cierre; el procedimiento general está en [EJECUCION_PILOTO.md](EJECUCION_PILOTO.md).

La sintaxis y las comprobaciones automatizadas no sustituyen el ensayo del equipo final. Queda pendiente validar en una PC Windows real la instalación desde cero, reinicio, tarea de arranque, acceso por LAN, actualización con datos y la impresora del negocio.
