import { prisma } from "../../db/prisma.js";
import { logger } from "../../utils/logger.js";
import { checkIsOpen, getBusinessSettings } from "../business/businessHoursService.js";
import { getWhatsAppClient } from "../whatsapp/whatsappClient.js";
import { ConversationStatus, OrderStatus } from "@pollos/shared";

const db = prisma as any;

const REACTIVATION_SCAN_INTERVAL_MS = 10 * 60_000;
const MAX_REACTIVATIONS_PER_TICK = 20;

const OPT_IN_PATTERNS = [
  /\bacepto promociones\b/i,
  /\bquiero promociones\b/i,
  /\bsi quiero promociones\b/i,
  /\bpueden enviarme promociones\b/i,
  /\bautorizo promociones\b/i,
];

const OPT_OUT_PATTERNS = [
  /\bno promociones\b/i,
  /\bno quiero promociones\b/i,
  /\bdejen de enviar promociones\b/i,
  /\bstop\b/i,
  /\bbaja\b/i,
];

export function isMarketingOptInMessage(text: string): boolean {
  return OPT_IN_PATTERNS.some((pattern) => pattern.test(text));
}

export function isMarketingOptOutMessage(text: string): boolean {
  return OPT_OUT_PATTERNS.some((pattern) => pattern.test(text));
}

export async function recordMarketingOptIn(contactId: string, source: string): Promise<void> {
  await db.contact.update({
    where: { id: contactId },
    data: {
      marketingOptInAt: new Date(),
      marketingOptInSource: source,
      marketingOptOutAt: null,
      marketingOptOutReason: null,
    },
  });
}

export async function recordMarketingOptOut(contactId: string, reason: string): Promise<void> {
  await db.contact.update({
    where: { id: contactId },
    data: {
      marketingOptOutAt: new Date(),
      marketingOptOutReason: reason,
    },
  });
}

async function processEligibleReactivation(contactId: string, now: Date): Promise<void> {
  const settings = await getBusinessSettings();
  if (!settings.reactivationEnabled) return;
  if (settings.whatsappProvider !== "meta") return;
  if (!settings.reactivationTemplateName.trim()) return;
  if (!checkIsOpen(settings, now).isOpen) return;

  const contact = await db.contact.findUnique({
    where: { id: contactId },
    include: {
      orders: {
        where: { status: { not: OrderStatus.CANCELLED } },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      conversations: {
        where: {
          status: { in: [ConversationStatus.ACTIVE, ConversationStatus.HUMAN, ConversationStatus.WAITING_HUMAN] },
        },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      reactivationCampaigns: {
        where: { status: "SENT" },
        orderBy: { sentAt: "desc" },
        take: 1,
      },
    },
  });
  if (!contact) return;
  if (!contact.marketingOptInAt || contact.marketingOptOutAt) return;

  const lastOrder = contact.orders[0];
  if (!lastOrder) return;

  const dormantSince = (now.getTime() - lastOrder.createdAt.getTime()) / 86_400_000;
  if (dormantSince < settings.reactivationDormantDays) return;

  const activeConversation = contact.conversations[0];
  if (activeConversation?.lastMessageAt) {
    const minutesSinceLastMessage = (now.getTime() - activeConversation.lastMessageAt.getTime()) / 60_000;
    if (minutesSinceLastMessage < 30) return;
  }

  const lastCampaign = contact.reactivationCampaigns[0];
  if (lastCampaign?.sentAt) {
    const cooldownDays = (now.getTime() - lastCampaign.sentAt.getTime()) / 86_400_000;
    if (cooldownDays < settings.reactivationCooldownDays) return;
  }

  const client = await getWhatsAppClient();
  const sendResult = await client.sendTemplateMessage(
    contact.phone,
    settings.reactivationTemplateName,
    settings.reactivationTemplateLanguage,
  );

  await db.customerReactivationCampaign.create({
    data: {
      contactId: contact.id,
      status: sendResult.success ? "SENT" : "FAILED",
      templateName: settings.reactivationTemplateName,
      templateLanguage: settings.reactivationTemplateLanguage,
      dormantDays: Math.floor(dormantSince),
      lastOrderAt: lastOrder.createdAt,
      providerMessageId: sendResult.providerMessageId,
      skipReason: sendResult.success ? null : "SEND_FAILED",
      sentAt: sendResult.success ? now : null,
    },
  });
}

export async function processCustomerReactivationCampaigns(now: Date = new Date()): Promise<void> {
  const settings = await getBusinessSettings();
  if (!settings.reactivationEnabled) return;
  if (settings.whatsappProvider !== "meta") return;
  if (!settings.reactivationTemplateName.trim()) return;
  if (!checkIsOpen(settings, now).isOpen) return;

  const dormantThreshold = new Date(now.getTime() - settings.reactivationDormantDays * 86_400_000);
  const cooldownThreshold = new Date(now.getTime() - settings.reactivationCooldownDays * 86_400_000);

  const eligibleContacts = await db.contact.findMany({
    where: {
      marketingOptInAt: { not: null },
      marketingOptOutAt: null,
      orders: {
        some: {
          status: { not: OrderStatus.CANCELLED },
          createdAt: { lte: dormantThreshold },
        },
        none: {
          status: { not: OrderStatus.CANCELLED },
          createdAt: { gt: dormantThreshold },
        },
      },
      reactivationCampaigns: {
        none: {
          status: "SENT",
          sentAt: { gte: cooldownThreshold },
        },
      },
    },
    select: { id: true },
    take: MAX_REACTIVATIONS_PER_TICK,
  });

  for (const contact of eligibleContacts) {
    await processEligibleReactivation(contact.id, now);
  }
}

let reactivationInterval: NodeJS.Timeout | null = null;

export function startCustomerReactivationScheduler(): void {
  if (reactivationInterval) return;
  reactivationInterval = setInterval(() => {
    void processCustomerReactivationCampaigns().catch((error) => {
      logger.error({ err: error }, "Fallo el scheduler de reactivacion de clientes");
    });
  }, REACTIVATION_SCAN_INTERVAL_MS);
  logger.info("Scheduler de reactivacion de clientes iniciado");
}
