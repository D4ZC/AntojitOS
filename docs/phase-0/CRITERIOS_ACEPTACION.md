# Criterios de aceptación de la Fase 0

## Funcionales

- El operador puede elegir una categoría y agregar productos usando sólo toques.
- Toques repetidos del mismo producto pendiente agrupan cantidad.
- Disminuir una captura pendiente a cero la retira de la cuenta.
- “Enviar a cocina” cambia todos los pendientes a enviados una sola vez.
- Los artículos enviados ya no permiten cambiar cantidad.
- “Cobrar” permanece bloqueado mientras existan artículos pendientes.
- Subtotal y total usan centavos enteros y se actualizan con las cantidades.

## Táctiles

- Acciones principales y controles de cantidad miden como mínimo 44 px.
- No existe una acción que dependa de `hover`, clic derecho o teclado físico.
- La vista principal es utilizable desde 1024 × 600 en orientación horizontal.
- A 800 px o menos el contenido se reorganiza sin quedar fuera del viewport.
- Los controles muestran foco visible y respetan reducción de movimiento.
- Doble activación durante el envío no ejecuta una segunda comanda.

## Técnicos

- La regla de una orden vive en `packages/domain`, no dentro de componentes React.
- El proyecto define PWA manifest, icono y service worker de shell.
- No depende de fuentes, imágenes o scripts alojados fuera de la sucursal.
- Las pruebas offline de dominio pasan en Node 24.
- Después de instalar dependencias deben pasar `pnpm check`, `pnpm test` y `pnpm build`.

## Pendiente de validación física

- Modelo, resolución y escala real de ambas tablets.
- Sensación de toque, legibilidad a distancia de trabajo y aparición del teclado de Windows.
- Instalación PWA en Edge y recuperación después de cerrar/reabrir la aplicación.

