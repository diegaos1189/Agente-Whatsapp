# Cart Recovery

Fecha: August 21, 2026

## Flujo

Cart Active
→ Inactivity
→ Eligibility
→ Scheduled Check
→ Revalidation
→ Recovery Message
→ Customer Response
→ Resume Cart
→ Checkout

## Cart Active

El sistema considera carrito activo cuando la conversacion conserva estado comercial real en `conversations.context`:

- `orderFlow.cart` con items
- o `activeCart.items`
- y el flujo no esta en `IDLE`
- y `checkout.status` no es `ORDER_CREATED`

No se crea recovery para consultas como horario, menu o precios sin carrito.

## Inactivity

La inactividad no usa tiempo quemado en codigo.

Se configura en `business_settings`:

- `cartRecoveryEnabled`
- `cartRecoveryDelayMinutes`
- `cartRecoveryMaxAttempts`
- `cartRecoveryMessage`

La primera version usa maximo `1` intento por carrito.

## Eligibility

`canSendCartRecovery()` decide de forma deterministica.

Revisa:

- carrito activo
- feature flag habilitado
- intentos restantes
- conversacion no humana
- sin `isHandoff`
- sin opt-out del contacto
- sin pedido creado
- ventana tecnica de WhatsApp disponible

Si no cumple, se registra `RECOVERY_NOT_ELIGIBLE`.

## Scheduled Check

El backend reutiliza scheduler propio del proceso, igual que otras tareas de mantenimiento, pero con claim durable en base de datos para evitar doble envio en varias instancias.

La tabla `cart_recoveries` guarda:

- fingerprint del carrito
- hora programada
- ultimo mensaje del cliente
- intentos
- lease durable
- estado final

## Revalidation

Al retomar nunca se confirma un carrito viejo directamente.

Se reutiliza backend existente:

- `pricingService`
- `checkoutService`
- `productService`
- reglas actuales de delivery

Eso recalcula:

- precios
- promos vigentes
- disponibilidad
- delivery

## Recovery Message

Mensaje inicial conservador:

`Hola 👋 Dejaste un pedido pendiente. Si quieres, seguimos desde donde quedamos.`

No incluye detalle completo ni lenguaje agresivo.

## Customer Response

El sistema entiende respuestas de continuacion solo en contexto de recovery enviado:

- `hagale`
- `de una`
- `sigamos`
- `continuemos`
- `mande eso`
- `que tenia`
- `dele pues`

Y respuestas de cancelacion:

- `ya no`
- `dejelo asi`
- `cancele eso`
- `no voy a pedir`

Tambien soporta opt-out:

- `no me escriban`
- `no me escriba`
- `no quiero recordatorios`

## Resume Cart

Si el cliente responde, el backend no reconstruye desde memoria del modelo.

Retoma `conversations.context`, marca `RECOVERY_REPLIED` y vuelve a:

- resumir carrito
- recalcular pricing
- volver a checkout si ya estaba listo
- o seguir en el paso pendiente real

## Metrics

Se registran eventos en `conversation_audit_events`:

- `CART_ABANDONED`
- `RECOVERY_NOT_ELIGIBLE`
- `RECOVERY_SENT`
- `RECOVERY_REPLIED`
- `RECOVERY_CANCELLED`
- `RECOVERY_CONVERTED`

Esto deja base para analytics futuros sin construir dashboard todavia.
