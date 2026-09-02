import { DeliveryType, HandoffReason, OrderStatus } from "@pollos/shared";
import {
  estimateDeliveryMinutes,
  getActiveOrdersForContact,
  getOrderByCodeForContact,
  getOrderByIdForContact,
  getRecentOrdersForContact,
  type OrderWithItems,
} from "../orders/orderService.js";

const ORDER_CODE_REGEX = /\bPOL-[A-Z0-9-]+\b/i;
const MULTIPLE_ACTIVE_LIMIT = 3;
const RECENT_ORDER_LIMIT = 3;

export interface OrderTrackingReferenceState {
  lastReferencedOrderId: string | null;
  lastReferencedOrderCode: string | null;
}

export interface OrderStatusBusinessSettings {
  estimatedPrepMinutes: number;
}

type QueryMode = "STATUS" | "ETA";

type OrderStatusQueryResult =
  | {
      kind: "NOT_FOUND";
      facts: string[];
      askNext: string | null;
      orderTracking: OrderTrackingReferenceState;
      shouldHandoff: false;
    }
  | {
      kind: "MULTIPLE_ACTIVE";
      facts: string[];
      askNext: string;
      orderTracking: OrderTrackingReferenceState;
      shouldHandoff: false;
    }
  | {
      kind: "FOUND";
      facts: string[];
      askNext: string | null;
      orderTracking: OrderTrackingReferenceState;
      shouldHandoff: boolean;
      handoffReason: string | null;
      handoffNote: string | null;
      order: {
        id: string;
        code: string;
        status: string;
      };
      isDelayed: boolean;
      estimatedRemainingMinutes: number | null;
    };

export interface DeliveredConflictResult {
  shouldHandoff: boolean;
  facts: string[];
  orderTracking: OrderTrackingReferenceState;
  handoffReason: string | null;
  handoffNote: string | null;
}

export function looksLikeOrderStatusFollowUp(text: string): boolean {
  return /\b(y ahora|ya salio|ya salió|ya viene|como va|cómo va|donde va|dónde va|cuanto falta|cuánto falta|ya puedo pasar|sigue en preparacion|sigue en preparación)\b/i.test(
    text,
  );
}

export async function resolveOrderStatusQuery(params: {
  contactId: string;
  text: string;
  settings: OrderStatusBusinessSettings;
  reference: OrderTrackingReferenceState | null | undefined;
  mode?: QueryMode;
  now?: Date;
}): Promise<OrderStatusQueryResult> {
  const reference = normalizeReference(params.reference);
  const mode = params.mode ?? "STATUS";
  const now = params.now ?? new Date();
  const explicitCode = extractOrderCode(params.text);

  if (explicitCode) {
    const explicitOrder = await getOrderByCodeForContact(params.contactId, explicitCode);
    if (!explicitOrder) {
      return {
        kind: "NOT_FOUND",
        facts: ["No encontre un pedido asociado a tu numero con ese codigo."],
        askNext: null,
        orderTracking: emptyReference(),
        shouldHandoff: false,
      };
    }
    return buildFoundResult(explicitOrder, params.text, params.settings, reference, mode, now);
  }

  if (reference.lastReferencedOrderId) {
    const referenced = await getOrderByIdForContact(params.contactId, reference.lastReferencedOrderId);
    if (referenced) {
      return buildFoundResult(referenced, params.text, params.settings, reference, mode, now);
    }
  }

  const activeOrders = await getActiveOrdersForContact(params.contactId);
  if (activeOrders.length === 1) {
    return buildFoundResult(activeOrders[0]!, params.text, params.settings, reference, mode, now);
  }

  if (activeOrders.length > 1) {
    return {
      kind: "MULTIPLE_ACTIVE",
      facts: [
        `Tienes ${activeOrders.length} pedidos activos.`,
        ...activeOrders.slice(0, MULTIPLE_ACTIVE_LIMIT).map((order) => describeOrderChoice(order)),
      ],
      askNext: "¿Cual quieres consultar?",
      orderTracking: emptyReference(),
      shouldHandoff: false,
    };
  }

  const recentOrders = await getRecentOrdersForContact(params.contactId, RECENT_ORDER_LIMIT);
  if (recentOrders.length === 0) {
    return {
      kind: "NOT_FOUND",
      facts: ["No encontre pedidos recientes asociados a tu numero."],
      askNext: null,
      orderTracking: emptyReference(),
      shouldHandoff: false,
    };
  }

  if (recentOrders.length === 1 || mentionsHistoricalOrder(params.text)) {
    return buildFoundResult(recentOrders[0]!, params.text, params.settings, reference, mode, now);
  }

  return {
    kind: "MULTIPLE_ACTIVE",
    facts: [
      "No tienes pedidos activos, pero si encuentro varios pedidos recientes.",
      ...recentOrders.slice(0, MULTIPLE_ACTIVE_LIMIT).map((order) => describeOrderChoice(order)),
    ],
    askNext: "¿Cual quieres consultar?",
    orderTracking: emptyReference(),
    shouldHandoff: false,
  };
}

export async function resolveDeliveredConflict(params: {
  contactId: string;
  text: string;
  reference: OrderTrackingReferenceState | null | undefined;
}): Promise<DeliveredConflictResult> {
  const reference = normalizeReference(params.reference);
  if (!looksLikeUndeliveredComplaint(params.text) || !reference.lastReferencedOrderId) {
    return { shouldHandoff: false, facts: [], orderTracking: reference, handoffReason: null, handoffNote: null };
  }

  const order = await getOrderByIdForContact(params.contactId, reference.lastReferencedOrderId);
  if (!order || order.status !== OrderStatus.DELIVERED) {
    return { shouldHandoff: false, facts: [], orderTracking: reference, handoffReason: null, handoffNote: null };
  }

  return {
    shouldHandoff: true,
    facts: [
      `Veo que el pedido ${order.code} aparece como entregado, pero me dices que no lo recibiste.`,
      "Voy a comunicarte con alguien del equipo para revisarlo.",
    ],
    orderTracking: { lastReferencedOrderId: order.id, lastReferencedOrderCode: order.code },
    handoffReason: HandoffReason.DELIVERY_PROBLEM,
    handoffNote: `Cliente reporta no recibido para pedido ${order.code} marcado DELIVERED.`,
  };
}

function normalizeReference(reference: OrderTrackingReferenceState | null | undefined): OrderTrackingReferenceState {
  return {
    lastReferencedOrderId: reference?.lastReferencedOrderId ?? null,
    lastReferencedOrderCode: reference?.lastReferencedOrderCode ?? null,
  };
}

function emptyReference(): OrderTrackingReferenceState {
  return { lastReferencedOrderId: null, lastReferencedOrderCode: null };
}

function extractOrderCode(text: string): string | null {
  const match = text.match(ORDER_CODE_REGEX);
  return match ? match[0]!.toUpperCase() : null;
}

function mentionsHistoricalOrder(text: string): boolean {
  return /\b(ayer|anoche|el anterior|el ultimo|el último|el de ayer|el pasado)\b/i.test(text);
}

function looksLikeUndeliveredComplaint(text: string): boolean {
  return /\b(no me llego|no me llegó|no llego|no llegó|no lo recibi|no lo recibí|no ha llegado)\b/i.test(text);
}

function describeOrderChoice(order: OrderWithItems): string {
  return `${order.code} - ${buildNaturalStatus(order).summary}`;
}

async function buildFoundResult(
  order: OrderWithItems,
  text: string,
  settings: OrderStatusBusinessSettings,
  _reference: OrderTrackingReferenceState,
  mode: QueryMode,
  now: Date,
): Promise<Extract<OrderStatusQueryResult, { kind: "FOUND" }>> {
  const timeline = await buildOrderTimeline(order, settings, now);
  const statusCopy = buildNaturalStatus(order);
  const facts = [statusCopy.summary];

  if (mode === "ETA") {
    facts.length = 0;
    facts.push(statusCopy.etaLead);
  }

  if (timeline.estimatedRemainingMinutes !== null) {
    facts.push(
      timeline.estimatedRemainingMinutes > 0
        ? `Tiempo estimado restante: aproximadamente ${timeline.estimatedRemainingMinutes} minutos.`
        : "Tu pedido ya deberia estar en el siguiente paso del proceso.",
    );
  } else if (mode === "ETA" || asksForEta(text)) {
    facts.push("No tengo un tiempo exacto actualizado en este momento.");
  }

  let shouldHandoff = false;
  let handoffReason: string | null = null;
  let handoffNote: string | null = null;

  if (timeline.isDelayed) {
    shouldHandoff = true;
    handoffReason = order.deliveryType === DeliveryType.DELIVERY ? HandoffReason.DELIVERY_PROBLEM : HandoffReason.ORDER_PROBLEM;
    handoffNote = `Pedido ${order.code} sigue en ${order.status} y ya supero el tiempo estimado por ${timeline.delayMinutes} min.`;
    facts.push("Veo que ya paso el tiempo estimado. Voy a comunicarte con alguien del equipo para revisarlo.");
  }

  return {
    kind: "FOUND",
    facts,
    askNext: null,
    orderTracking: { lastReferencedOrderId: order.id, lastReferencedOrderCode: order.code },
    shouldHandoff,
    handoffReason,
    handoffNote,
    order: { id: order.id, code: order.code, status: order.status },
    isDelayed: timeline.isDelayed,
    estimatedRemainingMinutes: timeline.estimatedRemainingMinutes,
  };
}

function asksForEta(text: string): boolean {
  return /\b(cuanto falta|cuánto falta|cuanto demora|cuánto demora|en cuanto llega|en cuánto llega|falta mucho)\b/i.test(text);
}

async function buildOrderTimeline(order: OrderWithItems, settings: OrderStatusBusinessSettings, now: Date): Promise<{
  estimatedRemainingMinutes: number | null;
  isDelayed: boolean;
  delayMinutes: number;
}> {
  if (order.status !== OrderStatus.RECEIVED) {
    return { estimatedRemainingMinutes: null, isDelayed: false, delayMinutes: 0 };
  }

  const elapsedMinutes = Math.max(0, Math.round((now.getTime() - order.createdAt.getTime()) / 60000));
  const estimatedTotalMinutes =
    order.deliveryType === DeliveryType.DELIVERY
      ? await estimateDeliveryMinutes(order.restaurantId, settings.estimatedPrepMinutes)
      : settings.estimatedPrepMinutes;
  const estimatedRemainingMinutes = Math.max(0, estimatedTotalMinutes - elapsedMinutes);
  const delayMinutes = Math.max(0, elapsedMinutes - estimatedTotalMinutes);

  return {
    estimatedRemainingMinutes,
    isDelayed: delayMinutes > 0,
    delayMinutes,
  };
}

function buildNaturalStatus(order: OrderWithItems): { summary: string; etaLead: string } {
  switch (order.status) {
    case OrderStatus.AWAITING_PAYMENT:
      return {
        summary: `Tu pedido ${order.code} esta esperando confirmacion de pago.`,
        etaLead: `Tu pedido ${order.code} esta esperando confirmacion de pago.`,
      };
    case OrderStatus.RECEIVED:
      return {
        summary: `Tu pedido ${order.code} esta en preparacion.`,
        etaLead: `Tu pedido ${order.code} sigue en preparacion.`,
      };
    case OrderStatus.READY:
      if (order.deliveryType === DeliveryType.PICKUP) {
        return {
          summary: `Tu pedido ${order.code} ya esta listo para recoger.`,
          etaLead: `Tu pedido ${order.code} ya esta listo para recoger.`,
        };
      }
      return {
        summary: `Tu pedido ${order.code} ya esta listo y esta esperando despacho.`,
        etaLead: `Tu pedido ${order.code} ya esta listo y esta esperando despacho.`,
      };
    case OrderStatus.ON_THE_WAY:
      return {
        summary: `Tu pedido ${order.code} ya salio para entrega.`,
        etaLead: `Tu pedido ${order.code} ya salio para entrega.`,
      };
    case OrderStatus.DELIVERED:
      return {
        summary: `Tu pedido ${order.code} aparece como entregado.`,
        etaLead: `Tu pedido ${order.code} aparece como entregado.`,
      };
    case OrderStatus.CANCELLED:
      return {
        summary: `Tu pedido ${order.code} fue cancelado.`,
        etaLead: `Tu pedido ${order.code} fue cancelado.`,
      };
    default:
      return {
        summary: `Tu pedido ${order.code} esta en estado ${order.status}.`,
        etaLead: `Tu pedido ${order.code} esta en estado ${order.status}.`,
      };
  }
}
