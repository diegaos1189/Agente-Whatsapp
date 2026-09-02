import { prisma } from "../../db/prisma.js";
import { getBusinessSettings } from "../business/businessHoursService.js";
import { ConversationStatus, OrderStatus } from "@pollos/shared";
import type { BusinessSettingsDTO } from "@pollos/shared";
import { logger } from "../../utils/logger.js";
import { runBackupIfDue } from "../backup/backupService.js";
import { listCatalog, invalidateCatalogCache } from "../products/productService.js";

const CHECK_INTERVAL_MS = 30_000;
const RETENTION_DAYS = 30;
const MORNING_CHECK_TIME = "05:00";

// Un restaurante en Bogota y otro en Ciudad de Mexico archivan a horas distintas y cada uno
// elige la suya, asi que la marca de "ya corrio" es por restaurante, no global. Con una sola
// variable, el primer negocio del dia le robaba la corrida a todos los demas.
const lastArchiveRunKey = new Map<string, string>();
const lastPurgeRunDay = new Map<string, string>();
const lastMaintenanceRunKey = new Map<string, string>();
const lastMorningCheckRunKey = new Map<string, string>();

/** true la primera vez que se ve esta clave para este restaurante (y la deja marcada). */
function claimRun(marks: Map<string, string>, restaurantId: string, key: string): boolean {
  if (marks.get(restaurantId) === key) return false;
  marks.set(restaurantId, key);
  return true;
}

async function archiveDueConversations(settings: BusinessSettingsDTO, currentTime: string, runKey: string): Promise<void> {
  if (currentTime !== settings.dailyArchiveTime) return;
  if (!claimRun(lastArchiveRunKey, settings.restaurantId, runKey)) return;

  const result = await prisma.conversation.updateMany({
    where: {
      restaurantId: settings.restaurantId,
      status: { in: [ConversationStatus.ACTIVE, ConversationStatus.WAITING_HUMAN] },
    },
    data: { status: ConversationStatus.CLOSED },
  });

  if (result.count > 0) {
    logger.info(
      { restaurantId: settings.restaurantId, count: result.count, at: runKey },
      "Archivo automatico diario de conversaciones ejecutado",
    );
  }
}

/**
 * Borra conversaciones archivadas (CLOSED) hace mas de 30 dias, junto con sus mensajes
 * y handoffs. Corre una vez por dia. Las conversaciones activas/en handoff nunca se tocan,
 * y las cerradas se conservan 30 dias (para que el bot pueda dar contexto a clientes que
 * vuelven) antes de purgarse.
 */
async function purgeExpiredConversations(settings: BusinessSettingsDTO, todayKey: string): Promise<void> {
  if (!claimRun(lastPurgeRunDay, settings.restaurantId, todayKey)) return;

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const expired = await prisma.conversation.findMany({
    where: { restaurantId: settings.restaurantId, status: ConversationStatus.CLOSED, updatedAt: { lt: cutoff } },
    select: { id: true },
  });
  if (expired.length === 0) return;

  const ids = expired.map((c) => c.id);
  await prisma.$transaction([
    prisma.message.deleteMany({ where: { conversationId: { in: ids } } }),
    prisma.handoff.deleteMany({ where: { conversationId: { in: ids } } }),
    prisma.conversation.deleteMany({ where: { id: { in: ids } } }),
  ]);

  logger.info(
    { restaurantId: settings.restaurantId, count: ids.length },
    "Purgadas conversaciones archivadas de mas de 30 dias",
  );
}

/**
 * Verifica que el token de WhatsApp siga vivo — el problema mas recurrente de esta app
 * (el token temporal de Meta vence cada 24h) queda registrado en el log ANTES de que un
 * cliente real le escriba al bot y no reciba respuesta.
 */
async function checkWhatsAppTokenHealth(settings: BusinessSettingsDTO): Promise<void> {
  if (settings.whatsappProvider !== "meta" || !settings.whatsappToken || !settings.whatsappPhoneNumberId) return;

  try {
    const res = await fetch(
      `https://graph.facebook.com/${settings.whatsappApiVersion}/${settings.whatsappPhoneNumberId}`,
      { headers: { Authorization: `Bearer ${settings.whatsappToken}` } },
    );
    if (!res.ok) {
      const body = await res.text();
      logger.error(
        { restaurantId: settings.restaurantId, negocio: settings.restaurantName, status: res.status, body },
        "⚠ Token de WhatsApp invalido o vencido — el bot no va a poder responder. Actualizalo desde Configuracion.",
      );
    } else {
      logger.info(
        { restaurantId: settings.restaurantId },
        "Token de WhatsApp verificado OK en el mantenimiento diario",
      );
    }
  } catch (error) {
    logger.warn({ err: error, restaurantId: settings.restaurantId }, "No se pudo verificar el token de WhatsApp (sin conexion?)");
  }
}

/** Resumen del dia en el log: pedidos, ventas, pendientes de pago, alertas sin revisar. */
async function logDailySummary(restaurantId: string, restaurantName: string): Promise<void> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [ordersToday, revenueAgg, awaitingPayment, flagged] = await Promise.all([
    prisma.order.count({ where: { restaurantId, createdAt: { gte: startOfToday } } }),
    prisma.order.aggregate({
      where: { restaurantId, createdAt: { gte: startOfToday }, status: { not: OrderStatus.CANCELLED } },
      _sum: { total: true },
    }),
    prisma.order.count({ where: { restaurantId, status: OrderStatus.AWAITING_PAYMENT } }),
    prisma.order.count({ where: { restaurantId, flaggedForReview: true } }),
  ]);

  logger.info(
    {
      restaurantId,
      negocio: restaurantName,
      ordersToday,
      revenueToday: revenueAgg._sum.total ?? 0,
      awaitingPayment,
      flaggedForReview: flagged,
    },
    "Resumen diario de mantenimiento",
  );
}

/**
 * Mantenimiento diario completo, a la misma hora configurada que el archivo de
 * conversaciones (BusinessSettings.dailyArchiveTime): backup de la base de datos, chequeo
 * de que el token de WhatsApp siga vivo, y un resumen del dia — para que el sistema quede
 * listo (y detectado cualquier problema) antes de que abra al dia siguiente.
 *
 * El backup es de la base entera, no de un restaurante: runBackupIfDue() ya se saltea solo
 * si el del dia ya se hizo, asi que llamarlo desde el mantenimiento de cada negocio hace
 * uno solo igual.
 */
async function runDailyMaintenance(settings: BusinessSettingsDTO, runKey: string): Promise<void> {
  if (!claimRun(lastMaintenanceRunKey, settings.restaurantId, runKey)) return;

  logger.info({ restaurantId: settings.restaurantId, at: runKey }, "Iniciando mantenimiento diario");
  await runBackupIfDue();
  await checkWhatsAppTokenHealth(settings);
  await logDailySummary(settings.restaurantId, settings.restaurantName);
  logger.info({ restaurantId: settings.restaurantId, at: runKey }, "Mantenimiento diario completado");
}

/**
 * Antes de abrir (5am): fuerza que el bot relea el catalogo desde cero (invalida la cache
 * de 30s) y revisa que este en buen estado para las ventas del dia — categorias vacias,
 * productos sin precio, combos que referencian algo borrado, promociones vencidas que
 * siguen marcadas activas. Todo queda en el log para revisar antes de que abran.
 */
async function runMorningReadinessCheck(settings: BusinessSettingsDTO, runKey: string): Promise<void> {
  const restaurantId = settings.restaurantId;
  if (!claimRun(lastMorningCheckRunKey, restaurantId, runKey)) return;

  invalidateCatalogCache(restaurantId);
  const categories = await listCatalog(restaurantId);
  const allProducts = categories.flatMap((c) => c.products);

  const emptyCategories = categories.filter((c) => c.products.length === 0).map((c) => c.name);
  const zeroPriceProducts = allProducts.filter((p) => p.price <= 0).map((p) => p.name);
  const brokenCombos = allProducts
    .filter((p) => p.isCombo && p.comboItems.length === 0)
    .map((p) => p.name);

  const activePromos = await prisma.promotion.findMany({ where: { restaurantId, isActive: true } });
  const now = new Date();
  const expiredButActive = activePromos.filter((p) => p.endsAt && p.endsAt < now).map((p) => p.title);

  const issues = { emptyCategories, zeroPriceProducts, brokenCombos, expiredButActive };
  const hasIssues = Object.values(issues).some((list) => list.length > 0);

  if (hasIssues) {
    logger.warn(
      { restaurantId, negocio: settings.restaurantName, ...issues },
      "⚠ Revision matutina del catalogo encontro problemas — revisar antes de que abran",
    );
  } else {
    logger.info(
      { restaurantId, categorias: categories.length, productosDisponibles: allProducts.length },
      "Catalogo revisado y listo para las ventas del dia",
    );
  }
}

/** Un turno de mantenimiento para un restaurante, en SU zona horaria y a SU hora configurada. */
async function tickRestaurant(restaurantId: string): Promise<void> {
  const settings = await getBusinessSettings(restaurantId);
  const now = new Date();
  const currentTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: settings.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: settings.timezone }).format(now);
  const runKey = `${todayKey}T${currentTime}`;

  await archiveDueConversations(settings, currentTime, runKey);
  await purgeExpiredConversations(settings, todayKey);
  if (currentTime === settings.dailyArchiveTime) {
    await runDailyMaintenance(settings, runKey);
  }
  if (currentTime === MORNING_CHECK_TIME) {
    await runMorningReadinessCheck(settings, runKey);
  }
}

async function tick(): Promise<void> {
  let restaurants: Array<{ id: string }>;
  try {
    restaurants = await prisma.platformRestaurant.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  } catch (error) {
    logger.error({ err: error }, "Fallo el scheduler de archivo/retencion/mantenimiento diario");
    return;
  }

  // El fallo de un restaurante (configuracion a medias, por ejemplo) no puede dejar sin
  // mantenimiento a los demas: cada uno se atiende y se loguea por separado.
  for (const restaurant of restaurants) {
    try {
      await tickRestaurant(restaurant.id);
    } catch (error) {
      logger.error(
        { err: error, restaurantId: restaurant.id },
        "Fallo el mantenimiento diario de un restaurante",
      );
    }
  }
}

/**
 * Revisa cada 30s si ya es la hora configurada (BusinessSettings.dailyArchiveTime) para:
 * archivar todas las conversaciones activas del dia, purgar conversaciones viejas, y
 * correr el mantenimiento diario completo (backup, salud del token de WhatsApp, resumen).
 *
 * Corre para cada restaurante activo de la plataforma, cada uno con su hora y su zona.
 */
export function startDailyArchiveScheduler(): void {
  setInterval(tick, CHECK_INTERVAL_MS);
  logger.info("Scheduler de archivo diario, retencion y mantenimiento iniciado");
}
