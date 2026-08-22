# FINAL_SYSTEM_MAP

Fecha: August 21, 2026

## Resumen

Sistema auditado: agente de WhatsApp existente en produccion para toma y seguimiento de pedidos de restaurante.

Stack real encontrado:

- Backend: Fastify 5 + TypeScript
- ORM/DB: Prisma 5 + PostgreSQL
- Admin/panel: Next.js 14 + React 18
- IA: OpenAI o Gemini segun configuracion
- WhatsApp: Meta Cloud API o adaptador `mock`
- Automatizaciones externas: n8n webhooks
- Cola/serializacion: base de datos + leases por contacto
- Cache: cache corta de settings/cliente de WhatsApp derivada desde backend; no Redis

## Flujo principal real

1. Cliente envia mensaje por WhatsApp.
2. Meta llama `POST /webhooks/whatsapp`.
3. El backend valida firma HMAC si `whatsappAppSecret` esta configurado.
4. `parseMetaWebhookPayload(...)` normaliza texto, imagen, audio y metadatos.
5. `incomingWhatsAppMessageIdempotencyService` intenta reclamar `waMessageId`.
6. Si no es duplicado:
   - marca leido / typing
   - llama `handleIncomingMessage(...)`
7. `handleIncomingMessage(...)`:
   - resuelve/crea `Contact`
   - encola en `inbound_whatsapp_messages`
   - drena por contacto usando `contactMessageProcessingCoordinator`
8. `processIncomingQueuedMessage(...)`:
   - crea/recupera `Conversation`
   - guarda `Message` inbound
   - descarga media si aplica
   - si la conversacion esta en handoff humano, no deja responder al bot
9. Si es audio:
   - `whatsappAudioService`
   - validacion MIME/tamano/timeout/retry
   - transcripcion via proveedor IA
   - reingresa como texto a `handleTextMessage(...)`
10. Si es imagen:
   - descripcion/transcripcion segun caso
   - comprobantes pueden influir en flujo de pago
11. `handleTextMessage(...)`:
   - obtiene historial reciente
   - obtiene `BusinessSettings`
   - parsea contexto persistido en `conversations.context`
   - clasifica intencion con IA
   - extrae entidades con IA
   - aplica guardrails conversacionales
12. Resolucion de negocio:
   - menu/categoria/promociones/FAQ
   - carrito estructurado
   - reorder seguro
   - order status desde backend
   - checkout/pricing
13. Si el turno confirma pedido:
   - `prepareCheckoutSummary(...)`
   - `createOrder(...)`
   - persistencia transaccional en `orders`, `order_items`, `payments`, `order_events`
14. Respuesta outbound:
   - `sendAndLog(...)`
   - proveedor WhatsApp
   - log de `Message` outbound
15. Si hay handoff:
   - `Conversation` cambia a `WAITING_HUMAN` / `HUMAN`
   - se crea `Handoff`
   - n8n recibe notificacion

## Capas y servicios reales

### Entry points

- API bootstrap: `apps/api/src/app.ts`
- Server startup: `apps/api/src/server.ts`
- Admin app: `apps/admin/src/app`

### Webhook / WhatsApp

- Route: `apps/api/src/routes/whatsapp.webhook.ts`
- Types/parser: `apps/api/src/modules/whatsapp/whatsappTypes.ts`
- Provider client: `apps/api/src/modules/whatsapp/whatsappClient.ts`
- Idempotencia inbound: `apps/api/src/modules/whatsapp/incomingWhatsAppMessageIdempotencyService.ts`

### Conversation / orchestration

- Servicio principal: `apps/api/src/modules/conversation/conversationService.ts`
- Serializacion durable: `apps/api/src/modules/conversation/contactMessageProcessingCoordinator.ts`
- Handoff / ownership: `apps/api/src/modules/conversation/conversationHandoff.ts`
- Audio hardening: `apps/api/src/modules/conversation/whatsappAudioService.ts`
- Estado de pedido: `apps/api/src/modules/conversation/orderStatusService.ts`
- Reorder: `apps/api/src/modules/conversation/repeatOrder.ts`
- Carrito estructurado: `apps/api/src/modules/conversation/structuredCart.ts`
- Flujo de pedido: `apps/api/src/modules/conversation/orderFlow.ts`

### IA

- Cliente/abstraccion: `apps/api/src/modules/ai/aiClient.ts`
- Intent classifier: `apps/api/src/modules/ai/intentClassifier.ts`
- Entity extractor: `apps/api/src/modules/ai/entityExtractor.ts`
- Response generator: `apps/api/src/modules/ai/responseGenerator.ts`
- Providers: `apps/api/src/modules/ai/providers/openai.ts`, `gemini.ts`

### Catalogo / pricing / checkout / orders

- Productos y promociones: `apps/api/src/modules/products/productService.ts`
- Pricing deterministico: `apps/api/src/modules/orders/pricingService.ts`
- Checkout seguro: `apps/api/src/modules/orders/checkoutService.ts`
- Orders y eventos: `apps/api/src/modules/orders/orderService.ts`

### Business / settings / metrics / jobs

- Settings/horarios: `apps/api/src/modules/business/businessHoursService.ts`
- Metrics: `apps/api/src/modules/metrics/metricsService.ts`
- Archive job: `apps/api/src/modules/scheduler/dailyArchive.ts`
- n8n integration: `apps/api/src/modules/n8n/n8nClient.ts`

### Admin / panel

- Auth/session: `apps/admin/src/lib/auth.ts`, `session.ts`, `authConstants.ts`
- Middleware: `apps/admin/src/middleware.ts`
- Proxy to API: `apps/admin/src/app/api/proxy/[...path]/route.ts`
- Conversations UI: `apps/admin/src/app/(dashboard)/conversations`
- Orders UI: `apps/admin/src/app/(dashboard)/orders`
- Kitchen UI: `apps/admin/src/app/(dashboard)/kitchen`

## Modelos de datos reales

### Conversacion

- `Contact`
- `Conversation`
- `Message`
- `ProcessedWhatsAppMessage`
- `InboundWhatsAppMessage`
- `ContactMessageProcessingLease`
- `Handoff`
- `ConversationAuditEvent`

### Catalogo

- `Category`
- `Product`
- `Promotion`
- `Faq`

### Cliente / direccion

- `Address`

### Pedidos / pagos

- `Order`
- `OrderItem`
- `Payment`
- `OrderEvent`

### Admin

- `AdminUser`
- `BusinessSettings`

## Idempotencia real

- Primer nivel: `processed_whatsapp_messages.providerMessageId` unique.
- Fallback: cache en memoria en el proceso actual.
- Checkout/order idempotency:
  - `orders.confirmationId` unique
  - resumen de checkout rota cuando cambia fingerprint o pricing

## Serializacion real

- No se usa Redis ni cola externa.
- Se usa:
  - `inbound_whatsapp_messages`
  - `contact_message_processing_leases`
- Garantias:
  - mismo contacto: orden estricto
  - contactos distintos: pueden procesar en paralelo

## Audio real

- Se detecta desde webhook.
- Se descarga media real desde Meta si aplica.
- Se valida:
  - MIME permitido
  - tamano maximo
  - timeout
  - retries acotados
- El texto transcrito vuelve a la misma pipeline textual.

## Status real

- Estados internos actuales:
  - `AWAITING_PAYMENT`
  - `RECEIVED`
  - `READY`
  - `ON_THE_WAY`
  - `DELIVERED`
  - `CANCELLED`
- Historial:
  - `order_events`
- Cambio de estado:
  - panel admin
  - cocina
  - confirmacion de pago
  - backend

## Human handoff real

- Estados:
  - `ACTIVE`
  - `WAITING_HUMAN`
  - `HUMAN`
  - `CLOSED`
- El bot no responde automaticamente si:
  - `isHandoff = true`
  - `status = WAITING_HUMAN`
  - `status = HUMAN`

## Seguridad real

- API admin protegida por bearer `ADMIN_API_TOKEN`
- Webhook de Meta con HMAC opcional
- Panel con cookie firmada por `SESSION_SECRET`
- Rate limiting global + login rate limit
- Validacion con Zod en rutas criticas

## Observabilidad real

- Logger: pino
- Logs de errores en webhook, audio, serializacion, outbound
- Audit trail de handoff/takeover/release en `conversation_audit_events`
- No existe hoy una plataforma externa dedicada de tracing/metrics

## Healthchecks reales

- `GET /health`
- Desde esta auditoria:
  - verifica API viva
  - verifica DB via `SELECT 1`
  - expone estado de config WhatsApp/AI de forma barata

## Limitaciones reales encontradas

- No existe modelo multi-tenant explicito en el schema actual.
- `messages.mediaUrl` sigue guardando media inline como data URL.
- No hay ETA geolocalizado ni tracking en vivo.
- No hay Redis/queue externa ni outbox formal.
- El backend usa un bearer token compartido entre panel y API, no sesiones backend por usuario.
