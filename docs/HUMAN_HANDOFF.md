# Human Handoff

Fecha: August 21, 2026

## Objetivo

Permitir control confiable BOT <-> HUMANO sin respuestas simultaneas ni perdida de contexto.

## Estados usados

- `ACTIVE`
  - el bot puede responder
- `WAITING_HUMAN`
  - el cliente ya pidio ayuda humana o el sistema escalo
  - el bot ya no sigue respondiendo
  - aun no hay asesor asignado
- `HUMAN`
  - un asesor tomo ownership de la conversacion
- `CLOSED`
  - conversacion cerrada

## Fuente de verdad

Se reutiliza `conversations.status` y se mantiene `isHandoff` por compatibilidad con el panel actual.

Campos clave:

- `status`
- `isHandoff`
- `handoffReason`
- `assignedAdminUserId`
- `takenAt`

## Ownership

Takeover manual:

- accion: `takeConversation`
- transicion: `WAITING_HUMAN -> HUMAN`
- efecto:
  - asigna `assignedAdminUserId`
  - registra `takenAt`
  - deja silenciado al bot

Return to bot:

- accion: `returnToBot`
- transicion: `HUMAN/WAITING_HUMAN -> ACTIVE`
- efecto:
  - limpia ownership humano
  - resuelve handoffs abiertos
  - conserva carrito, historial y pedido

Release:

- accion: `releaseConversation`
- transicion: `HUMAN -> WAITING_HUMAN`
- efecto:
  - libera ownership
  - sigue silenciado el bot

## Silencio del bot

El sistema corta en dos puntos:

1. al entrar un mensaje y detectar que la conversacion ya esta bajo control humano
2. justo antes de enviar cualquier respuesta automatica

Esto evita la carrera:

1. entra mensaje
2. IA empieza a procesar
3. asesor toma la conversacion
4. IA termina
5. bot intenta responder

En el paso 5 se reconsulta la conversacion y la respuesta automatica se descarta.

## Mensajes

Los mensajes ahora distinguen origen:

- `CUSTOMER`
- `BOT`
- `HUMAN`
- `SYSTEM`

Los mensajes enviados desde el panel en una conversacion tomada quedan registrados como `HUMAN`.

## Auditoria

Se agrego `conversation_audit_events` para registrar eventos como:

- `HANDOFF_REQUESTED`
- `CONVERSATION_TAKEN`
- `CONVERSATION_RELEASED`
- `RETURNED_TO_BOT`
- `CONVERSATION_CLOSED`
- `HUMAN_MESSAGE_SENT`

## Panel

El panel ahora puede mostrar:

- `Esperando`
- `En atencion`
- `Bot`

Y permite:

- tomar conversacion
- responder manualmente
- devolver al bot
- cerrar

## Limites actuales

- La arquitectura sigue siendo esencialmente single-tenant.
- No se implemento un modelo nuevo de colas, tickets o SLA.
- RBAC backend se apoya en identidad enviada por el proxy autenticado del panel.
