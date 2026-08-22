import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { ConversationStatus, MessageDirection, MessageType, OrderFlowStep, type OrderFlowStep as OrderFlowStepType } from "@pollos/shared";
import { prisma } from "../../db/prisma.js";
import { logger } from "../../utils/logger.js";
import type { CheckoutStateSnapshot } from "../orders/checkoutService.js";
import { computeCheckoutFingerprint } from "../orders/checkoutService.js";
import type { StructuredCartState } from "./structuredCart.js";
import type { OrderFlowState } from "./orderFlow.js";
import { getBusinessSettings } from "../business/businessHoursService.js";
import { getWhatsAppClient } from "../whatsapp/whatsappClient.js";
import { canBotAutoReply } from "./conversationHandoff.js";

const RECOVERY_SCAN_INTERVAL_MS = 30_000;
const RECOVERY_LEASE_TTL_MS = 60_000;
const MAX_DUE_RECOVERIES_PER_TICK = 20;
const OPT_OUT_PATTERNS = [
  /\bno me escriban\b/i,
  /\bno me escriba\b/i,
  /\bno quiero que me escriban\b/i,
  /\bno quiero recordatorios\b/i,
  /\bdejen de escribirme\b/i,
];
const RESUME_PATTERNS = [
  /\bcontinuemos\b/i,
  /\bsigamos\b/i,
  /\bmande eso\b/i,
  /\bque tenia\b/i,
  /\bque tenia pendiente\b/i,
  /\bque llevaba\b/i,
  /\bdele pues\b/i,
];
const CANCEL_PATTERNS = [
  /\bdejelo asi\b/i,
  /\bdejelo ahi\b/i,
  /\bya no\b/i,
  /\bcancele eso\b/i,
  /\bno voy a pedir\b/i,
];

const db = prisma as typeof prisma & {
  cartRecovery: any;
};

export type CartRecoveryStatus =
  | "PENDING"
  | "SENT"
  | "RESUMED"
  | "CANCELLED"
  | "CONVERTED"
  | "NOT_ELIGIBLE"
  | "EXPIRED";

export interface CartRecoveryContext {
  orderFlow: OrderFlowState;
  activeCart?: StructuredCartState | null;
  checkout?: CheckoutStateSnapshot | null;
}

export interface CartRecoveryEligibilityResult {
  eligible: boolean;
  reason:
    | "NO_ACTIVE_CART"
    | "RECOVERY_DISABLED"
    | "MAX_ATTEMPTS_REACHED"
    | "HUMAN_HANDOFF"
    | "CONVERSATION_CLOSED"
    | "OPT_OUT"
    | "ORDER_ALREADY_CREATED"
    | "CUSTOMER_RETURNED"
    | "WHATSAPP_WINDOW_CLOSED"
    | "BOT_OWNERSHIP_BLOCKED"
    | "OK";
}

function hasStructuredItems(activeCart: StructuredCartState | null | undefined): boolean {
  return Boolean(activeCart?.items?.length);
}

function hasLegacyCart(state: OrderFlowState | null | undefined): boolean {
  return Boolean(state?.cart?.length);
}

export function hasRecoverableCartContext(context: CartRecoveryContext | null | undefined): boolean {
  if (!context) return false;
  if (context.checkout?.status === "ORDER_CREATED") return false;
  return hasStructuredItems(context.activeCart) || hasLegacyCart(context.orderFlow);
}

export function isCommercialCartStep(step: OrderFlowStepType | null | undefined): boolean {
  if (!step) return false;
  return step !== OrderFlowStep.IDLE && step !== OrderFlowStep.DONE;
}

export function computeCartRecoveryFingerprint(context: CartRecoveryContext): string {
  return computeCheckoutFingerprint(context.orderFlow, context.activeCart ?? null);
}

export function isCartRecoveryOptOutMessage(text: string): boolean {
  return OPT_OUT_PATTERNS.some((pattern) => pattern.test(text));
}

export function isCartRecoveryResumeMessage(text: string): boolean {
  return RESUME_PATTERNS.some((pattern) => pattern.test(text));
}

export function isCartRecoveryCancelMessage(text: string): boolean {
  return CANCEL_PATTERNS.some((pattern) => pattern.test(text));
}

export function canSendCartRecovery(params: {
  recoveryEnabled: boolean;
  attempts: number;
  maxAttempts: number;
  conversationStatus: string;
  isHandoff: boolean;
  hasRecoverableCart: boolean;
  checkoutStatus: CheckoutStateSnapshot["status"] | null;
  optedOutAt: Date | null;
  lastMessageAt: Date | null;
  now: Date;
  whatsappProvider: string;
}): CartRecoveryEligibilityResult {
  if (!params.hasRecoverableCart) return { eligible: false, reason: "NO_ACTIVE_CART" };
  if (!params.recoveryEnabled) return { eligible: false, reason: "RECOVERY_DISABLED" };
  if (params.attempts >= params.maxAttempts) return { eligible: false, reason: "MAX_ATTEMPTS_REACHED" };
  if (params.optedOutAt) return { eligible: false, reason: "OPT_OUT" };
  if (params.checkoutStatus === "ORDER_CREATED") return { eligible: false, reason: "ORDER_ALREADY_CREATED" };
  if (params.isHandoff) return { eligible: false, reason: "HUMAN_HANDOFF" };
  if (
    params.conversationStatus === ConversationStatus.HUMAN ||
    params.conversationStatus === ConversationStatus.WAITING_HUMAN
  ) {
    return { eligible: false, reason: "HUMAN_HANDOFF" };
  }
  if (params.conversationStatus === ConversationStatus.CLOSED) {
    return { eligible: false, reason: "CONVERSATION_CLOSED" };
  }
  if (!canBotAutoReply({ status: params.conversationStatus, isHandoff: params.isHandoff, assignedAdminUserId: null })) {
    return { eligible: false, reason: "BOT_OWNERSHIP_BLOCKED" };
  }
  if (params.whatsappProvider === "meta" && params.lastMessageAt) {
    const hoursSinceLastMessage = (params.now.getTime() - params.lastMessageAt.getTime()) / 3_600_000;
    if (hoursSinceLastMessage >= 24) {
      return { eligible: false, reason: "WHATSAPP_WINDOW_CLOSED" };
    }
  }
  return { eligible: true, reason: "OK" };
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

async function createRecoveryAuditEvent(conversationId: string, eventType: string, reason?: string | null, note?: string | null) {
  await prisma.conversationAuditEvent.create({
    data: {
      conversationId,
      adminUserId: null,
      eventType,
      reason: reason ?? null,
      note: note ?? null,
    },
  });
}

async function upsertPendingRecovery(params: {
  conversationId: string;
  contactId: string;
  context: CartRecoveryContext;
  lastMessageAt: Date;
  delayMinutes: number;
}): Promise<void> {
  const fingerprint = computeCartRecoveryFingerprint(params.context);
  const openRecovery = await db.cartRecovery.findFirst({
    where: {
      conversationId: params.conversationId,
      status: { in: ["PENDING", "SENT"] },
    },
    orderBy: { createdAt: "desc" },
  });

  const scheduledCheckAt = addMinutes(params.lastMessageAt, params.delayMinutes);

  if (openRecovery?.status === "PENDING") {
    await db.cartRecovery.update({
      where: { id: openRecovery.id },
      data: {
        cartFingerprint: fingerprint,
        scheduledCheckAt,
        lastCustomerMessageAt: params.lastMessageAt,
        notEligibleReason: null,
      },
    });
    return;
  }

  if (openRecovery?.status === "SENT") {
    return;
  }

  await db.cartRecovery.create({
    data: {
      conversationId: params.conversationId,
      contactId: params.contactId,
      cartFingerprint: fingerprint,
      scheduledCheckAt,
      lastCustomerMessageAt: params.lastMessageAt,
    },
  });
  await createRecoveryAuditEvent(params.conversationId, "CART_ABANDONED", null, `Check programado para ${scheduledCheckAt.toISOString()}`);
}

async function cancelOpenRecoveries(conversationId: string, reason: string, status: Extract<CartRecoveryStatus, "CANCELLED" | "EXPIRED" | "NOT_ELIGIBLE" | "RESUMED" | "CONVERTED">) {
  const now = new Date();
  const openRecoveries = await db.cartRecovery.findMany({
    where: { conversationId, status: { in: ["PENDING", "SENT"] } },
  });
  for (const recovery of openRecoveries) {
    await db.cartRecovery.update({
      where: { id: recovery.id },
      data: {
        status,
        notEligibleReason: reason,
        cancelledAt: status === "CANCELLED" ? now : recovery.cancelledAt,
        resumedAt: status === "RESUMED" ? now : recovery.resumedAt,
        lastEvaluatedAt: now,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
  }
}

export async function recordCartRecoveryOptOut(params: {
  contactId: string;
  conversationId: string;
  reason: string;
}): Promise<void> {
  const now = new Date();
  await prisma.contact.update({
    where: { id: params.contactId },
    data: {
      cartRecoveryOptOutAt: now,
      cartRecoveryOptOutReason: params.reason,
    },
  });
  await cancelOpenRecoveries(params.conversationId, "OPT_OUT", "CANCELLED");
  await createRecoveryAuditEvent(params.conversationId, "RECOVERY_CANCELLED", "OPT_OUT", params.reason);
}

export async function markRecoveryReplied(params: {
  conversationId: string;
  note: string;
}): Promise<void> {
  const openRecovery = await db.cartRecovery.findFirst({
    where: { conversationId: params.conversationId, status: "SENT" },
    orderBy: { createdAt: "desc" },
  });
  if (!openRecovery) return;
  await db.cartRecovery.update({
    where: { id: openRecovery.id },
    data: {
      status: "RESUMED",
      resumedAt: new Date(),
      lastEvaluatedAt: new Date(),
      notEligibleReason: null,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
  await createRecoveryAuditEvent(params.conversationId, "RECOVERY_REPLIED", null, params.note);
}

export async function markRecoveryCancelled(params: {
  conversationId: string;
  note: string;
}): Promise<void> {
  await cancelOpenRecoveries(params.conversationId, "CUSTOMER_CANCELLED", "CANCELLED");
  await createRecoveryAuditEvent(params.conversationId, "RECOVERY_CANCELLED", "CUSTOMER_CANCELLED", params.note);
}

export async function markRecoveryConverted(params: {
  conversationId: string;
  orderId: string;
  orderCode: string;
}): Promise<void> {
  const openRecovery = await db.cartRecovery.findFirst({
    where: { conversationId: params.conversationId, status: { in: ["PENDING", "SENT", "RESUMED"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!openRecovery) return;
  await db.cartRecovery.update({
    where: { id: openRecovery.id },
    data: {
      status: "CONVERTED",
      convertedOrderId: params.orderId,
      lastEvaluatedAt: new Date(),
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
  await createRecoveryAuditEvent(params.conversationId, "RECOVERY_CONVERTED", null, params.orderCode);
}

export async function findLatestSentCartRecovery(conversationId: string): Promise<{
  id: string;
  status: CartRecoveryStatus;
  reminderSentAt: Date | null;
} | null> {
  const recovery = await db.cartRecovery.findFirst({
    where: { conversationId, status: "SENT" },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, reminderSentAt: true },
  });
  return recovery ?? null;
}

export async function syncCartRecoveryFromConversation(params: {
  conversationId: string;
  contactId: string;
  context: CartRecoveryContext;
  lastMessageAt: Date | null;
}): Promise<void> {
  if (!params.lastMessageAt) return;

  const settings = await getBusinessSettings();
  if (!settings.cartRecoveryEnabled) return;

  const contact = await prisma.contact.findUnique({
    where: { id: params.contactId },
    select: { cartRecoveryOptOutAt: true },
  });
  if (contact?.cartRecoveryOptOutAt) {
    await cancelOpenRecoveries(params.conversationId, "OPT_OUT", "CANCELLED");
    return;
  }

  if (!hasRecoverableCartContext(params.context) || !isCommercialCartStep(params.context.orderFlow.step)) {
    await cancelOpenRecoveries(params.conversationId, "NO_ACTIVE_CART", "EXPIRED");
    return;
  }

  if (params.context.checkout?.status === "ORDER_CREATED") {
    await cancelOpenRecoveries(params.conversationId, "ORDER_ALREADY_CREATED", "CONVERTED");
    return;
  }

  await upsertPendingRecovery({
    conversationId: params.conversationId,
    contactId: params.contactId,
    context: params.context,
    lastMessageAt: params.lastMessageAt,
    delayMinutes: settings.cartRecoveryDelayMinutes,
  });
}

async function claimRecoveryLease(recoveryId: string, leaseToken: string, now: Date): Promise<boolean> {
  const updated = await db.cartRecovery.updateMany({
    where: {
      id: recoveryId,
      status: "PENDING",
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    },
    data: {
      leaseToken,
      leaseExpiresAt: new Date(now.getTime() + RECOVERY_LEASE_TTL_MS),
      lastEvaluatedAt: now,
    },
  });
  return updated.count === 1;
}

async function releaseRecoveryLease(recoveryId: string, leaseToken: string): Promise<void> {
  await db.cartRecovery.updateMany({
    where: { id: recoveryId, leaseToken },
    data: {
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
}

async function saveRecoveryOutboundMessage(conversationId: string, body: string): Promise<void> {
  await prisma.message.create({
    data: {
      conversationId,
      direction: MessageDirection.OUTBOUND,
      type: MessageType.TEXT,
      senderType: "BOT",
      body,
    },
  });
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
}

async function processRecovery(recoveryId: string, now: Date): Promise<void> {
  const leaseToken = randomUUID();
  const acquired = await claimRecoveryLease(recoveryId, leaseToken, now);
  if (!acquired) return;

  try {
    const settings = await getBusinessSettings();
    const recovery = await db.cartRecovery.findUnique({
      where: { id: recoveryId },
      include: {
        contact: true,
        conversation: true,
      },
    });
    if (!recovery) return;

    const context = recovery.conversation?.context as CartRecoveryContext | null;
    const eligibility = canSendCartRecovery({
      recoveryEnabled: settings.cartRecoveryEnabled,
      attempts: recovery.attempts,
      maxAttempts: settings.cartRecoveryMaxAttempts,
      conversationStatus: recovery.conversation.status,
      isHandoff: recovery.conversation.isHandoff,
      hasRecoverableCart: hasRecoverableCartContext(context),
      checkoutStatus: context?.checkout?.status ?? null,
      optedOutAt: recovery.contact.cartRecoveryOptOutAt,
      lastMessageAt: recovery.conversation.lastMessageAt,
      now,
      whatsappProvider: settings.whatsappProvider,
    });

    if (!eligibility.eligible) {
      await db.cartRecovery.update({
        where: { id: recovery.id },
        data: {
          status: "NOT_ELIGIBLE",
          notEligibleReason: eligibility.reason,
          lastEvaluatedAt: now,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      await createRecoveryAuditEvent(recovery.conversationId, "RECOVERY_NOT_ELIGIBLE", eligibility.reason, null);
      return;
    }

    const orderCreatedMeanwhile = await prisma.order.findFirst({
      where: { contactId: recovery.contactId, createdAt: { gte: recovery.createdAt } },
      orderBy: { createdAt: "desc" },
      select: { id: true, code: true },
    });
    if (orderCreatedMeanwhile) {
      await db.cartRecovery.update({
        where: { id: recovery.id },
        data: {
          status: "CONVERTED",
          convertedOrderId: orderCreatedMeanwhile.id,
          notEligibleReason: "ORDER_ALREADY_CREATED",
          lastEvaluatedAt: now,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      await createRecoveryAuditEvent(recovery.conversationId, "RECOVERY_NOT_ELIGIBLE", "ORDER_ALREADY_CREATED", orderCreatedMeanwhile.code);
      return;
    }

    if ((recovery.conversation.lastMessageAt?.getTime() ?? 0) > recovery.lastCustomerMessageAt.getTime()) {
      await db.cartRecovery.update({
        where: { id: recovery.id },
        data: {
          status: "NOT_ELIGIBLE",
          notEligibleReason: "CUSTOMER_RETURNED",
          lastEvaluatedAt: now,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      await createRecoveryAuditEvent(recovery.conversationId, "RECOVERY_NOT_ELIGIBLE", "CUSTOMER_RETURNED", null);
      return;
    }

    const client = await getWhatsAppClient();
    const sendResult = await client.sendTextMessage(recovery.contact.phone, settings.cartRecoveryMessage);
    if (!sendResult.success) {
      await db.cartRecovery.update({
        where: { id: recovery.id },
        data: {
          status: "NOT_ELIGIBLE",
          notEligibleReason: "SEND_FAILED",
          lastEvaluatedAt: now,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      await createRecoveryAuditEvent(recovery.conversationId, "RECOVERY_NOT_ELIGIBLE", "SEND_FAILED", null);
      return;
    }

    await saveRecoveryOutboundMessage(recovery.conversationId, settings.cartRecoveryMessage);
    await db.cartRecovery.update({
      where: { id: recovery.id },
      data: {
        status: "SENT",
        attempts: { increment: 1 },
        reminderSentAt: now,
        lastEvaluatedAt: now,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    await createRecoveryAuditEvent(recovery.conversationId, "RECOVERY_SENT", null, settings.cartRecoveryMessage);
  } catch (error) {
    logger.error({ err: error, recoveryId }, "Fallo procesando cart recovery");
    await releaseRecoveryLease(recoveryId, leaseToken);
  }
}

export async function processDueCartRecoveries(now: Date = new Date()): Promise<void> {
  const settings = await getBusinessSettings();
  if (!settings.cartRecoveryEnabled) return;

  const dueRecoveries = await db.cartRecovery.findMany({
    where: {
      status: "PENDING",
      scheduledCheckAt: { lte: now },
    },
    orderBy: { scheduledCheckAt: "asc" },
    take: MAX_DUE_RECOVERIES_PER_TICK,
    select: { id: true },
  });

  for (const recovery of dueRecoveries) {
    await processRecovery(recovery.id, now);
  }
}

let recoveryInterval: NodeJS.Timeout | null = null;

export function startCartRecoveryScheduler(): void {
  if (recoveryInterval) return;
  recoveryInterval = setInterval(() => {
    void processDueCartRecoveries().catch((error) => {
      logger.error({ err: error }, "Fallo el scheduler de cart recovery");
    });
  }, RECOVERY_SCAN_INTERVAL_MS);
  logger.info("Scheduler de cart recovery iniciado");
}
