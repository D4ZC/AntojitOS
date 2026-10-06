# Ejecución local de la Fase 2

## Preparar la PC principal

Crear `.env` a partir del ejemplo y cambiar, como mínimo, los secretos:

```bash
cp .env.example .env
```

Para usar el POS conectado, establecer en `.env`:

```dotenv
VITE_REMOTE_MODE=true
BOOTSTRAP_TOKEN=un-secreto-local-largo-y-privado
SESSION_PEPPER=otro-secreto-aleatorio-de-al-menos-32-caracteres
```

Después iniciar PostgreSQL, aplicar las migraciones, cargar el catálogo piloto y levantar API y POS:

```bash
docker compose up -d postgres
pnpm --filter @antojit-os/api db:migrate
pnpm --filter @antojit-os/api db:seed
pnpm dev
```

Direcciones en la PC principal:

- POS: `http://localhost:5173`
- API: `http://localhost:3000/api`
- OpenAPI: `http://localhost:3000/api/docs`

## Conectar las dos tablets Windows

1. Conectar PC y tablets a la misma red privada.
2. Obtener la dirección IPv4 de la PC principal con `ipconfig`.
3. Permitir Node.js o el puerto TCP 5173 en el Firewall de Windows para redes privadas.
4. Abrir en Edge `http://IP_DE_LA_PC:5173` desde cada tablet.
5. En la primera apertura registrar cada tablet con un código único, por ejemplo `POS-01` y `POS-02`, el nombre visible y `BOOTSTRAP_TOKEN`.
6. Iniciar sesión con el usuario piloto `ADMIN` y el valor configurado en `SEED_ADMIN_PIN` (por defecto, sólo en desarrollo, `1234`).

La identidad y el secreto de dispositivo quedan guardados únicamente en el almacenamiento local de ese navegador. El token de instalación no se conserva. Borrar los datos del sitio obliga a registrar una terminal nueva.

## Recorrido de validación manual

1. En `POS-01`, abrir una mesa libre con dos comensales.
2. Agregar un taco, elegir una preparación opcional y guardar una nota.
3. Enviar la comanda y confirmar que el artículo queda bloqueado para edición.
4. Volver al mapa y comprobar que la mesa aparece ocupada.
5. Abrir esa mesa en `POS-02`; debe mostrarse la misma cuenta.
6. Mantener la cuenta abierta en ambas tablets, agregar un producto en una y luego intentar agregar con la vista anterior en la otra.
7. Confirmar que la segunda tablet informa el cambio concurrente y recarga la versión más reciente sin sobrescribirla.
8. Probar también `Venta rápida` y `Para llevar`.

## Notas operativas

- Internet no participa en este flujo; todas las peticiones viajan a la PC principal.
- El proxy de Vite se usa sólo durante desarrollo. El despliegue de restaurante tendrá un servidor web local que publique POS y `/api` bajo el mismo origen.
- No se deben abrir los puertos a Internet ni usar los secretos de ejemplo en una red real.
- La prueba física debe incluir toque, teclado en pantalla, giro accidental, suspensión y reconexión de ambas tablets.

