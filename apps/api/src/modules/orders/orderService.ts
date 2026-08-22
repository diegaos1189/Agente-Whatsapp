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

const orderWithItems = Prisma.validator<Prisma.OrderDefaultArgs>()({
  include: { items: { include: { product: true } }, events: true, payments: true },
});
export type OrderWithItems = Prisma.OrderGetPayload<typeof orderWithItems>;

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
