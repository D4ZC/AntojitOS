# Ejecución del piloto

## 1. Preparar la PC principal

Se requiere Node.js 24, pnpm 10 y uno de estos motores:

- Podman con `podman compose`.
- Docker Engine con `docker compose`.

El sistema elige Podman primero. Para forzar otro motor:

```bash
CONTAINER_ENGINE=docker pnpm pilot:up
```

Crear la configuración una sola vez:

```bash
pnpm pilot:init
```

El comando muestra los códigos iniciales de administrador y mesero, además del token para registrar terminales. Guardarlos fuera de la PC. `.env.pilot` contiene secretos y no se versiona.

## 2. Iniciar e inicializar

```bash
pnpm pilot:up
pnpm pilot:seed
pnpm pilot:status
pnpm pilot:verify
```

`pilot:up` construye las imágenes, ejecuta las migraciones e inicia PostgreSQL, API, PWA y agente de impresión. `pilot:seed` se usa en una instalación nueva; volver a ejecutarlo restablece los PIN iniciales a los valores de `.env.pilot`.

Abrir en la PC principal:

```text
http://localhost:8080
```

En cada tablet usar la IP fija o reservada de la PC principal:

```text
http://IP-DE-LA-PC:8080
```

Cada tablet requiere un código único, por ejemplo `POS-01` y `POS-02`. El KDS puede abrirse con `?mode=kds` y otro código único.

## 3. Operación diaria

Antes de abrir:

1. Confirmar que la PC esté conectada a la red local y a energía protegida.
2. Ejecutar `pnpm pilot:status`.
3. Ejecutar `pnpm pilot:verify`.
4. Confirmar el agente con `pnpm pilot:logs -- print-agent`.
5. Probar una comanda y una impresión antes del primer turno.

Para detener sin borrar datos:

```bash
pnpm pilot:down
```

No ejecutar comandos de Compose que eliminen volúmenes. El volumen `pilot_postgres` contiene la base activa.

## 4. Respaldar y comprobar

Crear un respaldo después de cada cierre y antes de actualizar:

```bash
pnpm pilot:backup
```

Se generan un archivo `.dump` y un manifiesto `.json` bajo `backups/`. Copiar ambos a una unidad distinta de la PC principal.

Comprobar que un respaldo realmente puede restaurarse:

```bash
pnpm pilot:verify-backup -- backups/ARCHIVO.dump
```

La comprobación crea una base temporal, restaura el archivo, verifica migraciones y sucursal, y elimina únicamente esa base temporal.

## 5. Restaurar la base activa

Esta operación reemplaza los datos actuales. Sólo debe ejecutarse durante una contingencia confirmada:

```bash
pnpm pilot:restore -- backups/ARCHIVO.dump --confirm-restore
```

El flujo valida el archivo, crea un respaldo preventivo, detiene API e impresión, reemplaza la base, reinicia los servicios y verifica disponibilidad. Si falla la restauración, no continuar operando: conservar los archivos y seguir `CONTINGENCIA.md`.

## 6. Actualizar una versión

1. Cerrar todas las cuentas y el turno de caja.
2. Ejecutar y copiar fuera de la PC un respaldo verificado.
3. Detener la pila con `pnpm pilot:down`.
4. Actualizar el código mediante el procedimiento Git acordado.
5. Ejecutar `pnpm pilot:up`; las migraciones se aplican antes de iniciar la API.
6. Ejecutar `pnpm pilot:verify` y el recorrido de humo.
