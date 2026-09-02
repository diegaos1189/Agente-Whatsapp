import { prisma } from "../../db/prisma.js";
import { OrderStatus } from "@pollos/shared";
import type { CustomerSegmentCustomersDTO, MetricsDTO, RangeMetricsDTO } from "@pollos/shared";
import { getBusinessSettings } from "../business/businessHoursService.js";

/**
 * Metricas operativas de los ultimos 30 dias: volumen de pedidos, ticket promedio,
 * tiempo real de preparacion (desde que se crea el pedido hasta que llega a READY o
 * DELIVERED, medido con order_events) comparado contra el estimado configurado, y que
 * porcentaje de conversaciones termino escalado a un humano.
 */
export async function getMetrics(restaurantId: string): Promise<MetricsDTO> {
  const settings = await getBusinessSettings(restaurantId);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const [
    ordersToday,
    ordersLast7Days,
    ordersLast30Days,
    completedOrders,
    commercialOrders,
    customerOrders,
    ordersByStatusRaw,
    totalConversations30Days,
    convertedConversations30Days,
    handoffConversations,
    revenueTodayAgg,
    revenueMonthAgg,
    deliveredOrdersThisMonth,
    openRiskOrders,
    recentOrderEvents,
  ] = await Promise.all([
    prisma.order.count({ where: { restaurantId, createdAt: { gte: startOfToday } } }),
    prisma.order.count({ where: { restaurantId, createdAt: { gte: sevenDaysAgo } } }),
    prisma.order.count({ where: { restaurantId, createdAt: { gte: thirtyDaysAgo } } }),
    prisma.order.findMany({
      where: { restaurantId, createdAt: { gte: thirtyDaysAgo }, status: { not: OrderStatus.CANCELLED } },
      select: { total: true, createdAt: true, events: { select: { status: true, createdAt: true } } },
    }),
    prisma.order.findMany({
      where: { restaurantId, createdAt: { gte: thirtyDaysAgo }, status: { not: OrderStatus.CANCELLED } },
      select: {
        total: true,
        createdAt: true,
        deliveryType: true,
        paymentMethod: true,
        contactId: true,
        items: { select: { productName: true, quantity: true, unitPrice: true } },
      },
    }),
    prisma.order.findMany({
      where: { restaurantId, status: { not: OrderStatus.CANCELLED } },
      select: { contactId: true, createdAt: true },
      orderBy: [{ contactId: "asc" }, { createdAt: "asc" }],
    }),
    prisma.order.groupBy({
      by: ["status"],
      _count: { status: true },
      where: { restaurantId, createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.conversation.count({ where: { restaurantId, createdAt: { gte: thirtyDaysAgo } } }),
    prisma.conversation.count({
      where: {
        restaurantId,
        createdAt: { gte: thirtyDaysAgo },
        contact: {
          orders: {
            some: { createdAt: { gte: thirtyDaysAgo }, status: { not: OrderStatus.CANCELLED } },
          },
        },
      },
    }),
    // Handoffs y eventos de pedido no tienen restaurante propio: se acotan por su
    // conversacion/pedido, que si lo tiene.
    prisma.handoff.findMany({
      where: { createdAt: { gte: thirtyDaysAgo }, conversation: { restaurantId } },
      select: { conversationId: true },
      distinct: ["conversationId"],
    }),
    prisma.order.aggregate({
      where: { restaurantId, createdAt: { gte: startOfToday }, status: { not: OrderStatus.CANCELLED } },
      _sum: { total: true },
    }),
    prisma.order.aggregate({
      where: { restaurantId, createdAt: { gte: startOfMonth }, status: { not: OrderStatus.CANCELLED } },
      _sum: { total: true },
    }),
    prisma.order.findMany({
      where: {
        restaurantId,
        createdAt: { gte: startOfMonth },
        deliveryType: "DELIVERY",
        status: OrderStatus.DELIVERED,
      },
      select: { createdAt: true, events: { where: { status: OrderStatus.DELIVERED }, select: { createdAt: true }, take: 1 } },
    }),
    prisma.order.count({
      where: {
        restaurantId,
        flaggedForReview: true,
        status: { in: [OrderStatus.AWAITING_PAYMENT, OrderStatus.RECEIVED, OrderStatus.READY, OrderStatus.ON_THE_WAY] },
      },
    }),
    prisma.orderEvent.findMany({
      where: { createdAt: { gte: thirtyDaysAgo }, order: { restaurantId } },
      select: { note: true },
    }),
  ]);

  const avgTicket =
    completedOrders.length > 0
      ? Math.round(completedOrders.reduce((acc, o) => acc + o.total, 0) / completedOrders.length)
      : 0;

  function findLatestEventTimestamp(order: (typeof completedOrders)[number], status: string): Date | null {
    const matching = order.events
      .filter((event) => event.status === status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return matching[0]?.createdAt ?? null;
  }

  function averageMinutes(values: number[]): number | null {
    return values.length > 0 ? Math.round(values.reduce((acc, value) => acc + value, 0) / values.length) : null;
  }

  const prepTimesMinutes: number[] = [];
  const paymentConfirmationMinutes: number[] = [];
  const kitchenSlaMinutes: number[] = [];
  const dispatchSlaMinutes: number[] = [];
  const deliveryLegSlaMinutes: number[] = [];
  for (const order of completedOrders) {
    const readyEvent =
      order.events.find((e) => e.status === OrderStatus.READY) ??
      order.events.find((e) => e.status === OrderStatus.DELIVERED);
    if (!readyEvent) continue;
    const minutes = (readyEvent.createdAt.getTime() - order.createdAt.getTime()) / 60000;
    if (minutes >= 0) prepTimesMinutes.push(minutes);

    const receivedAt = findLatestEventTimestamp(order, OrderStatus.RECEIVED);
    if (receivedAt && order.createdAt.getTime() <= receivedAt.getTime()) {
      paymentConfirmationMinutes.push((receivedAt.getTime() - order.createdAt.getTime()) / 60000);
    }

    if (receivedAt && receivedAt.getTime() <= readyEvent.createdAt.getTime()) {
      kitchenSlaMinutes.push((readyEvent.createdAt.getTime() - receivedAt.getTime()) / 60000);
    }

    const onTheWayAt = findLatestEventTimestamp(order, OrderStatus.ON_THE_WAY);
    const deliveredAt = findLatestEventTimestamp(order, OrderStatus.DELIVERED);
    if (readyEvent && onTheWayAt && readyEvent.createdAt.getTime() <= onTheWayAt.getTime()) {
      dispatchSlaMinutes.push((onTheWayAt.getTime() - readyEvent.createdAt.getTime()) / 60000);
    }
    if (onTheWayAt && deliveredAt && onTheWayAt.getTime() <= deliveredAt.getTime()) {
      deliveryLegSlaMinutes.push((deliveredAt.getTime() - onTheWayAt.getTime()) / 60000);
    }
  }
  const avgPrepMinutes =
    prepTimesMinutes.length > 0
      ? Math.round(prepTimesMinutes.reduce((a, b) => a + b, 0) / prepTimesMinutes.length)
      : null;

  const productSales = new Map<string, { quantity: number; revenue: number }>();
  const peakHours = new Map<number, number>();
  const paymentMix = new Map<string, { label: string; count: number; revenue: number }>();
  const deliveryMix = new Map<string, { label: string; count: number; revenue: number }>();
  const customerOrderDates = new Map<string, Date[]>();
  const lastOrderByContact = new Map<string, Date>();
  const orders30ByContact = new Map<string, number>();
  const orders90ByContact = new Map<string, number>();

  for (const order of commercialOrders) {
    const hour = order.createdAt.getHours();
    peakHours.set(hour, (peakHours.get(hour) ?? 0) + 1);

    const paymentKey = order.paymentMethod ?? "UNKNOWN";
    const paymentLabel =
      paymentKey === "CASH"
        ? "Efectivo"
        : paymentKey === "TRANSFER"
          ? "Transferencia"
          : paymentKey === "CARD_ON_DELIVERY"
            ? "Datafono contraentrega"
            : "Sin definir";
    paymentMix.set(paymentKey, {
      label: paymentLabel,
      count: (paymentMix.get(paymentKey)?.count ?? 0) + 1,
      revenue: (paymentMix.get(paymentKey)?.revenue ?? 0) + order.total,
    });

    const deliveryKey = order.deliveryType;
    const deliveryLabel = deliveryKey === "DELIVERY" ? "Domicilio" : "Recoger";
    deliveryMix.set(deliveryKey, {
      label: deliveryLabel,
      count: (deliveryMix.get(deliveryKey)?.count ?? 0) + 1,
      revenue: (deliveryMix.get(deliveryKey)?.revenue ?? 0) + order.total,
    });

    for (const item of order.items) {
      const productName = item.productName ?? "Producto sin nombre";
      productSales.set(productName, {
        quantity: (productSales.get(productName)?.quantity ?? 0) + item.quantity,
        revenue: (productSales.get(productName)?.revenue ?? 0) + item.quantity * item.unitPrice,
      });
    }
  }

  for (const order of customerOrders) {
    const dates = customerOrderDates.get(order.contactId) ?? [];
    dates.push(order.createdAt);
    customerOrderDates.set(order.contactId, dates);
    lastOrderByContact.set(order.contactId, order.createdAt);
    if (order.createdAt >= thirtyDaysAgo) {
      orders30ByContact.set(order.contactId, (orders30ByContact.get(order.contactId) ?? 0) + 1);
    }
    if (order.createdAt >= ninetyDaysAgo) {
      orders90ByContact.set(order.contactId, (orders90ByContact.get(order.contactId) ?? 0) + 1);
    }
  }

  const deliveryMinutesToday: number[] = [];
  const deliveryMinutesThisMonth: number[] = [];
  for (const order of deliveredOrdersThisMonth) {
    const deliveredEvent = order.events[0];
    if (!deliveredEvent) continue;
    const minutes = (deliveredEvent.createdAt.getTime() - order.createdAt.getTime()) / 60000;
    if (minutes < 0) continue;
    deliveryMinutesThisMonth.push(minutes);
    if (order.createdAt >= startOfToday) deliveryMinutesToday.push(minutes);
  }
  const avgDeliveryMinutesToday =
    deliveryMinutesToday.length > 0 ? Math.round(deliveryMinutesToday.reduce((a, b) => a + b, 0) / deliveryMinutesToday.length) : null;
  const avgDeliveryMinutesThisMonth =
    deliveryMinutesThisMonth.length > 0
      ? Math.round(deliveryMinutesThisMonth.reduce((a, b) => a + b, 0) / deliveryMinutesThisMonth.length)
      : null;

  const ordersByStatus: Record<string, number> = {};
  for (const row of ordersByStatusRaw) ordersByStatus[row.status] = row._count.status;

  const riskByType: MetricsDTO["riskByType"] = {
    AWAITING_PAYMENT_STALE: 0,
    RECEIVED_STALE: 0,
    READY_FOR_PICKUP_STALE: 0,
    READY_FOR_DISPATCH_STALE: 0,
  };
  let proactiveAlertsLast30Days = 0;
  for (const event of recentOrderEvents) {
    const note = event.note ?? "";
    if (note.includes("AUTO_CUSTOMER_ALERT:")) proactiveAlertsLast30Days += 1;
    if (note.includes("AUTO_CUSTOMER_ALERT:AWAITING_PAYMENT_STALE") || note.includes("ALERTA OPERATIVA: Pedido esperando confirmacion de pago")) {
      riskByType.AWAITING_PAYMENT_STALE = (riskByType.AWAITING_PAYMENT_STALE ?? 0) + 1;
    }
    if (note.includes("AUTO_CUSTOMER_ALERT:RECEIVED_STALE") || note.includes("ALERTA OPERATIVA: Pedido en preparacion")) {
      riskByType.RECEIVED_STALE = (riskByType.RECEIVED_STALE ?? 0) + 1;
    }
    if (note.includes("AUTO_CUSTOMER_ALERT:READY_FOR_PICKUP_STALE") || note.includes("ALERTA OPERATIVA: Pedido listo para recoger")) {
      riskByType.READY_FOR_PICKUP_STALE = (riskByType.READY_FOR_PICKUP_STALE ?? 0) + 1;
    }
    if (note.includes("AUTO_CUSTOMER_ALERT:READY_FOR_DISPATCH_STALE") || note.includes("ALERTA OPERATIVA: Pedido listo esperando despacho")) {
      riskByType.READY_FOR_DISPATCH_STALE = (riskByType.READY_FOR_DISPATCH_STALE ?? 0) + 1;
    }
  }

  const handoffRate =
    totalConversations30Days > 0 ? Math.round((handoffConversations.length / totalConversations30Days) * 100) : 0;
  const conversationToOrderConversionRate =
    totalConversations30Days > 0 ? Math.round((convertedConversations30Days / totalConversations30Days) * 100) : 0;

  const topSellingProducts = [...productSales.entries()]
    .map(([productName, values]) => ({ productName, quantity: values.quantity, revenue: values.revenue }))
    .sort((a, b) => (b.quantity !== a.quantity ? b.quantity - a.quantity : b.revenue - a.revenue))
    .slice(0, 5);

  const peakOrderHours = [...peakHours.entries()]
    .map(([hour, orderCount]) => ({ hour, orderCount }))
    .sort((a, b) => (b.orderCount !== a.orderCount ? b.orderCount - a.orderCount : a.hour - b.hour))
    .slice(0, 5);

  const paymentMethodMix = [...paymentMix.entries()]
    .map(([key, values]) => ({ key, label: values.label, count: values.count, revenue: values.revenue }))
    .sort((a, b) => b.count - a.count);

  const deliveryTypeMix = [...deliveryMix.entries()]
    .map(([key, values]) => ({ key, label: values.label, count: values.count, revenue: values.revenue }))
    .sort((a, b) => b.count - a.count);

  const recentCustomersCount = [...lastOrderByContact.values()].filter((lastOrderAt) => lastOrderAt >= thirtyDaysAgo).length;
  const frequentCustomersCount = [...orders90ByContact.values()].filter((orderCount) => orderCount >= 3).length;
  const dormantCustomersCount = [...lastOrderByContact.values()].filter((lastOrderAt) => lastOrderAt < thirtyDaysAgo).length;
  const repeatCustomers30Days = [...orders30ByContact.values()].filter((orderCount) => orderCount >= 2).length;
  const repeatPurchaseRate30Days =
    recentCustomersCount > 0 ? Math.round((repeatCustomers30Days / recentCustomersCount) * 100) : 0;

  const daysBetweenOrdersSamples: number[] = [];
  for (const orderDates of customerOrderDates.values()) {
    for (let index = 1; index < orderDates.length; index += 1) {
      const previousOrder = orderDates[index - 1];
      const currentOrder = orderDates[index];
      if (!previousOrder || !currentOrder) continue;
      const days = (currentOrder.getTime() - previousOrder.getTime()) / 86_400_000;
      if (days >= 0) daysBetweenOrdersSamples.push(days);
    }
  }
  const avgDaysBetweenOrders =
    daysBetweenOrdersSamples.length > 0
      ? Math.round((daysBetweenOrdersSamples.reduce((acc, value) => acc + value, 0) / daysBetweenOrdersSamples.length) * 10) / 10
      : null;

  const customerSegments: MetricsDTO["customerSegments"] = [
    { key: "recent", label: "Recientes", count: recentCustomersCount, description: "Compraron durante los ultimos 30 dias" },
    { key: "frequent", label: "Frecuentes", count: frequentCustomersCount, description: "Hicieron 3 o mas pedidos en los ultimos 90 dias" },
    { key: "dormant", label: "Dormidos", count: dormantCustomersCount, description: "Ya compraron antes, pero llevan mas de 30 dias sin volver" },
  ];

  return {
    ordersToday,
    ordersLast7Days,
    ordersLast30Days,
    revenueToday: revenueTodayAgg._sum.total ?? 0,
    revenueThisMonth: revenueMonthAgg._sum.total ?? 0,
    avgTicket,
    avgPrepMinutes,
    avgDeliveryMinutesToday,
    avgDeliveryMinutesThisMonth,
    estimatedPrepMinutes: settings.estimatedPrepMinutes,
    currency: settings.currency,
    totalConversations30Days,
    handoffRate,
    ordersByStatus,
    riskOrdersOpen: openRiskOrders,
    proactiveAlertsLast30Days,
    riskByType,
    paymentConfirmationSlaMinutes: averageMinutes(paymentConfirmationMinutes),
    paymentConfirmationSampleCount: paymentConfirmationMinutes.length,
    kitchenSlaMinutes: averageMinutes(kitchenSlaMinutes),
    kitchenSampleCount: kitchenSlaMinutes.length,
    dispatchSlaMinutes: averageMinutes(dispatchSlaMinutes),
    dispatchSampleCount: dispatchSlaMinutes.length,
    deliveryLegSlaMinutes: averageMinutes(deliveryLegSlaMinutes),
    deliveryLegSampleCount: deliveryLegSlaMinutes.length,
    topSellingProducts,
    peakOrderHours,
    paymentMethodMix,
    deliveryTypeMix,
    conversationToOrderConversionRate,
    convertedConversations30Days,
    customerSegments,
    repeatCustomers30Days,
    repeatPurchaseRate30Days,
    avgDaysBetweenOrders,
  };
}

function calculateAverageDaysBetweenDates(orderDates: Date[]): number | null {
  if (orderDates.length < 2) return null;
  let totalDays = 0;
  let sampleCount = 0;
  for (let index = 1; index < orderDates.length; index += 1) {
    const previousOrder = orderDates[index - 1];
    const currentOrder = orderDates[index];
    if (!previousOrder || !currentOrder) continue;
    const days = (currentOrder.getTime() - previousOrder.getTime()) / 86_400_000;
    if (days >= 0) {
      totalDays += days;
      sampleCount += 1;
    }
  }
  if (sampleCount === 0) return null;
  return Math.round((totalDays / sampleCount) * 10) / 10;
}

export async function getCustomerSegmentCustomers(restaurantId: string, limit = 12): Promise<CustomerSegmentCustomersDTO> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const customerOrders = await prisma.order.findMany({
    where: { restaurantId, status: { not: OrderStatus.CANCELLED } },
    select: {
      contactId: true,
      createdAt: true,
      contact: { select: { name: true, phone: true } },
    },
    orderBy: [{ contactId: "asc" }, { createdAt: "asc" }],
  });

  const byContact = new Map<
    string,
    {
      customerName: string | null;
      phone: string;
      orderDates: Date[];
      ordersLast30Days: number;
      ordersLast90Days: number;
    }
  >();

  for (const order of customerOrders) {
    const existing = byContact.get(order.contactId) ?? {
      customerName: order.contact.name,
      phone: order.contact.phone,
      orderDates: [],
      ordersLast30Days: 0,
      ordersLast90Days: 0,
    };
    existing.customerName = order.contact.name;
    existing.phone = order.contact.phone;
    existing.orderDates.push(order.createdAt);
    if (order.createdAt >= thirtyDaysAgo) existing.ordersLast30Days += 1;
    if (order.createdAt >= ninetyDaysAgo) existing.ordersLast90Days += 1;
    byContact.set(order.contactId, existing);
  }

  const recent: CustomerSegmentCustomersDTO["recent"] = [];
  const frequent: CustomerSegmentCustomersDTO["frequent"] = [];
  const dormant: CustomerSegmentCustomersDTO["dormant"] = [];

  for (const [contactId, customer] of byContact.entries()) {
    const lastOrderAt = customer.orderDates[customer.orderDates.length - 1];
    if (!lastOrderAt) continue;
    const daysSinceLastOrder = Math.max(0, Math.floor((now.getTime() - lastOrderAt.getTime()) / 86_400_000));
    const dto: CustomerSegmentCustomersDTO["recent"][number] = {
      contactId,
      customerName: customer.customerName,
      phone: customer.phone,
      lastOrderAt: lastOrderAt.toISOString(),
      daysSinceLastOrder,
      totalOrders: customer.orderDates.length,
      ordersLast30Days: customer.ordersLast30Days,
      ordersLast90Days: customer.ordersLast90Days,
      avgDaysBetweenOrders: calculateAverageDaysBetweenDates(customer.orderDates),
    };

    if (lastOrderAt >= thirtyDaysAgo) recent.push(dto);
    if (customer.ordersLast90Days >= 3) frequent.push(dto);
    if (lastOrderAt < thirtyDaysAgo) dormant.push(dto);
  }

  const sortByPriority = (
    left: CustomerSegmentCustomersDTO["recent"][number],
    right: CustomerSegmentCustomersDTO["recent"][number],
  ) => {
    if (right.ordersLast30Days !== left.ordersLast30Days) return right.ordersLast30Days - left.ordersLast30Days;
    if (right.ordersLast90Days !== left.ordersLast90Days) return right.ordersLast90Days - left.ordersLast90Days;
    return new Date(right.lastOrderAt).getTime() - new Date(left.lastOrderAt).getTime();
  };

  const sortDormant = (
    left: CustomerSegmentCustomersDTO["dormant"][number],
    right: CustomerSegmentCustomersDTO["dormant"][number],
  ) => {
    if (right.daysSinceLastOrder !== left.daysSinceLastOrder) return right.daysSinceLastOrder - left.daysSinceLastOrder;
    if (right.totalOrders !== left.totalOrders) return right.totalOrders - left.totalOrders;
    return new Date(right.lastOrderAt).getTime() - new Date(left.lastOrderAt).getTime();
  };

  return {
    recent: recent.sort(sortByPriority).slice(0, limit),
    frequent: frequent.sort(sortByPriority).slice(0, limit),
    dormant: dormant.sort(sortDormant).slice(0, limit),
  };
}

/** Ventas/pedidos en un rango de fechas arbitrario, para el filtro de historial del panel. */
export async function getMetricsForRange(restaurantId: string, from: Date, to: Date): Promise<RangeMetricsDTO> {
  const settings = await getBusinessSettings(restaurantId);

  const [orderCount, revenueAgg] = await Promise.all([
    prisma.order.count({
      where: { restaurantId, createdAt: { gte: from, lte: to }, status: { not: OrderStatus.CANCELLED } },
    }),
    prisma.order.aggregate({
      where: { restaurantId, createdAt: { gte: from, lte: to }, status: { not: OrderStatus.CANCELLED } },
      _sum: { total: true },
    }),
  ]);

  const revenue = revenueAgg._sum.total ?? 0;

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    orderCount,
    revenue,
    avgTicket: orderCount > 0 ? Math.round(revenue / orderCount) : 0,
    currency: settings.currency,
  };
}
