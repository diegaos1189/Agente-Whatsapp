# WhatsApp Audio Flow

Fecha: August 21, 2026

## Objetivo

Procesar notas de voz de WhatsApp sin crear una logica conversacional paralela.

Flujo final:

WhatsApp Audio
-> Webhook
-> Idempotencia por `waMessageId`
-> Cola serializada por `contactId`
-> Download
-> Validate
-> Transcribe
-> Normalized Text
-> Existing Conversation Pipeline

## Arquitectura

### 1. Recepcion

`apps/api/src/routes/whatsapp.webhook.ts`

- Meta entrega `messages[].audio.id` y `messages[].audio.mime_type`.
- El webhook normaliza a `type = AUDIO`.
- Antes de cualquier negocio se aplica idempotencia por `waMessageId`.

### 2. Serializacion

`apps/api/src/modules/conversation/contactMessageProcessingCoordinator.ts`

- El audio se encola igual que cualquier otro mensaje.
- Se procesa en orden real por `contactId`.
- Un texto posterior espera a que el audio anterior termine de descargarse/transcribirse/aplicarse.
- Si la transcripcion falla, el mensaje se cierra con fallback y la conversacion no queda bloqueada.

### 3. Download

`apps/api/src/modules/whatsapp/whatsappClient.ts`

- Se pide metadata temporal a Meta Graph API.
- Luego se descarga el archivo con timeout configurable.
- Se capturan:
  - `mimeType`
  - `byteLength`
  - `contentLength` si Meta lo entrega
  - `fileSize` si Meta lo reporta en metadata

### 4. Validacion

`apps/api/src/modules/conversation/whatsappAudioService.ts`

Se valida:

- MIME permitido
- tamano maximo
- duracion maxima solo si el proveedor la reporta

Estados posibles:

- `READY`
- `DOWNLOAD_FAILED`
- `UNSUPPORTED_MIME`
- `TOO_LARGE`
- `TOO_LONG`
- `TRANSCRIPTION_FAILED`
- `EMPTY_TRANSCRIPT`

### 5. Transcripcion

Proveedor reutilizado segun `AI_PROVIDER`:

- OpenAI
- Gemini

`apps/api/src/modules/ai/aiClient.ts`

La transcripcion ocurre antes del agente y devuelve resultado estructurado:

- `text`
- `language`
- `durationSeconds`
- `provider`
- `retryable`
- `errorCode`

### 6. Reuso de la pipeline textual

`apps/api/src/modules/conversation/conversationService.ts`

Cuando el audio queda en `READY`, su texto transcrito se manda directamente a:

- `handleTextMessage(...)`

Con eso el sistema reutiliza:

- clasificacion de intent
- extraccion de entidades
- carrito estructurado
- catalogo real
- pricing backend
- checkout seguro
- repeat order
- handoff

## Errores Y Retries

### Retry

- Retry limitado por `AUDIO_TRANSCRIPTION_MAX_RETRIES`
- Timeout por intento con `AUDIO_TRANSCRIPTION_TIMEOUT_MS`
- No hay retries infinitos

### Fallback

Si el audio no se puede procesar:

- se guarda el mensaje inbound
- se deja metadata de error en `messages.raw`
- se responde con fallback controlado
- se libera la cola serializada

## Handoff Humano

Si la conversacion ya esta en:

- `WAITING_HUMAN`
- `HUMAN`

Entonces:

- el audio se guarda
- el bot no lo procesa automaticamente

## Privacidad Y Archivos

- No se crean archivos temporales persistentes en disco.
- La descarga vive en memoria y se envía al proveedor de transcripcion.
- Actualmente el sistema conserva el `mediaUrl` inline en la tabla `messages`, porque ese ya era el mecanismo existente para que el panel pueda mostrar el media.
- La metadata de transcripcion queda en `messages.raw`.

## Variables De Entorno

En `apps/api/.env.example`:

- `AUDIO_TRANSCRIPTION_TIMEOUT_MS`
- `AUDIO_TRANSCRIPTION_MAX_RETRIES`
- `MAX_WHATSAPP_AUDIO_SIZE_BYTES`
- `MAX_WHATSAPP_AUDIO_DURATION_SECONDS`
- `ALLOWED_WHATSAPP_AUDIO_MIME_TYPES`
- `WHATSAPP_MEDIA_DOWNLOAD_TIMEOUT_MS`
