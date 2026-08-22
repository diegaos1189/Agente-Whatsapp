import { prisma } from "../../db/prisma.js";
import type { BusinessSettingsDTO, TransferAccountDTO } from "@pollos/shared";

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export type OpeningHours = Partial<Record<WeekdayKey, { open: string; close: string } | null>>;

let settingsCache: { value: BusinessSettingsDTO; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

function toDTO(row: NonNullable<Awaited<ReturnType<typeof prisma.businessSettings.findFirst>>>): BusinessSettingsDTO {
  return {
    id: row.id,
    restaurantName: row.restaurantName,
    logoUrl: row.logoUrl,
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
  };
}

/** Lee la configuracion del negocio (fila unica) con cache corta en memoria. */
export async function getBusinessSettings(): Promise<BusinessSettingsDTO> {
  if (settingsCache && settingsCache.expiresAt > Date.now()) {
    return settingsCache.value;
  }

  const row = await prisma.businessSettings.findFirst();
  if (!row) {
    throw new Error("business_settings no tiene ninguna fila. Corre el seed: npm run prisma:seed");
  }

  const dto = toDTO(row);
  settingsCache = { value: dto, expiresAt: Date.now() + CACHE_TTL_MS };
  return dto;
}

export function invalidateBusinessSettingsCache(): void {
  settingsCache = null;
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
