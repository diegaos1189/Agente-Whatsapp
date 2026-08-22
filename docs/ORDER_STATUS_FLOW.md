# ORDER_STATUS_FLOW

Fecha de actualizacion: August 21, 2026

## Objetivo

Responder consultas como:

- `¿donde esta mi pedido?`
- `¿como va?`
- `¿ya salio?`
- `¿cuanto falta?`
- `¿ya puedo pasar?`

sin inventar estado, ubicacion ni tiempo.

## Flujo real

1. Cliente pregunta por estado en texto o audio.
2. Si es audio, se transcribe y entra a la misma pipeline textual.
3. `intentClassifier` puede clasificar `ORDER_STATUS`, `ASK_ETA` o follow-up corto.
4. `conversationService` llama `orderStatusService`.
5. `orderStatusService` resuelve el pedido asi:
   - codigo explicito `POL-...` si viene en el mensaje
   - pedido referenciado previamente en contexto (`lastReferencedOrderId`)
   - unico pedido activo del contacto
   - si hay varios activos, pide aclaracion
   - si no hay activos, revisa pedidos recientes
6. La consulta siempre esta scoped por `contactId`.
7. El backend traduce el estado interno a una respuesta natural.
8. Si hay ETA backend suficientemente confiable, la incluye.
9. Si hay demora evidente o inconsistencia fuerte, hace handoff usando la infraestructura ya existente.

## Estados soportados

- `AWAITING_PAYMENT`
  - `Tu pedido POL-XXX esta esperando confirmacion de pago.`
- `RECEIVED`
  - `Tu pedido POL-XXX esta en preparacion.`
- `READY` + `PICKUP`
  - `Tu pedido POL-XXX ya esta listo para recoger.`
- `READY` + `DELIVERY`
  - `Tu pedido POL-XXX ya esta listo y esta esperando despacho.`
- `ON_THE_WAY`
  - `Tu pedido POL-XXX ya salio para entrega.`
- `DELIVERED`
  - `Tu pedido POL-XXX aparece como entregado.`
- `CANCELLED`
  - `Tu pedido POL-XXX fue cancelado.`

## Ownership

- La consulta nunca busca un pedido global por codigo sin scope.
- `getOrderByCodeForContact(...)` y `getOrderByIdForContact(...)` siempre filtran por `contactId`.
- En el estado actual del proyecto no existe un modelo multi-tenant explicito; la proteccion real aplicada en este P1 es por contacto dentro del tenant unico actual.

## ETA

- No existen columnas dedicadas tipo `estimatedReadyAt` o `estimatedDeliveryAt`.
- Para pedidos en `RECEIVED`:
  - `PICKUP`: se reutiliza `business_settings.estimatedPrepMinutes`
  - `DELIVERY`: se reutiliza `estimateDeliveryMinutes(...)`
- El backend calcula minutos restantes aproximados usando tiempo transcurrido real del pedido.
- Para estados donde no hay dato suficientemente confiable (`READY`, `ON_THE_WAY`, etc.), se responde que no hay tiempo exacto actualizado.

## Demoras

- Si un pedido sigue en `RECEIVED` despues del tiempo estimado backend, se marca como retrasado.
- En ese caso el bot responde el estado real y luego activa handoff.

## Inconsistencia entregado vs cliente

- Si el ultimo pedido referenciado aparece `DELIVERED` y el cliente dice `no me llego`, el bot:
  - reconoce la inconsistencia
  - responde con empatia
  - activa handoff

## Panel y transiciones

- El panel existente no se reescribio.
- El endpoint `PATCH /api/orders/:id/status` ahora valida transiciones invalidas obvias, por ejemplo:
  - `RECEIVED -> READY`
  - `READY -> ON_THE_WAY`
  - `READY -> DELIVERED` para pickup
  - `ON_THE_WAY -> DELIVERED`
- Se bloquean casos como:
  - `DELIVERED -> RECEIVED`
  - `CANCELLED -> ON_THE_WAY`

## Contexto conversacional

- Se guarda:
  - `lastReferencedOrderId`
  - `lastReferencedOrderCode`
- Esto permite follow-ups como:
  - `¿y ahora?`
  - `¿ya salio?`
  - `¿cuanto falta?`

## Seguridad

- No se expone direccion completa salvo lo ya visible operacionalmente en el sistema actual.
- No se exponen notas internas ni ids internos.
- No se expone telefono del domiciliario ni tracking inventado.
