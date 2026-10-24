# Bixolon SRP-F310: tickets y comandas de 80 mm

El agente genera ESC/POS para papel de 80 mm y puede enviar el mismo ticket por red TCP 9100 o a una cola instalada en Windows, macOS o Linux. La cola del sistema permite usar una Bixolon conectada por USB. La aplicación del navegador genera trabajos; el agente se ejecuta en la computadora que puede acceder a la impresora.

El perfil inicial usa fuente A con 42 columnas, caracteres CP858 y selección de página ESC/POS 19. El [manual oficial de usuario SRP-F310/F312, revisión 1.06, sección 4, página 19](https://www.bixolon.com/_upload/manual/Manual_SRP-F310312_User_english_Rev_1_06%5B0%5D.pdf) especifica para la SRP-F310 original 180 dpi, área imprimible de 72 mm y 42 caracteres por línea en fuente A, o 56 en fuente B. La SRP-F312 es otro modelo: 203 dpi y 48/64 caracteres. El ancho del rollo por sí solo no determina la cantidad de columnas.

El ancho es configurable entre 24 y 56 columnas: hasta 42 el agente selecciona fuente A y de 43 a 56 selecciona fuente B, que es más pequeña. Confirmar ancho, acentos y corte con el autotest/manual del equipo y una prueba controlada después de instalarlo. Esta implementación se verificó con pruebas automatizadas y simulación; no se imprimió en un equipo físico.

La [tabla oficial de caracteres SRP-F310/F312, revisión 1.00, página 13](https://www.bixolon.com/_upload/manual/Manual_SRP-F310312_Codepages_english_Rev_1_00.pdf) identifica la página 19 como CP858 (Euro).

## Conexión por Ethernet

Usar la dirección de la impresora en la red del negocio:

```dotenv
PRINT_AGENT_MODE=tcp
PRINTER_HOST=192.168.1.50
PRINTER_PORT=9100
PRINTER_TIMEOUT_MS=10000
PRINTER_COLUMNS=42
PRINTER_ENCODING=cp858
PRINTER_CODE_PAGE=19
```

El agente del despliegue con Podman puede usar esta conexión si su red alcanza esa dirección. Configurar los valores en `.env.pilot` y reiniciar únicamente el servicio de impresión después de actualizar la aplicación.

## Conexión USB mediante cola del sistema

Primero instalar la impresora en el sistema operativo de la computadora. El agente no descarga ni instala controladores. En Windows usar el controlador del modelo provisto por Bixolon y verificar que la cola corresponda al puerto USB de la impresora.

Consultar nombres de colas sin imprimir:

```powershell
Get-Printer | Select-Object Name, DriverName, PortName, PrinterStatus
```

En macOS o Linux:

```bash
lpstat -p -d
```

Configurar `PRINTER_QUEUE` con el nombre de la cola, respetando espacios. En Windows el agente envía un documento `RAW` por Winspool usando Windows PowerShell; no convierte los comandos ESC/POS en un documento gráfico. En macOS/Linux usa `lp -d <cola> -o raw` con el ticket por entrada estándar. Se requiere una cola que acepte datos ESC/POS sin transformarlos.

El agente en modo `system` debe ejecutarse directamente en el sistema que tiene instalada esa cola. Un contenedor Linux de Podman en Windows/macOS no hereda las colas USB del anfitrión. Cambiar sólo `.env.pilot` a `system` dentro del contenedor no configura acceso a la impresora de Windows.

Crear un archivo local `.env.print-agent` en la raíz del proyecto. Está excluido de Git. Este ejemplo usa la impresora USB de la PC principal de caja para imprimir automáticamente las comandas de Cocina y Barra, además de los recibos y cortes de la caja principal:

```dotenv
PRINT_AGENT_MODE=system
PRINTER_QUEUE="BIXOLON SRP-F310"
PRINTER_TIMEOUT_MS=10000
PRINTER_COLUMNS=42
PRINTER_ENCODING=cp858
PRINTER_CODE_PAGE=19
PRINT_AGENT_API_URL=http://127.0.0.1:8080/api
PRINT_AGENT_SITE_CODE=PILOT
PRINT_AGENT_CODE=PRINT-USB-CAJA
PRINT_AGENT_NAME="Bixolon caja USB"
PRINT_AGENT_CENTERS=KITCHEN,BAR
PRINT_AGENT_REGISTERS=MAIN
PRINT_AGENT_CREDENTIALS_PATH=var/print-agent-usb/credentials.json
BOOTSTRAP_TOKEN=REEMPLAZAR_CON_EL_VALOR_DE_LA_INSTALACION
```

La dirección API debe usar el puerto HTTP configurado para la instalación. En desarrollo con la API sin proxy suele ser `http://127.0.0.1:3000/api`.

`PRINT_AGENT_CENTERS=KITCHEN,BAR` habilita las comandas de esos centros; `PRINT_AGENT_REGISTERS=MAIN` habilita los recibos y cortes de caja. Para imprimir únicamente recibos y cortes, dejar `PRINT_AGENT_CENTERS=` vacío. Para una impresora exclusiva de cocina usar `PRINT_AGENT_CENTERS=KITCHEN` y dejar `PRINT_AGENT_REGISTERS=` vacío. Debe existir al menos una caja o centro de producción.

Los destinos se guardan en la API al registrar el agente. Cambiarlos en el archivo de un agente que ya tiene credenciales no actualiza ese registro. Si ya se registró un agente de caja sin centros de producción:

1. Detener el agente anterior y conservar su archivo de credenciales.
2. Configurar `PRINT_AGENT_CENTERS=KITCHEN,BAR` y `PRINT_AGENT_REGISTERS=MAIN` en el nuevo archivo.
3. Usar un código y una ruta de credenciales que aún no existan, por ejemplo `PRINT_AGENT_CODE=PRINT-USB-CAJA-2` y `PRINT_AGENT_CREDENTIALS_PATH=var/print-agent-usb-2/credentials.json`.
4. Iniciar el nuevo agente con el comando indicado abajo. Su primer arranque registra los nuevos destinos.

Conservar también el código y las credenciales del agente anterior; no reutilizarlos ni borrarlos como forma de cambiar las rutas.

Preparar el agente desde la raíz del proyecto con Node.js 24 y las dependencias del proyecto instaladas:

```bash
pnpm --filter @antojit-os/print-agent build
```

Antes de iniciar este agente, detener cualquier otro que atienda los mismos destinos. Por ejemplo, detener el `print-agent` del piloto mediante el mismo comando de Compose y nombre de proyecto que se usó para iniciar esa instalación. Dos agentes que reclamen la misma caja pueden repartirse los trabajos y producir tickets en salidas distintas.

Iniciar el agente de forma nativa en la PC de caja, desde la raíz del proyecto:

```bash
node --env-file=.env.print-agent apps/print-agent/dist/main.js
```

El proceso permanece activo. La computadora y el agente deben estar encendidos para imprimir. El arranque de los contenedores del piloto no inicia este proceso nativo: debe iniciarse también en cada encendido de la PC. La primera ejecución registra su código y guarda una credencial local; conservar ese archivo y el mismo código en reinicios. El token de instalación permite registrar el agente, mientras que la credencial guardada autentica las siguientes ejecuciones. No compartir el archivo de configuración ni las credenciales.

## Simulación y comprobación

Las instalaciones nuevas usan `PRINT_AGENT_MODE=simulator` si todavía no se configuró una impresora. Este modo escribe el ticket de texto y los bytes ESC/POS en el directorio `PRINT_AGENT_OUTPUT_DIR`, y confirma el trabajo sin imprimir en papel. El texto usa el mismo ancho configurado para la salida real. Para obtener papel configurar `tcp` con la dirección de la impresora, o ejecutar el agente nativo en modo `system` con su cola instalada.

## Uso desde el POS

Al enviar una comanda desde la cuenta se genera y encola automáticamente su impresión para cada centro de producción. El agente de la PC principal imprime en cuanto recibe el trabajo, siempre que tenga asignados esos centros y una impresora configurada.

La comanda enviada muestra el botón **Imprimir comanda** para solicitar la impresión manualmente:

- Si hay un trabajo pendiente o en proceso, reutiliza ese trabajo para evitar otra impresión.
- Si la impresión falló, vuelve a poner el trabajo en cola para reintentarlo.
- Si ya se completó, genera una copia identificada como reimpresión.

El botón no vuelve a enviar los productos a producción ni modifica la cuenta. Antes de solicitar otra copia, revisar el papel y la cola si el resultado anterior es incierto.

Al cobrar se genera y encola automáticamente el ticket. En el comprobante del POS:

- **Imprimir ticket** solicita el trabajo original de esa venta; reutiliza el existente para evitar duplicarlo.
- **Actualizar impresión** consulta su estado actual.
- **Reintentar impresión** vuelve a poner en cola un trabajo fallido cuando ya se corrigió la conexión o la cola.
- **Reimprimir ticket** genera una copia identificada; requiere indicar el motivo.
- **Imprimir desde navegador** es el respaldo para imprimir con el controlador de Windows o del sistema operativo, sin depender del agente. Seleccionar la Bixolon, papel de 80 mm, escala adecuada, márgenes mínimos y desactivar encabezados y pies del navegador. El contenido se ajusta al área de 72 mm de la SRP-F310.

Estas acciones de impresión no vuelven a cobrar la venta. Si el trabajo ya salió en papel aunque el estado sea incierto, confirmar la cola antes de reintentar o pedir una copia.

Comprobar con una prueba controlada en la instalación:

1. Papel de 80 mm y cola/puerto correctos, impresora encendida y sin error de tapa o papel.
2. Nombres largos ajustados al ancho, notas y opciones como “Con todo” legibles.
3. Acentos y `ñ` correctos con CP858; el índice de página depende de la configuración/firmware de la impresora.
4. Ticket de venta al cobrar, comanda al enviar a cocina cuando ese destino está habilitado y reimpresión identificada como copia.
5. Corte de papel al final y una sola salida por trabajo.

Confirmar un trabajo significa que la cola del sistema aceptó un identificador y todos los bytes, o que finalizó el envío TCP. No confirma que haya salido papel: una cola puede aceptar un trabajo mientras la impresora está sin conexión o sin papel. Revisar la cola y el equipo antes de solicitar otra copia.

Si falta `lp`, la cola no existe, el spooler devuelve error, falta la confirmación del identificador o vence `PRINTER_TIMEOUT_MS`, el agente informa fallo. Un fallo después de enviar parte del documento puede dejar un resultado incierto y el sistema puede reintentar; verificar los trabajos de la cola y el papel antes de reimprimir para evitar duplicados.

El tiempo de espera admite hasta 25 segundos para dejar margen antes del vencimiento de 30 segundos de la reserva del trabajo en la API.

`PRINTER_ENCODING` admite únicamente `cp858`. Cambiar `PRINTER_CODE_PAGE` sólo si el manual o autotest confirma que ese índice selecciona CP858 en el firmware instalado; elegir otra tabla conservando los mismos bytes produce acentos incorrectos.
