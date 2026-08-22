import { prisma } from "../../db/prisma.js";
import { OrderStatus } from "@pollos/shared";
import type { MetricsDTO, RangeMetricsDTO } from "@pollos/shared";
import { getBusinessSettings } from "../business/businessHoursService.js";

/**
 * Metricas operativas de los ultimos 30 dias: volumen de pedidos, ticket promedio,
 * tiempo real de preparacion (desde que se crea el pedido hasta que llega a READY o
 * DELIVERED, medido con order_events) comparado contra el estimado configurado, y que
 * porcentaje de conversaciones termino escalado a un humano.
 */
export async function getMetrics(): Promise<MetricsDTO> {
  const settings = await getBusinessSettings();
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    ordersToday,
    ordersLast7Days,
    ordersLast30Days,
    completedOrders,
    ordersByStatusRaw,
    totalConversations30Days,
    handoffConversations,
    revenueTodayAgg,
    revenueMonthAgg,
    deliveredOrdersThisMonth,
  ] = await Promise.all([
    prisma.order.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.order.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    prisma.order.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.order.findMany({
      where: { createdAt: { gte: thirtyDaysAgo }, status: { not: OrderStatus.CANCELLED } },
      select: { total: true, createdAt: true, events: { select: { status: true, createdAt: true } } },
    }),
    prisma.order.groupBy({ by: ["status"], _count: { status: true }, where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.conversation.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.handoff.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      select: { conversationId: true },
      distinct: ["conversationId"],
    }),
    prisma.order.aggregate({
      where: { createdAt: { gte: startOfToday }, status: { not: OrderStatus.CANCELLED } },
      _sum: { total: true },
    }),
    prisma.order.aggregate({
      where: { createdAt: { gte: startOfMonth }, status: { not: OrderStatus.CANCELLED } },
      _sum: { total: true },
    }),
    prisma.order.findMany({
      where: { createdAt: { gte: startOfMonth }, deliveryType: "DELIVERY", status: OrderStatus.DELIVERED },
      select: { createdAt: true, events: { where: { status: OrderStatus.DELIVERED }, select: { createdAt: true }, take: 1 } },
    }),
  ]);

  const avgTicket =
    completedOrders.length > 0
      ? Math.round(completedOrders.reduce((acc, o) => acc + o.total, 0) / completedOrders.length)
      : 0;

  const prepTimesMinutes: number[] = [];
  for (const order of completedOrders) {
    const readyEvent =
      order.events.find((e) => e.status === OrderStatus.READY) ??
      order.events.find((e) => e.status === OrderStatus.DELIVERED);
    if (!readyEvent) continue;
    const minutes = (readyEvent.createdAt.getTime() - order.createdAt.getTime()) / 60000;
    if (minutes >= 0) prepTimesMinutes.push(minutes);
  }
  const avgPrepMinutes =
    prepTimesMinutes.length > 0
      ? Math.round(prepTimesMinutes.reduce((a, b) => a + b, 0) / prepTimesMinutes.length)
      : null;

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

  const handoffRate =
    totalConversations30Days > 0 ? Math.round((handoffConversations.length / totalConversations30Days) * 100) : 0;

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
  };
}

/** Ventas/pedidos en un rango de fechas arbitrario, para el filtro de historial del panel. */
export async function getMetricsForRange(from: Date, to: Date): Promise<RangeMetricsDTO> {
  const settings = await getBusinessSettings();

  const [orderCount, revenueAgg] = await Promise.all([
    prisma.order.count({ where: { createdAt: { gte: from, lte: to }, status: { not: OrderStatus.CANCELLED } } }),
    prisma.order.aggregate({
      where: { createdAt: { gte: from, lte: to }, status: { not: OrderStatus.CANCELLED } },
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
