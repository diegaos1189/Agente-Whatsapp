import { logger } from "../../utils/logger.js";
import { getBusinessSettings } from "../business/businessHoursService.js";
import { auditOrdersForOperationalRisk } from "../orders/orderService.js";

const CHECK_INTERVAL_MS = 60_000;

async function tick(): Promise<void> {
  try {
    const settings = await getBusinessSettings();
    const result = await auditOrdersForOperationalRisk({
      estimatedPrepMinutes: settings.estimatedPrepMinutes,
    });

    if (result.flagged > 0) {
      logger.warn({ flagged: result.flagged }, "Auditoria operativa marco pedidos en riesgo");
    }
  } catch (error) {
    logger.error({ err: error }, "Fallo el scheduler de alertas operativas de pedidos");
  }
}

export function startOrderOperationalAlertsScheduler(): void {
  setInterval(tick, CHECK_INTERVAL_MS);
  logger.info("Scheduler de alertas operativas de pedidos iniciado");
}
