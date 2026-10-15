# Fase 3: producción e impresión confiable

## Objetivo

Convertir cada ronda confirmada en intenciones durables de producción, separadas por centro, visibles en KDS y entregables a una impresora ESC/POS sin perder trazabilidad durante fallos o reintentos.

## Alcance

- Enrutamiento de artículos por centro de producción.
- Comanda inmutable por ronda y centro con productos, modificadores y notas.
- Comanda diferenciada de alta y cancelación.
- KDS táctil con estados pendiente, en preparación, listo y entregado.
- Indicador de antigüedad y alerta visual después de diez minutos.
- Cola de impresión durable con concesión temporal, confirmación y hasta cinco intentos.
- Recuperación automática de trabajos cuya concesión expiró.
- Registro independiente de cada intento de impresión.
- Reimpresión como trabajo nuevo, con permiso, motivo e identidad del solicitante.
- Agente local independiente con salida simulada o conexión TCP ESC/POS.
- Registro del agente mediante secreto de instalación y asignación a centros.

## Garantía operativa

AntojitOS garantiza exactamente una **intención original** de impresión por comanda. Una impresora ESC/POS convencional no siempre puede confirmar físicamente si terminó de imprimir después de recibir bytes; por ello un corte exactamente en ese punto puede requerir revisión humana. Las reimpresiones siempre son intenciones nuevas y auditadas.

## Criterios de aceptación

- Una ronda con productos de cocina y barra produce dos comandas independientes.
- La creación de ronda, comandas, trabajos y outbox ocurre en una sola transacción.
- Un doble toque o repetición idempotente no crea otra intención original.
- El KDS conserva modificadores, notas, mesa y secuencia de ronda.
- Dos pantallas no pueden retroceder ni sobrescribir el estado de una comanda.
- Un trabajo no confirmado vuelve a estar disponible cuando expira su concesión.
- Una falla de impresión conserva el mismo trabajo e incrementa su intento.
- Después del máximo de intentos el trabajo queda fallido para intervención.
- Una reimpresión exige motivo y conserva referencia al trabajo original.
- Una cancelación enviada crea una comanda y trabajo diferenciados.
- El simulador genera una representación legible y los bytes ESC/POS.
- `pnpm check`, `pnpm test` y `pnpm build` terminan correctamente.

## Fuera de alcance

- Certificación de un modelo físico específico hasta conocer marca, modelo e interfaz.
- Impresión USB directa; el primer adaptador real usa TCP 9100.
- Balanceo automático avanzado entre varias impresoras.
- Edición visual de agentes, rutas e impresoras.
- Métricas históricas completas de tiempos de cocina.

