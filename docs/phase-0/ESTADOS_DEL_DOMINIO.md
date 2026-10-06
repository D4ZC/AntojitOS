# Estados iniciales del dominio

Los nombres son contratos de trabajo. Sólo deben modificarse mediante una migración de código y datos.

## Cuenta de servicio

```text
open ──> awaiting_payment ──> paid ──> closed
  │              │
  └──────────────┴──────────> cancelled
```

- `open`: acepta productos, rondas y operaciones de mesa.
- `awaiting_payment`: total preparado; cambios requieren volver a `open` y auditarse.
- `paid`: pago confirmado e inventario/eventos generados.
- `closed`: ticket final emitido y cuenta fuera de operación.
- `cancelled`: terminación compensada con motivo y autorización cuando aplique.

## Artículo de orden

```text
pending ──> sent ──> cancelled
              │
              └────> fulfilled
```

- `pending`: editable y aún no comunicado a producción.
- `sent`: forma parte de una ronda confirmada; no se edita en sitio.
- `fulfilled`: producción lo terminó/entregó cuando exista KDS.
- `cancelled`: conserva el artículo original y la cancelación relacionada.

El prototipo de Fase 0 implementa `pending`, `sent` y el bloqueo de edición después del envío.

## Trabajo de impresión

```text
queued ──> claimed ──> printed
   │           │
   └───────────┴──> retry_wait ──> queued
                         │
                         └───────> failed
```

`printed` significa confirmación del agente, no garantía física absoluta. Una reimpresión crea otro trabajo relacionado y requiere permiso.

## Turno de caja

```text
open ──> counting ──> closed
  │
  └────────────────> force_closed
```

- `open`: recibe pagos y movimientos.
- `counting`: bloquea nuevos movimientos mientras se declara efectivo.
- `closed`: diferencias calculadas y cierre inmutable.
- `force_closed`: contingencia con autorización y motivo.

## Pago

```text
initiated ──> authorized ──> captured
     │              │            │
     └──────────────┴────────────> failed
                                  │
                                  └────────> refunded
```

Efectivo puede pasar de `initiated` a `captured` dentro de una misma transacción. Una devolución no borra el pago capturado.

## Reglas de transición

- Toda transición acepta una clave idempotente.
- Las transiciones sensibles exigen versión esperada de la entidad.
- Estados finales no se reabren modificando filas; se ejecuta una operación explícita y auditada.
- La interfaz no decide validez: solicita comandos y representa el resultado del servidor.

