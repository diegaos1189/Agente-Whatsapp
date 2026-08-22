# WhatsApp Message Processing

Fecha: August 21, 2026

## Objetivo

Garantizar dos cosas al mismo tiempo:

1. Idempotencia por `waMessageId`
2. Procesamiento serializado por `contactId`

sin depender de memoria local de proceso.

## Arquitectura Implementada

Flujo actual:

1. Llega webhook de Meta a `apps/api/src/routes/whatsapp.webhook.ts`
2. Se valida firma HMAC si aplica
3. Se reclama idempotencia persistente por `waMessageId`
4. Si no es duplicado, se llama `handleIncomingMessage(...)`
5. `handleIncomingMessage(...)` resuelve el `contactId`
6. El mensaje se encola en `inbound_whatsapp_messages`
7. El coordinador durable intenta adquirir lease de contacto en `contact_message_processing_leases`
8. Si obtiene lease:
   - reclama el siguiente mensaje pendiente del contacto
   - lo marca `PROCESSING`
   - ejecuta el procesamiento real del agente
   - marca `PROCESSED` o `FAILED`
   - sigue con el siguiente del mismo contacto
9. Si no obtiene lease:
   - no procesa en paralelo
   - otra instancia o proceso ya esta trabajando esa cola

## Idempotencia

La idempotencia sigue basada en `waMessageId`.

Tabla:

- `processed_whatsapp_messages`

Regla:

- el mismo `waMessageId` solo debe reclamarse una vez

Esto protege contra:

- retries de Meta
- doble entrega del mismo webhook
- multiples instancias

## Serializacion

La serializacion ya no usa `Map` en memoria.

Tablas nuevas:

- `inbound_whatsapp_messages`
- `contact_message_processing_leases`

Clave de serializacion elegida:

- `contactId`

Por que `contactId`:

- en la arquitectura actual es estable y unico dentro del sistema
- evita depender del numero de telefono como lock primario
- encaja mejor con conversaciones activas, pedidos e historial ya relacionados al contacto

## Criterio De Orden

El criterio principal de orden es:

- `inbound_whatsapp_messages.id` autoincremental

Por que:

- es monotono dentro de PostgreSQL
- no depende del orden de resolucion de Promises
- no depende de precision ni empates del timestamp de WhatsApp
- es el criterio mas confiable para el orden de persistencia real en nuestro sistema

El `providerTimestamp` de WhatsApp se conserva para trazabilidad, pero no gobierna el orden final de ejecucion.

## Recuperacion

La recuperacion se basa en leases con expiracion:

- `contact_message_processing_leases.leaseExpiresAt`
- `inbound_whatsapp_messages.leaseExpiresAt`

Si una instancia muere:

- el lease expira
- otra instancia puede reclamar el contacto
- un mensaje que haya quedado en `PROCESSING` con lease vencida puede reclamarse otra vez

Esto evita locks permanentes.

## Estados De Mensaje Entrante

Estados usados en `inbound_whatsapp_messages.processingStatus`:

- `PENDING`
- `PROCESSING`
- `PROCESSED`
- `FAILED`

Campos de soporte:

- `attempts`
- `processingStartedAt`
- `processedAt`
- `lastError`
- `leaseExpiresAt`

## Concurrencia

Mensajes del mismo contacto:

- siempre uno a la vez
- siempre en orden de cola persistida

Mensajes de contactos distintos:

- pueden procesarse en paralelo

## Acciones Humanas

Las acciones humanas que mutan el contexto del pedido tambien quedaron serializadas por `contactId`, para no competir con los mensajes entrantes:

- pedir direccion desde panel
- guardar pedido pendiente
- confirmar pedido pendiente con IA

## Limitaciones Actuales

- el sistema sigue siendo single-tenant en la practica; si en el futuro se agrega multitenancy real, la clave ideal deberia evolucionar a `tenantId + contactId`
- el reorder automatico de mensajes `FAILED` queda soportado tecnicamente, pero aun no existe una politica avanzada de backoff o maximo de reintentos
