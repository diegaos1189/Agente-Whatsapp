# PERFORMANCE_REPORT

Fecha: August 21, 2026

## Alcance

Mediciones locales razonables durante la certificacion. No se probo ni se impacto produccion.

## Resultados observados

### Suite API

- `pnpm --filter @pollos/api test`
  - 178 tests
  - duracion observada: ~4.2s a ~6.8s local

### Golden Conversations

- 30 conversaciones golden
- duracion observada dentro de la suite: ~118ms a ~122ms

### Build / lint

- `pnpm --filter @pollos/api build`
  - ~28s a ~31s local
- `pnpm --filter @pollos/api lint`
  - ~29s local
- `pnpm --filter @pollos/admin lint`
  - ~5s a ~21s local segun cache

### Admin build

- Sigue fallando localmente por problema preexistente de Next/node_modules:
  - `EISDIR: illegal operation on a directory, readlink 'E:\\agent whatsapp\\node_modules\\next\\dist\\pages\\_app.js'`

## Concurrencia funcional verificada

- Mismo contacto:
  - orden estricto A -> B -> C validado por tests de `contactMessageProcessingCoordinator`
- Contactos distintos:
  - procesamiento en paralelo validado por tests existentes

## Latencia por etapa

No existe hoy tracing distribuido ni metricas persistentes por span, asi que solo se puede estimar por inspeccion y logs:

- webhook receive:
  - rapido; responde `200` antes del procesamiento pesado
- queue delay:
  - depende del lease y backlog por contacto
- AI latency:
  - es potencialmente el mayor cuello de botella
- audio transcription:
  - acotado por timeout configurable
- DB:
  - Prisma + Postgres, sin evidencia de cuello fuerte en esta auditoria
- WhatsApp outbound:
  - depende de Meta; fallos se loguean

## Cuellos de botella probables

1. Clasificacion / extraccion IA
2. Transcripcion de audio
3. Descarga de media desde Meta
4. Build del panel local por problema de entorno

## N+1 / query shape

- No se detecto un problema N+1 critico en la ruta central de pedido.
- Hay includes razonables en conversations/orders.
- No se hizo profiling SQL exhaustivo con datos productivos.

## Recomendaciones

1. Agregar metricas por etapa:
   - `webhook_received`
   - `inbound_queue_claimed`
   - `ai_classification_ms`
   - `audio_transcription_ms`
   - `checkout_validation_ms`
   - `order_creation_ms`
   - `whatsapp_outbound_ms`
2. Medir backlog de `inbound_whatsapp_messages`.
3. Ejecutar benchmark controlado de 10 y 25 conversaciones concurrentes cuando exista harness dedicado.
4. Resolver el problema local del build del admin para recuperar señal CI completa.
