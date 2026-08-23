import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { OrderStatus, DeliveryType, PaymentMethod, PaymentStatus } from "@pollos/shared";
import { requirePermission } from "../modules/adminUsers/adminAuth.js";
import {
  toOrderDTO,
  updateOrderStatus,
  createOrder,
  clearOrderFlag,
  updateOrderItems,
  confirmOrderPayment,
  markCashPaymentReceived,
  getActiveOperationalAlerts,
} from "../modules/orders/orderService.js";
import {
  notifyOrderStatusChange,
  notifyManualOrderConfirmation,
  notifyOrderCorrection,
  notifyPaymentConfirmed,
} from "../modules/conversation/conversationService.js";
import { getBusinessSettings } from "../modules/business/businessHoursService.js";
import { calculateCartPricing } from "../modules/orders/pricingService.js";
import { logger } from "../utils/logger.js";

const ORDER_STATUS_VALUES = Object.values(OrderStatus) as [string, ...string[]];

function isAllowedStatusTransition(currentStatus: string, nextStatus: string, deliveryType: string): boolean {
  if (currentStatus === nextStatus) return true;

  const allowedByStatus: Record<string, string[]> = {
    [OrderStatus.AWAITING_PAYMENT]: [OrderStatus.RECEIVED, OrderStatus.CANCELLED],
    [OrderStatus.RECEIVED]: [OrderStatus.READY, OrderStatus.CANCELLED],
    [OrderStatus.READY]:
      deliveryType === DeliveryType.PICKUP
        ? [OrderStatus.DELIVERED, OrderStatus.CANCELLED]
        : [OrderStatus.ON_THE_WAY, OrderStatus.DELIVERED, OrderStatus.CANCELLED],
    [OrderStatus.ON_THE_WAY]: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
    [OrderStatus.DELIVERED]: [],
    [OrderStatus.CANCELLED]: [],
  };

  return (allowedByStatus[currentStatus] ?? []).includes(nextStatus);
}

const manualOrderSchema = z.object({
  contactId: z.string(),
  items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive() })).min(1),
  deliveryType: z.enum([DeliveryType.DELIVERY, DeliveryType.PICKUP]),
  paymentMethod: z.enum([PaymentMethod.CASH, PaymentMethod.TRANSFER, PaymentMethod.CARD_ON_DELIVERY]),
  address: z.string().nullable().optional(),
  neighborhood: z.string().nullable().optional(),
  reference: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
});

export async function orderRoutes(app: FastifyInstance) {
  app.get("/api/orders", async (request) => {
    requirePermission(request, "orders");
    const query = z.object({ status: z.string().optional(), contactId: z.string().optional() }).parse(request.query);

    const orders = await prisma.order.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.contactId ? { contactId: query.contactId } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { items: { include: { product: true } }, contact: true, events: true, payments: true },
      take: 200,
    });

    return orders.map((o) => toOrderDTO(o, o.contact.name, o.contact.phone));
  });

  app.get("/api/orders/alerts", async (request) => {
    requirePermission(request, "orders");
    const settings = await getBusinessSettings();
    return getActiveOperationalAlerts({ estimatedPrepMinutes: settings.estimatedPrepMinutes });
  });

  app.post("/api/orders", async (request, reply) => {
    requirePermission(request, "orders");
    const body = manualOrderSchema.parse(request.body);

    const contact = await prisma.contact.findUnique({ where: { id: body.contactId } });
    if (!contact) return reply.status(404).send({ error: "Cliente no encontrado" });

    const products = await prisma.product.findMany({ where: { id: { in: body.items.map((i) => i.productId) } } });
    if (products.length !== body.items.length) {
      return reply.status(400).send({ error: "Uno o mas productos no existen" });
    }

    const settings = await getBusinessSettings();
    const requestedCart = body.items.map((line) => {
      const product = products.find((p) => p.id === line.productId)!;
      return {
        productId: product.id,
        productName: product.name,
        quantity: line.quantity,
        unitPrice: product.price,
      };
    });
    const pricing = await calculateCartPricing({
      cart: requestedCart,
      deliveryType: body.deliveryType,
      currency: settings.currency,
      businessDeliveryFee: settings.deliveryFee,
    });
    if (!pricing.valid) {
      return reply.status(400).send({ error: pricing.issues[0]?.message ?? "No se pudo calcular el pedido" });
    }

    const { order } = await createOrder({
      contactId: contact.id,
      phone: contact.phone,
      customerName: contact.name,
      items: pricing.repricedCartLines,
      deliveryType: body.deliveryType,
      paymentMethod: body.paymentMethod,
      deliveryFee: pricing.deliveryFee,
      total: pricing.total,
      currency: settings.currency,
      address: body.address,
      neighborhood: body.neighborhood,
      reference: body.reference,
      contactPhone: body.contactPhone,
    });

    notifyManualOrderConfirmation(order.id).catch((error) => {
      logger.error({ err: error, orderId: order.id }, "Fallo notificando confirmacion de pedido manual al cliente");
    });

    return order;
  });

  app.get("/api/orders/:id", async (request, reply) => {
    requirePermission(request, "orders");
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: { include: { product: true } }, contact: true, events: true, payments: true },
    });
    if (!order) return reply.status(404).send({ error: "Pedido no encontrado" });
    return toOrderDTO(order, order.contact.name, order.contact.phone);
  });

  app.patch("/api/orders/:id/items", async (request, reply) => {
    requirePermission(request, "orders");
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({ items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive() })).min(1) })
      .parse(request.body);

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return reply.status(404).send({ error: "Pedido no encontrado" });

    const products = await prisma.product.findMany({ where: { id: { in: body.items.map((i) => i.productId) } } });
    if (products.length !== body.items.length) {
      return reply.status(400).send({ error: "Uno o mas productos no existen" });
    }

    const settings = await getBusinessSettings();
    const requestedCart = body.items.map((line) => {
      const product = products.find((p) => p.id === line.productId)!;
      return {
        productId: product.id,
        productName: product.name,
        quantity: line.quantity,
        unitPrice: product.price,
      };
    });
    const pricing = await calculateCartPricing({
      cart: requestedCart,
      deliveryType: order.deliveryType as DeliveryType,
      currency: settings.currency,
      businessDeliveryFee: order.deliveryFee,
    });
    if (!pricing.valid) {
      return reply.status(400).send({ error: pricing.issues[0]?.message ?? "No se pudo recalcular el pedido" });
    }

    await updateOrderItems(id, pricing.repricedCartLines, pricing.total);

    notifyOrderCorrection(id).catch((error) => {
      logger.error({ err: error, orderId: id }, "Fallo notificando correccion de pedido al cliente");
    });

    return { ok: true };
  });

  app.post("/api/orders/:id/confirm-payment", async (request, reply) => {
    requirePermission(request, "orders");
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return reply.status(404).send({ error: "Pedido no encontrado" });
    if (order.status !== OrderStatus.AWAITING_PAYMENT) {
      return reply.status(400).send({ error: "Este pedido no esta esperando confirmacion de pago" });
    }

    await confirmOrderPayment(id);

    notifyPaymentConfirmed(id).catch((error) => {
      logger.error({ err: error, orderId: id }, "Fallo notificando pago confirmado al cliente");
    });

    return { ok: true };
  });

  app.post("/api/orders/:id/mark-paid", async (request, reply) => {
    requirePermission(request, "facturacion");
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return reply.status(404).send({ error: "Pedido no encontrado" });
    if (order.paymentMethod === PaymentMethod.TRANSFER) {
      return reply.status(400).send({ error: "Los pagos por transferencia se confirman desde Pedidos, no aqui" });
    }
    if (order.paymentStatus === PaymentStatus.PAID) {
      return reply.status(400).send({ error: "Este pedido ya esta marcado como pagado" });
    }

    await markCashPaymentReceived(id);
    return { ok: true };
  });

  app.patch("/api/orders/:id/status", async (request, reply) => {
    requirePermission(request, "orders");
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ status: z.enum(ORDER_STATUS_VALUES), note: z.string().optional() }).parse(request.body);

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return reply.status(404).send({ error: "Pedido no encontrado" });
    if (!isAllowedStatusTransition(order.status, body.status, order.deliveryType)) {
      return reply.status(400).send({ error: `No se permite pasar de ${order.status} a ${body.status}` });
    }

    const updated = await updateOrderStatus(id, body.status, body.note);

    notifyOrderStatusChange(id, body.status).catch((error) => {
      logger.error({ err: error, orderId: id, status: body.status }, "Fallo notificando cambio de estado al cliente");
    });

    return { ok: true, status: updated.status };
  });

  app.post("/api/orders/:id/clear-flag", async (request, reply) => {
    requirePermission(request, "orders");
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return reply.status(404).send({ error: "Pedido no encontrado" });
    await clearOrderFlag(id);
    return { ok: true };
  });
}
