# Integracion con n8n

El backend nunca depende de n8n para funcionar (si las URLs no estan configuradas, solo loguea localmente). n8n es para automatizaciones adicionales: notificar al operador, recordar pagos pendientes, registrar en Google Sheets, etc.

Contratos de payload en `packages/shared/src/n8n.ts` (tipados, compartidos entre backend y cualquier consumidor). El cliente que dispara los webhooks esta en `apps/api/src/modules/n8n/n8nClient.ts`.

## Variables de entorno (`apps/api/.env`)

```
N8N_WEBHOOK_URL_ORDER_CREATED=
N8N_WEBHOOK_URL_PAYMENT_REMINDER=
N8N_WEBHOOK_URL_OPERATOR_NOTIFICATION=
N8N_WEBHOOK_URL_HANDOFF=
```

Cada una es la URL de un **Webhook node** de un workflow distinto en n8n. Vacio = desactivado (solo log).

## Eventos y payloads

### `order.created` → `N8N_WEBHOOK_URL_ORDER_CREATED`

Se dispara cada vez que se crea un pedido desde el flujo de WhatsApp.

```json
{
  "event": "order.created",
  "order_id": "clx...",
  "order_code": "POL-ABC123-XYZ",
  "customer_name": "Juan Perez",
  "phone": "573000000000",
  "items": [
    { "productName": "Pollo Frito 8 piezas", "quantity": 1, "unitPrice": 52000, "subtotal": 52000, "notes": null }
  ],
  "total": 57000,
  "delivery_fee": 5000,
  "payment_method": "TRANSFER",
  "delivery_type": "DELIVERY",
  "address": "Calle 1 # 2-3",
  "neighborhood": "Centro",
  "reference": "Casa azul",
  "created_at": "2026-07-30T20:00:00.000Z"
}
```

Workflow sugerido en n8n: registrar la fila en Google Sheets, notificar por Slack/Telegram a cocina, o imprimir comanda via integracion con impresora.

### `operator.notification` → `N8N_WEBHOOK_URL_OPERATOR_NOTIFICATION`

Se dispara junto con `order.created` (nuevo pedido) y puede usarse para otros avisos internos.

```json
{
  "event": "operator.notification",
  "order_id": "clx...",
  "order_code": "POL-ABC123-XYZ",
  "phone": "573000000000",
  "reason": "new_order",
  "message": "Nuevo pedido POL-ABC123-XYZ por 57000"
}
```

### `payment.reminder` → `N8N_WEBHOOK_URL_PAYMENT_REMINDER`

Se dispara cuando el cliente reporta un pago por transferencia (manda foto de comprobante). Util para que n8n dispare un recordatorio si el pago no se confirma en X minutos, o para notificar a caja que valide.

```json
{
  "event": "payment.reminder",
  "order_id": "clx...",
  "order_code": "POL-ABC123-XYZ",
  "phone": "573000000000",
  "total": 57000,
  "payment_method": "TRANSFER"
}
```

### `conversation.handoff` → `N8N_WEBHOOK_URL_HANDOFF`

Se dispara cada vez que una conversacion se escala a un humano (palabra clave, queja, o 2 intentos fallidos).

```json
{
  "event": "conversation.handoff",
  "conversation_id": "clx...",
  "phone": "573000000000",
  "customer_name": "Juan Perez",
  "reason": "CUSTOMER_REQUEST",
  "last_message": "quiero hablar con un asesor"
}
```

Workflow sugerido: notificar por WhatsApp/Telegram/Slack al equipo de atencion en tiempo real.

## Levantar n8n localmente

Ya esta incluido en `infra/docker-compose.yml` (servicio `n8n`, puerto `5678`). Corre `npm run docker:up` y entra a `http://localhost:5678` para crear los workflows con **Webhook nodes** en las URLs que configures en `apps/api/.env`.
