import { prisma } from "../../db/prisma.js";
import type { BusinessSettingsDTO, TransferAccountDTO } from "@pollos/shared";
import { LOCAL_RESTAURANT_ID } from "../platform/restaurantContext.js";

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export type OpeningHours = Partial<Record<WeekdayKey, { open: string; close: string } | null>>;

// Cache por restaurante: con una sola entrada global, el panel de un negocio devolveria
// la configuracion de otro durante los 30s de TTL.
const settingsCache = new Map<string, { value: BusinessSettingsDTO; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

function toDTO(row: any): BusinessSettingsDTO {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    restaurantName: row.restaurantName,
    logoUrl: row.logoUrl,
    menuImages: row.menuImages ?? [],
    phone: row.phone,
    address: row.address,
    currency: row.currency,
    timezone: row.timezone,
    openingHours: row.openingHours as BusinessSettingsDTO["openingHours"],
    deliveryFee: row.deliveryFee,
    acceptsDelivery: row.acceptsDelivery,
    acceptsPickup: row.acceptsPickup,
    minimumDeliveryOrder: row.minimumDeliveryOrder,
    deliveryCoverageKeywords: row.deliveryCoverageKeywords,
    estimatedPrepMinutes: row.estimatedPrepMinutes,
    acceptsScheduledOrders: row.acceptsScheduledOrders,
    acceptedPaymentMethods: row.acceptedPaymentMethods,
    transferAccounts: (row.transferAccounts as unknown as TransferAccountDTO[]) ?? [],
    outOfHoursMessage: row.outOfHoursMessage,
    welcomeMessage: row.welcomeMessage,
    assistantTone: row.assistantTone,
    agentName: row.agentName,
    dailyArchiveTime: row.dailyArchiveTime,
    cartRecoveryEnabled: row.cartRecoveryEnabled,
    cartRecoveryDelayMinutes: row.cartRecoveryDelayMinutes,
    cartRecoveryMaxAttempts: row.cartRecoveryMaxAttempts,
    cartRecoveryMessage: row.cartRecoveryMessage,
    upsellEnabled: row.upsellEnabled,
    maxUpsellOffers: row.maxUpsellOffers,
    whatsappProvider: row.whatsappProvider,
    whatsappPhoneNumberId: row.whatsappPhoneNumberId,
    whatsappToken: row.whatsappToken,
    whatsappAppSecret: row.whatsappAppSecret,
    whatsappVerifyToken: row.whatsappVerifyToken,
    whatsappApiVersion: row.whatsappApiVersion,
    reactivationEnabled: row.reactivationEnabled,
    reactivationTemplateName: row.reactivationTemplateName,
    reactivationTemplateLanguage: row.reactivationTemplateLanguage,
    reactivationDormantDays: row.reactivationDormantDays,
    reactivationCooldownDays: row.reactivationCooldownDays,
  };
}

/**
 * Configuracion de un restaurante, con cache corta en memoria.
 *
 * El restaurante es explicito: el panel lo saca del header y el bot del numero de WhatsApp
 * que recibio el mensaje. El valor por defecto (el local) cubre el deployment de un solo
 * negocio, donde no hay nada que rutear.
 */
export async function getBusinessSettings(restaurantId: string = LOCAL_RESTAURANT_ID): Promise<BusinessSettingsDTO> {
  const cached = settingsCache.get(restaurantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const row = await prisma.businessSettings.findUnique({ where: { restaurantId } });
  if (!row) {
    throw new Error(`business_settings no tiene fila para el restaurante ${restaurantId}. Corre el seed: npm run prisma:seed`);
  }

  const dto = toDTO(row);
  settingsCache.set(restaurantId, { value: dto, expiresAt: Date.now() + CACHE_TTL_MS });
  return dto;
}

/** Sin argumento limpia la cache de todos los restaurantes (util en tests y al arrancar). */
export function invalidateBusinessSettingsCache(restaurantId?: string): void {
  if (restaurantId) settingsCache.delete(restaurantId);
  else settingsCache.clear();
}

function getNowInTimezone(timezone: string, at: Date): { weekday: WeekdayKey; hhmm: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);

  const weekdayRaw = parts.find((p) => p.type === "weekday")?.value.toLowerCase().slice(0, 3) ?? "mon";
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";

  return { weekday: weekdayRaw as WeekdayKey, hhmm: `${hour}:${minute}` };
}

export interface OpenStatus {
  isOpen: boolean;
  todayHours: { open: string; close: string } | null;
}

export function checkIsOpen(settings: BusinessSettingsDTO, at: Date = new Date()): OpenStatus {
  const { weekday, hhmm } = getNowInTimezone(settings.timezone, at);
  const todayHours = settings.openingHours[weekday] ?? null;

  if (!todayHours) {
    return { isOpen: false, todayHours: null };
  }

  const isOpen = hhmm >= todayHours.open && hhmm <= todayHours.close;
  return { isOpen, todayHours };
}
