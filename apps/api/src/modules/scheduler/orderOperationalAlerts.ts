import { logger } from "../../utils/logger.js";
import { prisma } from "../../db/prisma.js";
import { getBusinessSettings } from "../business/businessHoursService.js";
import { auditOrdersForOperationalRisk } from "../orders/orderService.js";
import { notifyOrderOperationalRisk } from "../conversation/conversationService.js";

const CHECK_INTERVAL_MS = 60_000;

/** Auditoria operativa de UN restaurante: su cola, su tiempo de preparacion, sus clientes. */
async function auditRestaurant(restaurantId: string): Promise<void> {
  const settings = await getBusinessSettings(restaurantId);
  const result = await auditOrdersForOperationalRisk({
    restaurantId,
    estimatedPrepMinutes: settings.estimatedPrepMinutes,
  });

  for (const hit of result.hits) {
    await notifyOrderOperationalRisk({
      orderId: hit.orderId,
      reason: hit.reason,
      delayMinutes: hit.delayMinutes,
    });
  }

  if (result.flagged > 0) {
    logger.warn({ restaurantId, flagged: result.flagged }, "Auditoria operativa marco pedidos en riesgo");
  }
}

async function tick(): Promise<void> {
  let restaurants: Array<{ id: string }>;
  try {
    restaurants = await prisma.platformRestaurant.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  } catch (error) {
    logger.error({ err: error }, "Fallo el scheduler de alertas operativas de pedidos");
    return;
  }

  // Un restaurante mal configurado no puede dejar sin auditar a los demas.
  for (const restaurant of restaurants) {
    try {
      await auditRestaurant(restaurant.id);
    } catch (error) {
      logger.error(
        { err: error, restaurantId: restaurant.id },
        "Fallo la auditoria operativa de pedidos de un restaurante",
      );
    }
  }
}

export function startOrderOperationalAlertsScheduler(): void {
  setInterval(tick, CHECK_INTERVAL_MS);
  logger.info("Scheduler de alertas operativas de pedidos iniciado");
}
