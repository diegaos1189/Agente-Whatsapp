/**
 * Contrato de payloads salientes hacia n8n.
 * Ver docs/N8N_INTEGRATION.md para el detalle de cada webhook y ejemplos.
 */
export interface N8nOrderItemPayload {
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  notes: string | null;
}

export interface N8nOrderCreatedPayload {
  event: "order.created";
  order_id: string;
  order_code: string;
  customer_name: string | null;
  phone: string;
  items: N8nOrderItemPayload[];
  total: number;
  delivery_fee: number;
  payment_method: string | null;
  delivery_type: string;
  address: string | null;
  neighborhood: string | null;
  reference: string | null;
  created_at: string;
}

export interface N8nPaymentReminderPayload {
  event: "payment.reminder";
  order_id: string;
  order_code: string;
  phone: string;
  total: number;
  payment_method: string | null;
}

export interface N8nOperatorNotificationPayload {
  event: "operator.notification";
  order_id: string;
  order_code: string;
  phone: string;
  reason: "new_order" | "handoff" | "complaint";
  message: string;
}

export interface N8nHandoffPayload {
  event: "conversation.handoff";
  conversation_id: string;
  phone: string;
  customer_name: string | null;
  reason: string;
  last_message: string | null;
}

export type N8nOutboundPayload =
  | N8nOrderCreatedPayload
  | N8nPaymentReminderPayload
  | N8nOperatorNotificationPayload
  | N8nHandoffPayload;
