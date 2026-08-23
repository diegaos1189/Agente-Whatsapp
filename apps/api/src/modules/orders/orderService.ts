import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { OrderStatus, type DeliveryType, type PaymentMethod } from "@pollos/shared";
import { n8nClient } from "../n8n/n8nClient.js";
import type { OrderDTO } from "@pollos/shared";
import { buildInitialPaymentRecord, mapLegacyOrderMethodToPaymentMethod, markPaymentPaid } from "../payments/paymentService.js";

export const ORDER_STATUS_LABELS_ES: Record<string, string> = {
  [OrderStatus.AWAITING_PAYMENT]: "esperando confirmacion de pago",
  [OrderStatus.RECEIVED]: "recibido, en preparacion",
  [OrderStatus.READY]: "listo, buscando domiciliario",
  [OrderStatus.ON_THE_WAY]: "en reparto",
  [OrderStatus.DELIVERED]: "entregado",
  [OrderStatus.CANCELLED]: "cancelado",
};

/** Mensaje que se le manda al cliente por WhatsApp cuando el pedido cambia a este estado. Null = no se notifica. */
export const ORDER_STATUS_CUSTOMER_MESSAGE: Record<string, (orderCode: string) => string> = {
  [OrderStatus.READY]: (code) =>
    `Su pedido ${code} esta listo. Estamos buscando un domiciliario para enviarselo.`,
  [OrderStatus.ON_THE_WAY]: (code) => `Su pedido ${code} se encuentra en reparto.`,
  [OrderStatus.DELIVERED]: (code) => `Su pedido ${code} fue entregado. ¡Que lo disfrute!`,
  [OrderStatus.CANCELLED]: (code) => `Su pedido ${code} fue cancelado.`,
};

export function buildOrderStatusCustomerMessage(params: {
  status: string;
  orderCode: string;
  deliveryType: DeliveryType;
}): string | null {
  const { status, orderCode, deliveryType } = params;

  if (status === OrderStatus.READY) {
    return deliveryType === "PICKUP"
      ? `Su pedido ${orderCode} ya esta listo para recoger en el local.`
      : `Su pedido ${orderCode} esta listo. Estamos buscando un domiciliario para enviarselo.`;
  }

  if (status === OrderStatus.ON_THE_WAY) {
    return `Su pedido ${orderCode} se encuentra en reparto.`;
  }

  if (status === OrderStatus.DELIVERED) {
    return `Su pedido ${orderCode} fue entregado. ¡Que lo disfrute!`;
  }

  if (status === OrderStatus.CANCELLED) {
    return `Su pedido ${orderCode} fue cancelado.`;
  }

  return null;
}

export interface CartLine {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  notes?: string | null;
}

export interface CreateOrderItemInput extends CartLine {}

interface CreateOrderParams {
  contactId: string;
  items: CreateOrderItemInput[];
  confirmationId?: string | null;
  deliveryType: DeliveryType;
  paymentMethod: PaymentMethod;
  deliveryFee: number;
  total: number;
  address?: string | null;
  neighborhood?: string | null;
  reference?: string | null;
  /** Numero para que el domiciliario contacte al cliente. Si no se da, se usa el de WhatsApp (params.phone). */
  contactPhone?: string | null;
  customerName?: string | null;
  phone: string;
  currency?: string;
}

export interface OrderOperationalAlert {
  reason:
    | "AWAITING_PAYMENT_STALE"
    | "RECEIVED_STALE"
    | "READY_FOR_PICKUP_STALE"
    | "READY_FOR_DISPATCH_STALE";
  note: string;
  delayMinutes: number;
}

export interface OperationalRiskAuditHit {
  orderId: string;
  reason: OrderOperationalAlert["reason"];
  note: string;
}

export interface ActiveOrderOperationalAlertDTO {
  orderId: string;
  orderCode: string;
  customerName: string | null;
  phone: string;
  status: OrderDTO["status"];
  deliveryType: OrderDTO["deliveryType"];
  flaggedForReview: boolean;
  reason: OrderOperationalAlert["reason"];
  note: string;
  delayMinutes: number;
  suggestedAction: string;
  createdAt: string;
  updatedAt: string;
}

const PAYMENT_CONFIRMATION_ALERT_MINUTES = 15;
const READY_PICKUP_ALERT_MINUTES = 20;
const READY_DELIVERY_ALERT_MINUTES = 10;

const orderWithItems = Prisma.validator<Prisma.OrderDefaultArgs>()({
  include: { items: { include: { product: true } }, events: true, payments: true },
});
export type OrderWithItems = Prisma.OrderGetPayload<typeof orderWithItems>;

const orderWithItemsAndContact = Prisma.validator<Prisma.OrderDefaultArgs>()({
  include: { items: { include: { product: true } }, events: true, payments: true, contact: true },
});
type OrderWithItemsAndContact = Prisma.OrderGetPayload<typeof orderWithItemsAndContact>;

function generateOrderCode(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = randomBytes(3).toString("hex").toUpperCase();
  return `POL-${stamp}-${rand}`;
}

export async function createOrder(params: CreateOrderParams): Promise<{ order: OrderDTO; createdNow: boolean }> {
  if (params.confirmationId) {
    const existing = await prisma.order.findUnique({
      where: { confirmationId: params.confirmationId },
      ...orderWithItems,
    });
    if (existing) {
      return { order: toOrderDTO(existing, params.customerName ?? null, params.phone), createdNow: false };
    }
  }

  const code = generateOrderCode();

  // Si el cliente ya tiene otro pedido sin despachar (RECEIVED o esperando pago), este
  // pedido nuevo probablemente sea "agregar mas" al mismo pedido en vez de uno aparte —
  // se marca en rojo en el panel para que el operador lo revise antes de despachar.
  const pendingOrders = await prisma.order.findMany({
    where: { contactId: params.contactId, status: { in: [OrderStatus.RECEIVED, OrderStatus.AWAITING_PAYMENT] } },
    select: { id: true, code: true },
  });

  // Los pedidos por transferencia arrancan esperando que un humano confirme que la plata
  // realmente llego, en vez de pasar directo a preparacion (evita cocinar algo que nunca
  // se pago). Efectivo y tarjeta contraentrega no necesitan ese paso.
  const initialStatus = params.paymentMethod === "TRANSFER" ? OrderStatus.AWAITING_PAYMENT : OrderStatus.RECEIVED;

  let order: OrderWithItems;
  let createdNow = false;
  try {
    order = await prisma.$transaction(async (tx) => {
      if (pendingOrders.length > 0) {
        await tx.order.updateMany({
          where: { id: { in: pendingOrders.map((o) => o.id) } },
          data: { flaggedForReview: true, flagNote: "El cliente agrego otro pedido antes de que este saliera. Revisar." },
        });
      }
      return tx.order.create({
        data: {
          code,
          confirmationId: params.confirmationId ?? null,
          contactId: params.contactId,
          status: initialStatus,
          deliveryType: params.deliveryType,
          paymentMethod: params.paymentMethod,
          total: params.total,
          deliveryFee: params.deliveryFee,
          address: params.address ?? null,
          neighborhood: params.neighborhood ?? null,
          contactPhone: params.contactPhone ?? params.phone,
          reference: params.reference ?? null,
          flaggedForReview: pendingOrders.length > 0,
          flagNote:
            pendingOrders.length > 0
              ? `El cliente ya tenia pedido(s) sin despachar (${pendingOrders.map((o) => o.code).join(", ")}). Revisar si es el mismo pedido.`
              : null,
          items: {
            create: params.items.map((i) => ({
              productId: i.productId,
              productName: i.productName,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              notes: i.notes ?? null,
            })),
          },
          payments: {
            create: {
              ...buildInitialPaymentRecord({
                orderCode: code,
                amount: params.total,
                currency: params.currency ?? "COP",
                method: mapLegacyOrderMethodToPaymentMethod(params.paymentMethod, params.deliveryType),
                deliveryType: params.deliveryType,
              }),
            },
          },
          events: {
            create: { status: initialStatus, note: "Pedido creado desde WhatsApp" },
          },
        },
        ...orderWithItems,
      });
    });
    createdNow = true;
  } catch (error) {
    if (
      params.confirmationId &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await prisma.order.findUnique({
        where: { confirmationId: params.confirmationId },
        ...orderWithItems,
      });
      if (existing) {
        return { order: toOrderDTO(existing, params.customerName ?? null, params.phone), createdNow: false };
      }
    }
    throw error;
  }

  if (createdNow) {
    await n8nClient.notifyOrderCreated({
    event: "order.created",
    order_id: order.id,
    order_code: order.code,
    customer_name: params.customerName ?? null,
    phone: params.phone,
    items: order.items.map((i) => ({
      productName: i.productName ?? i.product?.name ?? "Producto eliminado",
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      subtotal: i.quantity * i.unitPrice,
      notes: i.notes,
    })),
    total: order.total,
    delivery_fee: order.deliveryFee,
    payment_method: order.paymentMethod,
    delivery_type: order.deliveryType,
    address: order.address,
    neighborhood: order.neighborhood,
    reference: order.reference,
    created_at: order.createdAt.toISOString(),
  });

    await n8nClient.notifyOperator({
      event: "operator.notification",
      order_id: order.id,
      order_code: order.code,
      phone: params.phone,
      reason: "new_order",
      message: `Nuevo pedido ${order.code} por ${params.total}`,
    });
  }

  return { order: toOrderDTO(order, params.customerName ?? null, params.phone), createdNow };
}

/**
 * Estima el tiempo de entrega sumando el estimado configurado + minutos extra por cada
 * pedido que ya esta en cola de preparacion (RECEIVED) — asi el estimado que se le da al
 * cliente refleja como esta la cocina de verdad, no un numero fijo.
 */
export async function estimateDeliveryMinutes(baseEstimateMinutes: number): Promise<number> {
  const queueLength = await prisma.order.count({
    where: { status: OrderStatus.RECEIVED },
  });
  const EXTRA_MINUTES_PER_ORDER_AHEAD = 5;
  return baseEstimateMinutes + queueLength * EXTRA_MINUTES_PER_ORDER_AHEAD;
}

export async function getLatestOrderForContact(contactId: string): Promise<OrderWithItems | null> {
  return prisma.order.findFirst({
    where: { contactId },
    orderBy: { createdAt: "desc" },
    ...orderWithItems,
  });
}

export async function getActiveOrdersForContact(contactId: string): Promise<OrderWithItems[]> {
  return prisma.order.findMany({
    where: {
      contactId,
      status: { in: [OrderStatus.AWAITING_PAYMENT, OrderStatus.RECEIVED, OrderStatus.READY, OrderStatus.ON_THE_WAY] },
    },
    orderBy: { createdAt: "desc" },
    ...orderWithItems,
  });
}

export async function getRecentOrdersForContact(contactId: string, limit = 3): Promise<OrderWithItems[]> {
  return prisma.order.findMany({
    where: { contactId },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(limit, 10)),
    ...orderWithItems,
  });
}

export async function getOrderByCodeForContact(contactId: string, code: string): Promise<OrderWithItems | null> {
  return prisma.order.findFirst({
    where: {
      contactId,
      code,
    },
    ...orderWithItems,
  });
}

export async function getOrderByIdForContact(contactId: string, orderId: string): Promise<OrderWithItems | null> {
  return prisma.order.findFirst({
    where: {
      id: orderId,
      contactId,
    },
    ...orderWithItems,
  });
}

export async function updateOrderStatus(orderId: string, status: string, note?: string) {
  return prisma.$transaction(async (tx) => {
    // Cambiar el estado implica que el operador ya reviso el pedido, asi que se limpia
    // la alerta de "revisar" si tenia una.
    const order = await tx.order.update({ where: { id: orderId }, data: { status, flaggedForReview: false } });
    await tx.orderEvent.create({ data: { orderId, status, note: note ?? null } });
    return order;
  });
}

export async function clearOrderFlag(orderId: string) {
  return prisma.order.update({ where: { id: orderId }, data: { flaggedForReview: false } });
}

function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));
}

function latestStatusTimestamp(order: OrderWithItems, status: string): Date | null {
  const matching = order.events
    .filter((event) => event.status === status)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return matching[0]?.createdAt ?? null;
}

export function evaluateOrderOperationalAlert(params: {
  order: OrderWithItems;
  estimatedPrepMinutes: number;
  now?: Date;
}): OrderOperationalAlert | null {
  const { order, estimatedPrepMinutes, now = new Date() } = params;

  if (order.status === OrderStatus.AWAITING_PAYMENT) {
    const delayMinutes = minutesBetween(order.createdAt, now) - PAYMENT_CONFIRMATION_ALERT_MINUTES;
    if (delayMinutes > 0) {
      return {
        reason: "AWAITING_PAYMENT_STALE",
        delayMinutes,
        note: `Pedido esperando confirmacion de pago por mas de ${PAYMENT_CONFIRMATION_ALERT_MINUTES} min.`,
      };
    }
    return null;
  }

  if (order.status === OrderStatus.RECEIVED) {
    const threshold = estimatedPrepMinutes;
    const delayMinutes = minutesBetween(order.createdAt, now) - threshold;
    if (delayMinutes > 0) {
      return {
        reason: "RECEIVED_STALE",
        delayMinutes,
        note: `Pedido en preparacion supero el estimado por ${delayMinutes} min.`,
      };
    }
    return null;
  }

  if (order.status === OrderStatus.READY) {
    const readySince = latestStatusTimestamp(order, OrderStatus.READY) ?? order.updatedAt ?? order.createdAt;
    const threshold = order.deliveryType === "PICKUP" ? READY_PICKUP_ALERT_MINUTES : READY_DELIVERY_ALERT_MINUTES;
    const delayMinutes = minutesBetween(readySince, now) - threshold;
    if (delayMinutes > 0) {
      return {
        reason: order.deliveryType === "PICKUP" ? "READY_FOR_PICKUP_STALE" : "READY_FOR_DISPATCH_STALE",
        delayMinutes,
        note:
          order.deliveryType === "PICKUP"
            ? `Pedido listo para recoger sin cerrar por mas de ${threshold} min.`
            : `Pedido listo esperando despacho por mas de ${threshold} min.`,
      };
    }
  }

  return null;
}

function buildSuggestedAction(reason: OrderOperationalAlert["reason"], deliveryType: DeliveryType): string {
  if (reason === "AWAITING_PAYMENT_STALE") return "Confirmar pago o contactar al cliente";
  if (reason === "RECEIVED_STALE") return "Revisar cocina y actualizar estado";
  if (reason === "READY_FOR_PICKUP_STALE") return "Avisar al cliente que recoja su pedido";
  if (reason === "READY_FOR_DISPATCH_STALE") {
    return deliveryType === "PICKUP" ? "Confirmar recogida del cliente" : "Asignar despacho o actualizar salida";
  }
  return "Revisar pedido";
}

export async function getActiveOperationalAlerts(params: {
  estimatedPrepMinutes: number;
  now?: Date;
}): Promise<ActiveOrderOperationalAlertDTO[]> {
  const { estimatedPrepMinutes, now = new Date() } = params;
  const orders = await prisma.order.findMany({
    where: {
      status: { in: [OrderStatus.AWAITING_PAYMENT, OrderStatus.RECEIVED, OrderStatus.READY] },
    },
    orderBy: { createdAt: "asc" },
    ...orderWithItemsAndContact,
  });

  const alerts: ActiveOrderOperationalAlertDTO[] = [];
  for (const order of orders) {
    const alert = evaluateOrderOperationalAlert({ order, estimatedPrepMinutes, now });
    if (!alert) continue;
    alerts.push(toOperationalAlertDTO(order, alert));
  }

  return alerts.sort((a, b) => b.delayMinutes - a.delayMinutes);
}

export async function auditOrdersForOperationalRisk(params: {
  estimatedPrepMinutes: number;
  now?: Date;
}): Promise<{ flagged: number; hits: OperationalRiskAuditHit[] }> {
  const { estimatedPrepMinutes, now = new Date() } = params;
  const orders = await prisma.order.findMany({
    where: {
      status: { in: [OrderStatus.AWAITING_PAYMENT, OrderStatus.RECEIVED, OrderStatus.READY] },
    },
    ...orderWithItems,
  });

  let flagged = 0;
  const hits: OperationalRiskAuditHit[] = [];
  for (const order of orders) {
    const alert = evaluateOrderOperationalAlert({ order, estimatedPrepMinutes, now });
    if (!alert) continue;
    if (order.flaggedForReview && order.flagNote === alert.note) continue;

    await prisma.order.update({
      where: { id: order.id },
      data: { flaggedForReview: true, flagNote: alert.note },
    });
    await prisma.orderEvent.create({
      data: {
        orderId: order.id,
        status: order.status,
        note: `ALERTA OPERATIVA: ${alert.note}`,
      },
    });
    flagged += 1;
    hits.push({ orderId: order.id, reason: alert.reason, note: alert.note });
  }

  return { flagged, hits };
}

function toOperationalAlertDTO(order: OrderWithItemsAndContact, alert: OrderOperationalAlert): ActiveOrderOperationalAlertDTO {
  return {
    orderId: order.id,
    orderCode: order.code,
    customerName: order.contact.name,
    phone: order.contact.phone,
    status: order.status as ActiveOrderOperationalAlertDTO["status"],
    deliveryType: order.deliveryType as ActiveOrderOperationalAlertDTO["deliveryType"],
    flaggedForReview: order.flaggedForReview,
    reason: alert.reason,
    note: alert.note,
    delayMinutes: alert.delayMinutes,
    suggestedAction: buildSuggestedAction(alert.reason, order.deliveryType as DeliveryType),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

/**
 * Un humano confirma que la transferencia realmente llego: el pedido pasa de
 * AWAITING_PAYMENT a RECEIVED (ahi si arranca preparacion). El aviso al cliente se manda
 * aparte (notifyPaymentConfirmed).
 */
export async function confirmOrderPayment(orderId: string) {
  await markPaymentPaid({ orderId, actor: "operador" });
  return prisma.order.findUniqueOrThrow({ where: { id: orderId } });
}

/**
 * Registra que un pago en efectivo o tarjeta contraentrega ya se recibio (ej: al momento de
 * la entrega). A diferencia de confirmOrderPayment (transferencias), esto NO toca el estado
 * del pedido — el pedido puede seguir su flujo normal (o ya estar entregado) sin depender de
 * este registro contable.
 */
export async function markCashPaymentReceived(orderId: string) {
  await markPaymentPaid({ orderId, actor: "operador" });
  return prisma.order.findUniqueOrThrow({ where: { id: orderId } });
}

/**
 * Reemplaza los items de un pedido (ej: se subio mal y el operador lo corrige desde el
 * panel) y recalcula el total. Deja un evento en el historial para que quede registro de
 * que se corrigio. El aviso al cliente se manda aparte (notifyOrderCorrection).
 */
export async function updateOrderItems(
  orderId: string,
  items: Array<{ productId: string; productName: string; quantity: number; unitPrice: number; notes?: string | null }>,
  total: number,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    await tx.orderItem.deleteMany({ where: { orderId } });
    await tx.order.update({
      where: { id: orderId },
      data: {
        total,
        items: {
          create: items.map((i) => ({
            productId: i.productId,
            productName: i.productName,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            notes: i.notes ?? null,
          })),
        },
      },
    });
    await tx.orderEvent.create({ data: { orderId, status: existing.status, note: "Pedido corregido por el operador" } });
  });
}

function computeDispatchMinutes(order: OrderWithItems): number | null {
  const deliveredEvent = order.events.find((e) => e.status === OrderStatus.DELIVERED);
  if (!deliveredEvent) return null;
  return Math.round((deliveredEvent.createdAt.getTime() - order.createdAt.getTime()) / 60000);
}

export function toOrderDTO(order: OrderWithItems, customerName: string | null, phone: string): OrderDTO {
  const payments = order.payments ?? [];
  const paidAmount = payments.reduce((sum, payment) => {
    if (payment.paidAmount > 0) return sum + payment.paidAmount;
    return payment.status === "PAID" || payment.status === "PARTIALLY_REFUNDED" || payment.status === "REFUNDED"
      ? sum + payment.amount
      : sum;
  }, 0);
  const refundedAmount = payments.reduce((sum, payment) => sum + payment.refundedAmount, 0);
  const netPaidAmount = paidAmount - refundedAmount;
  return {
    id: order.id,
    code: order.code,
    contactId: order.contactId,
    customerName,
    phone,
    status: order.status as OrderDTO["status"],
    deliveryType: order.deliveryType as OrderDTO["deliveryType"],
    paymentMethod: order.paymentMethod as OrderDTO["paymentMethod"],
    paymentStatus: order.paymentStatus as OrderDTO["paymentStatus"],
    paidAmount,
    refundedAmount,
    netPaidAmount,
    outstandingAmount: Math.max(order.total - netPaidAmount, 0),
    total: order.total,
    deliveryFee: order.deliveryFee,
    address: order.address,
    neighborhood: order.neighborhood,
    reference: order.reference,
    contactPhone: order.contactPhone,
    flaggedForReview: order.flaggedForReview,
    flagNote: order.flagNote,
    dispatchMinutes: computeDispatchMinutes(order),
    items: order.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName ?? i.product?.name ?? "Producto eliminado",
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      notes: i.notes,
    })),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}
