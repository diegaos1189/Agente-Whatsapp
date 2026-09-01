export const OrderStatus = {
  // Solo para pedidos pagados por transferencia: espera a que un humano confirme que la
  // plata realmente llego antes de pasar a preparacion (evita empezar a cocinar un pedido
  // que nunca se pago).
  AWAITING_PAYMENT: "AWAITING_PAYMENT",
  RECEIVED: "RECEIVED", // pedido recibido, en preparacion
  READY: "READY", // listo, buscando/esperando domiciliario
  ON_THE_WAY: "ON_THE_WAY", // domiciliario ya lo recogio, en reparto
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const DeliveryType = {
  DELIVERY: "DELIVERY",
  PICKUP: "PICKUP",
} as const;
export type DeliveryType = (typeof DeliveryType)[keyof typeof DeliveryType];

export const PaymentMethod = {
  CASH: "CASH",
  TRANSFER: "TRANSFER",
  CARD_ON_DELIVERY: "CARD_ON_DELIVERY",
  CARD: "CARD",
  BANK_TRANSFER: "BANK_TRANSFER",
  ONLINE_PAYMENT: "ONLINE_PAYMENT",
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentStatus = {
  PENDING: "PENDING",
  REPORTED: "REPORTED",
  PROCESSING: "PROCESSING",
  AUTHORIZED: "AUTHORIZED",
  PAID: "PAID",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
  REFUNDED: "REFUNDED",
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const ConversationStatus = {
  ACTIVE: "ACTIVE",
  WAITING_HUMAN: "WAITING_HUMAN",
  HUMAN: "HUMAN",
  CLOSED: "CLOSED",
} as const;
export type ConversationStatus = (typeof ConversationStatus)[keyof typeof ConversationStatus];

export const MessageDirection = {
  INBOUND: "INBOUND",
  OUTBOUND: "OUTBOUND",
} as const;
export type MessageDirection = (typeof MessageDirection)[keyof typeof MessageDirection];

export const MessageType = {
  TEXT: "TEXT",
  IMAGE: "IMAGE",
  AUDIO: "AUDIO",
  TEMPLATE: "TEMPLATE",
  SYSTEM: "SYSTEM",
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export const HandoffReason = {
  CUSTOMER_REQUEST: "CUSTOMER_REQUEST",
  COMPLAINT: "COMPLAINT",
  LOW_CONFIDENCE: "LOW_CONFIDENCE",
  PAYMENT_ISSUE: "PAYMENT_ISSUE",
  ORDER_PROBLEM: "ORDER_PROBLEM",
  DELIVERY_PROBLEM: "DELIVERY_PROBLEM",
  AI_FAILURE: "AI_FAILURE",
  SYSTEM_ERROR: "SYSTEM_ERROR",
  OTHER: "OTHER",
  AGENT_MANUAL: "AGENT_MANUAL",
} as const;
export type HandoffReason = (typeof HandoffReason)[keyof typeof HandoffReason];

export const Intent = {
  GREETING: "GREETING",
  VIEW_MENU: "VIEW_MENU",
  ASK_PRICE: "ASK_PRICE",
  ASK_PROMOTIONS: "ASK_PROMOTIONS",
  ORDER_PRODUCT: "ORDER_PRODUCT",
  ASK_DELIVERY: "ASK_DELIVERY",
  ASK_ETA: "ASK_ETA",
  ORDER_STATUS: "ORDER_STATUS",
  HUMAN_HANDOFF: "HUMAN_HANDOFF",
  COMPLAINT: "COMPLAINT",
  PROVIDE_INFO: "PROVIDE_INFO",
  CONFIRM: "CONFIRM",
  CANCEL: "CANCEL",
  UNKNOWN: "UNKNOWN",
} as const;
export type Intent = (typeof Intent)[keyof typeof Intent];

/** Tipo de regla de recomendacion backend->backend (nunca elegida por la IA). Generico
 * para cualquier tipo de negocio de comida, no depende de una categoria de producto fija. */
export const RecommendationType = {
  UPSELL: "UPSELL", // version mas grande/mejor del mismo producto o categoria
  CROSS_SELL: "CROSS_SELL", // producto complementario de otra categoria
  ADD_ON: "ADD_ON", // extra/adicional pequeno
} as const;
export type RecommendationType = (typeof RecommendationType)[keyof typeof RecommendationType];

export const OrderFlowStep = {
  IDLE: "IDLE",
  COLLECTING_ITEMS: "COLLECTING_ITEMS",
  ASK_QUANTITY_OR_SIZE: "ASK_QUANTITY_OR_SIZE",
  ASK_SIDES: "ASK_SIDES",
  ASK_DRINKS: "ASK_DRINKS",
  ASK_MORE_ITEMS: "ASK_MORE_ITEMS",
  ASK_DELIVERY_TYPE: "ASK_DELIVERY_TYPE",
  ASK_ADDRESS: "ASK_ADDRESS",
  ASK_PAYMENT_METHOD: "ASK_PAYMENT_METHOD",
  CONFIRMING: "CONFIRMING",
  DONE: "DONE",
} as const;
export type OrderFlowStep = (typeof OrderFlowStep)[keyof typeof OrderFlowStep];
