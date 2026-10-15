# Ejecución local de la Fase 3

## Actualizar la instalación

Con PostgreSQL de Podman activo:

```bash
pnpm install
podman compose up -d postgres
pnpm --filter @antojit-os/api db:migrate
pnpm --filter @antojit-os/api db:seed
```

Iniciar API y aplicaciones web:

```bash
pnpm dev
```

En otra terminal, iniciar el agente en modo simulador:

```bash
pnpm dev:print-agent
```

La primera ejecución registra `PRINT-01` usando `BOOTSTRAP_TOKEN` y guarda su credencial local bajo `apps/print-agent/var/print-agent`. Las comandas simuladas se generan como `.txt` y `.bin` en `apps/print-agent/var/print-simulator`.

## Abrir el KDS

Desde la PC o una pantalla conectada a la red local:

```text
http://IP_DE_LA_PC:5173/?mode=kds
```

Registrar la pantalla con:

- Código: `KDS-01`
- Nombre: `Pantalla cocina`
- Token: el valor de `BOOTSTRAP_TOKEN`

Después ingresar con `ADMIN` y el PIN configurado en `SEED_ADMIN_PIN`.

## Recorrido manual

1. Abrir una mesa en el POS.
2. Agregar al menos un alimento y una bebida.
3. Enviar la comanda.
4. Confirmar que KDS muestra tarjetas separadas para Cocina y Barra.
5. Revisar los archivos `.txt` generados por el agente.
6. Avanzar una tarjeta por `Comenzar`, `Marcar listo` y `Entregar`.
7. Cancelar desde el POS un artículo ya enviado, indicando un motivo.
8. Confirmar que aparece una tarjeta de cancelación y un archivo diferenciado.
9. Solicitar una reimpresión desde KDS e indicar el motivo.
10. Confirmar un nuevo archivo con encabezado `REIMPRESION`.

## Impresora ESC/POS por red

Cuando se disponga del modelo físico, detener el agente y configurar:

```dotenv
PRINT_AGENT_MODE=tcp
PRINTER_HOST=192.168.1.50
PRINTER_PORT=9100
```

Luego reiniciar `pnpm dev:print-agent`. La dirección, juego de caracteres, ancho de papel y comando de corte deberán validarse con el modelo real antes del piloto.

