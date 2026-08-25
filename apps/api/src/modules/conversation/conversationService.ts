import { Prisma, type Conversation } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { logger } from "../../utils/logger.js";
import { messageContainsHandoffKeyword, repairTextEncodingArtifacts } from "../../utils/text.js";
import { formatCurrency } from "../../utils/currency.js";
import {
  ConversationStatus,
  HandoffReason,
  Intent,
  MessageDirection,
  MessageType,
  OrderFlowStep,
  OrderStatus,
  PaymentStatus,
  type PaymentMethod,
  type DeliveryType,
  type ComboItemDTO,
} from "@pollos/shared";
import { classifyIntent } from "../ai/intentClassifier.js";
import { extractEntities, EMPTY_ENTITIES, type ExtractedEntities } from "../ai/entityExtractor.js";
import { generateResponse } from "../ai/responseGenerator.js";
import { SAFE_FALLBACK_MESSAGE } from "../ai/guardrails.js";
import { transcribeAudio, describeImage } from "../ai/aiClient.js";
import { getWhatsAppClient } from "../whatsapp/whatsappClient.js";
import type { DownloadedMedia } from "../whatsapp/whatsappClient.js";
import { getBusinessSettings, checkIsOpen } from "../business/businessHoursService.js";
import {
  listCatalog,
  listActivePromotions,
  findBestProductMatch,
  findCategoryMatch,
  applyPromotionDiscount,
  isPromoActiveToday,
  getEffectivePrice,
  resolveProductReference,
  listAllProductsFlat,
  type ProductResolutionResult,
} from "../products/productService.js";
import {
  buildOrderStatusCustomerMessage,
  createOrder,
  getLatestOrderForContact,
  ORDER_STATUS_LABELS_ES,
  estimateDeliveryMinutes,
  type CartLine,
} from "../orders/orderService.js";
import { calculateCartPricing, formatCartPricingFacts } from "../orders/pricingService.js";
import {
  buildEmptyCheckoutState,
  buildCheckoutRecoveryPrompt,
  invalidateCheckoutState,
  isCheckoutSummaryStale,
  prepareCheckoutSummary,
  type CheckoutStateSnapshot,
} from "../orders/checkoutService.js";
import {
  decideOrderFlow,
  initialOrderFlowState,
  getPendingOrderQuestion,
  isExplicitCancelRequest,
  type OrderFlowState,
} from "./orderFlow.js";
import {
  EMPTY_STRUCTURED_CART,
  applyStructuredCartInstruction,
  createStructuredCartFromLegacyLines,
  exportStructuredCartLines,
  parseStructuredCartInstruction,
  summarizeStructuredCart,
  type StructuredCartState,
} from "./structuredCart.js";
import { n8nClient } from "../n8n/n8nClient.js";
import { findFaqMatch } from "../faq/faqService.js";
import { contactMessageProcessingCoordinator, type QueuedInboundMessage } from "./contactMessageProcessingCoordinator.js";
import {
  canBotAutoReply,
  isHumanHandoffStatus,
  mapAutomatedOutboundSenderType,
  mapInboundSenderType,
  type ConversationSenderType,
} from "./conversationHandoff.js";
import {
  formatRecentOrderChoices,
  isRepeatOrderRequest,
  prepareRepeatOrder,
  summarizeRepeatPreparation,
} from "./repeatOrder.js";
import { processWhatsAppAudio } from "./whatsappAudioService.js";
import {
  looksLikeOrderStatusFollowUp,
  resolveDeliveredConflict,
  resolveOrderStatusQuery,
  type OrderTrackingReferenceState,
} from "./orderStatusService.js";
import {
  isRegionalCancellation,
  isRegionalConfirmation,
  normalizeLocalizedText,
} from "../localization/localeService.js";
import {
  findLatestSentCartRecovery,
  isCartRecoveryCancelMessage,
  isCartRecoveryOptOutMessage,
  isCartRecoveryResumeMessage,
  markRecoveryCancelled,
  markRecoveryConverted,
  markRecoveryReplied,
  recordCartRecoveryOptOut,
  syncCartRecoveryFromConversation,
} from "./cartRecoveryService.js";
import {
  createUpsellAuditEvent,
  getCartRecommendations,
  isUpsellAcceptMessage,
  isUpsellOptOutMessage,
  isUpsellRejectMessage,
  isUpsellSuspendAllMessage,
  shouldOfferUpsellThisTurn,
} from "./recommendationService.js";
import { markPaymentReported } from "../payments/paymentService.js";
import {
  isMarketingOptInMessage,
  isMarketingOptOutMessage,
  recordMarketingOptIn,
  recordMarketingOptOut,
} from "../campaigns/customerReactivationService.js";

const ORDER_INTENTS: string[] = [Intent.ORDER_PRODUCT];
// Fuera de horario se responde con el mensaje de "cerrado" para casi todo — la unica
// excepcion es consultar el estado de un pedido ya hecho, que es info de autoservicio
// y no requiere que el negocio este abierto para atenderla.
const HOURS_GATED_INTENTS: string[] = Object.values(Intent).filter(
  (i) => i !== Intent.ORDER_STATUS && i !== Intent.COMPLAINT && i !== Intent.HUMAN_HANDOFF,
);
const MAX_FAILED_ATTEMPTS = 2;
const HISTORY_LIMIT = 8;

export interface InboundMessageInput {
  waMessageId: string;
  phone: string;
  name: string | null;
  type: "TEXT" | "IMAGE" | "AUDIO" | "UNKNOWN";
  text: string | null;
  mediaId: string | null;
  mediaMimeType?: string | null;
  providerTimestamp: string | null;
}

/** Que menu numerado se le acaba de mandar al cliente (para interpretar su proxima respuesta "1"/"2"/"3"). */
type PendingMenu = "WELCOME" | "RETURNING" | "CATEGORIES" | "PRODUCTS" | null;

interface PendingRepeatReplacement {
  sourceOrderId: string;
  sourceOrderCode: string;
  nextState: OrderFlowState;
  activeCart: StructuredCartState;
  issueMessages: string[];
}

interface RepeatOrderContextState {
  pendingReplacement?: PendingRepeatReplacement | null;
  lastSourceOrderId?: string | null;
  lastSourceOrderCode?: string | null;
}

interface OrderTrackingContextState extends OrderTrackingReferenceState {}

/** Estado de upsell/cross-sell del carrito actual — persistido en conversations.context
 * igual que orderFlow/activeCart (ver docs/UPSELLING.md). pendingProductId != null significa
 * que hay una oferta esperando respuesta del cliente ("de una" / "no gracias"). */
interface UpsellContextState {
  offeredProductIds: string[];
  rejectedProductIds: string[];
  pendingProductId: string | null;
  /** true si el cliente pidio explicitamente que no le ofrezcan mas adicionales este carrito. */
  suspended: boolean;
}

const DEFAULT_UPSELL_STATE: UpsellContextState = {
  offeredProductIds: [],
  rejectedProductIds: [],
  pendingProductId: null,
  suspended: false,
};

interface ConversationContext {
  orderFlow: OrderFlowState;
  pendingMenu?: PendingMenu;
  /** IDs de categoria mostrados numerados cuando pendingMenu === "CATEGORIES", en el mismo orden. */
  pendingCategoryIds?: string[] | null;
  /** IDs de producto mostrados numerados cuando pendingMenu === "PRODUCTS", en el mismo orden. */
  pendingProductIds?: string[] | null;
  activeCart?: StructuredCartState | null;
  checkout?: CheckoutStateSnapshot | null;
  repeatOrder?: RepeatOrderContextState | null;
  orderTracking?: OrderTrackingContextState | null;
  upsell?: UpsellContextState | null;
}

function parseContext(raw: unknown): ConversationContext {
  if (raw && typeof raw === "object" && "orderFlow" in (raw as Record<string, unknown>)) {
    const parsed = raw as ConversationContext;
    return {
      ...parsed,
      activeCart: parsed.activeCart ?? null,
      checkout: parsed.checkout ?? buildEmptyCheckoutState(),
      repeatOrder: parsed.repeatOrder ?? { pendingReplacement: null, lastSourceOrderId: null, lastSourceOrderCode: null },
      orderTracking: parsed.orderTracking ?? { lastReferencedOrderId: null, lastReferencedOrderCode: null },
      upsell: parsed.upsell ?? { ...DEFAULT_UPSELL_STATE },
    };
  }
  return {
    orderFlow: initialOrderFlowState,
    pendingMenu: null,
    pendingCategoryIds: null,
    pendingProductIds: null,
    activeCart: null,
    checkout: buildEmptyCheckoutState(),
    repeatOrder: { pendingReplacement: null, lastSourceOrderId: null, lastSourceOrderCode: null },
    orderTracking: { lastReferencedOrderId: null, lastReferencedOrderCode: null },
    upsell: { ...DEFAULT_UPSELL_STATE },
  };
}

function toJsonContext(context: ConversationContext): Prisma.InputJsonValue {
  return context as unknown as Prisma.InputJsonValue;
}

function buildPersistedConversationContext(context: ConversationContext): ConversationContext {
  return {
    orderFlow: context.orderFlow,
    pendingMenu: context.pendingMenu ?? null,
    pendingCategoryIds: context.pendingCategoryIds ?? null,
    pendingProductIds: context.pendingProductIds ?? null,
    activeCart: context.activeCart ?? null,
    checkout: context.checkout ?? buildEmptyCheckoutState(),
    repeatOrder: context.repeatOrder ?? { pendingReplacement: null, lastSourceOrderId: null, lastSourceOrderCode: null },
    orderTracking: context.orderTracking ?? { lastReferencedOrderId: null, lastReferencedOrderCode: null },
    upsell: context.upsell ?? { ...DEFAULT_UPSELL_STATE },
  };
}

async function buildProductPriceMap(): Promise<Map<string, number>> {
  const products = await listCatalog();
  const map = new Map<string, number>();
  for (const category of products) {
    for (const product of category.products) {
      map.set(product.id, await getEffectivePrice(product.id, product.price));
    }
  }
  return map;
}

async function ensureStructuredCart(context: ConversationContext): Promise<StructuredCartState> {
  if (context.activeCart && context.activeCart.items.length > 0) {
    return context.activeCart;
  }

  if (context.orderFlow.cart.length === 0) {
    context.activeCart = { ...EMPTY_STRUCTURED_CART };
    return context.activeCart;
  }

  const categories = await listCatalog();
  const allProducts = categories.flatMap((category) => category.products);
  const priceById = await buildProductPriceMap();
  context.activeCart = createStructuredCartFromLegacyLines(context.orderFlow.cart, allProducts, priceById);
  context.orderFlow = { ...context.orderFlow, cart: exportStructuredCartLines(context.activeCart) };
  return context.activeCart;
}

function resetConversationCartContext(context: ConversationContext): ConversationContext {
  return {
    ...context,
    orderFlow: initialOrderFlowState,
    activeCart: null,
    checkout: buildEmptyCheckoutState((context.checkout?.version ?? 0) + 1),
    upsell: { ...DEFAULT_UPSELL_STATE },
  };
}

function looksLikeCartTotalRequest(text: string): boolean {
  return /\b(cuanto llevo|cuanto va|cuanto seria|cuanto es|total|subtotal|cuenta)\b/i.test(text);
}

function canApplyRegionalConfirmShortcut(context: ConversationContext): boolean {
  return context.orderFlow.step === OrderFlowStep.CONFIRMING && Boolean(context.checkout?.summary);
}

async function calculateConversationCartPricing(
  context: ConversationContext,
  settings: Awaited<ReturnType<typeof getBusinessSettings>>,
): Promise<ReturnType<typeof calculateCartPricing>> {
  return calculateCartPricing({
    cart: context.orderFlow.cart,
    activeCart: context.activeCart ?? null,
    deliveryType: context.orderFlow.deliveryType,
    currency: settings.currency,
    businessDeliveryFee: settings.deliveryFee,
  });
}

function invalidateConversationCheckout(context: ConversationContext): void {
  context.checkout = invalidateCheckoutState(context.checkout);
}

async function prepareConversationCheckout(
  context: ConversationContext,
  settings: Awaited<ReturnType<typeof getBusinessSettings>>,
): Promise<{
  valid: boolean;
  replyText: string;
  repricedCart: CartLine[] | null;
  repricedActiveCart: StructuredCartState | null;
}> {
  const { validation, checkout } = await prepareCheckoutSummary({
    state: context.orderFlow,
    activeCart: context.activeCart ?? null,
    settings,
    previousCheckout: context.checkout ?? null,
  });
  context.checkout = checkout;

  if (!validation.valid || !validation.pricing || !checkout.summary) {
    const replyText = await generateResponse({
      facts: validation.errors.map((error) => error.message),
      askNext: "Â¿Desea corregir el pedido para continuar?",
      businessName: settings.restaurantName,
      tone: settings.assistantTone,
    });
    return { valid: false, replyText, repricedCart: null, repricedActiveCart: null };
  }

  const repricedCart = validation.pricing.repricedCartLines;
  const repricedActiveCart = validation.pricing.repricedActiveCart;
  context.orderFlow = { ...context.orderFlow, cart: repricedCart };
  if (repricedActiveCart) {
    context.activeCart = repricedActiveCart;
  }

  const replyText = await generateResponse({
    facts: formatCartPricingFacts(validation.pricing),
    askNext: "Â¿Confirma su pedido asi?",
    businessName: settings.restaurantName,
    tone: settings.assistantTone,
  });
  return { valid: true, replyText, repricedCart, repricedActiveCart };
}

async function resumeRecoveredCartConversation(params: {
  context: ConversationContext;
  settings: Awaited<ReturnType<typeof getBusinessSettings>>;
}): Promise<string> {
  const pendingQuestion = getPendingOrderQuestion(
    params.context.orderFlow,
    params.settings.acceptedPaymentMethods as PaymentMethod[],
  );

  const pricing = await calculateConversationCartPricing(params.context, params.settings);
  if (!pricing.valid) {
    return generateResponse({
      facts: pricing.issues.map((issue) => issue.message),
      askNext: pendingQuestion ?? "¿Desea corregir el pedido para continuar?",
      businessName: params.settings.restaurantName,
      tone: params.settings.assistantTone,
    });
  }

  params.context.orderFlow = { ...params.context.orderFlow, cart: pricing.repricedCartLines };
  if (pricing.repricedActiveCart) {
    params.context.activeCart = pricing.repricedActiveCart;
  }

  if (params.context.orderFlow.step === OrderFlowStep.CONFIRMING) {
    const prepared = await prepareConversationCheckout(params.context, params.settings);
    return prepared.replyText;
  }

  const cart = await ensureStructuredCart(params.context);
  return generateResponse({
    facts: ["Retomemos su pedido desde donde quedamos.", ...summarizeStructuredCart(cart), ...formatCartPricingFacts(pricing)],
    askNext: pendingQuestion ?? "¿Cómo desea continuar con el pedido?",
    businessName: params.settings.restaurantName,
    tone: params.settings.assistantTone,
  });
}

async function getOrCreateContact(phone: string, name: string | null) {
  const existing = await prisma.contact.findUnique({ where: { phone } });
  if (existing) {
    if (name && !existing.name) {
      return prisma.contact.update({ where: { id: existing.id }, data: { name } });
    }
    return existing;
  }
  try {
    return await prisma.contact.create({ data: { phone, name } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await prisma.contact.findUnique({ where: { phone } });
      if (raced) return raced;
    }
    throw error;
  }
}

const SESSION_TIMEOUT_MINUTES = 30;

async function getOrCreateActiveConversation(contactId: string): Promise<{ conversation: Conversation; isNewSession: boolean }> {
  const existing = await prisma.conversation.findFirst({
    where: { contactId, status: { in: [ConversationStatus.ACTIVE, ConversationStatus.WAITING_HUMAN, ConversationStatus.HUMAN] } },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    const lastActivity = existing.lastMessageAt ?? existing.createdAt;
    const minutesSinceLastActivity = (Date.now() - lastActivity.getTime()) / 60000;

    if (minutesSinceLastActivity < SESSION_TIMEOUT_MINUTES) {
      return { conversation: existing, isNewSession: false };
    }

    // Sesion vencida por inactividad: se archiva y arranca una conversacion nueva de cero.
    await prisma.conversation.update({ where: { id: existing.id }, data: { status: ConversationStatus.CLOSED } });
  }

  const created = await prisma.conversation.create({
    data: { contactId, context: toJsonContext({ orderFlow: initialOrderFlowState, activeCart: null, checkout: buildEmptyCheckoutState() }) },
  });
  return { conversation: created, isNewSession: true };
}

async function saveMessage(
  conversationId: string,
  direction: string,
  type: string,
  body: string,
  options?: { senderType?: ConversationSenderType; adminUserId?: string | null },
) {
  const message = await prisma.message.create({
    data: {
      conversationId,
      direction,
      type,
      body,
      senderType: options?.senderType ?? null,
      adminUserId: options?.adminUserId ?? null,
    },
  });
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
  return message;
}

async function getRecentHistoryText(conversationId: string): Promise<string> {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });
  return messages
    .reverse()
    .map((m) => `${m.direction === MessageDirection.INBOUND ? "Cliente" : m.senderType === "HUMAN" ? "Asesor" : "Bot"}: ${m.body}`)
    .join("\n");
}

const MIN_REPLY_DELAY_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Si se pasa receivedAt (timestamp de cuando llego el mensaje del cliente), espera lo
 * que falte para completar MIN_REPLY_DELAY_MS antes de mandar la respuesta — asi no se
 * siente instantaneo/robotico, y el "escribiendo..." de WhatsApp alcanza a mostrarse.
 * Sin receivedAt (ej: notificaciones proactivas del panel admin) no espera nada.
 */
async function sendAndLog(
  conversationId: string,
  phone: string,
  body: string,
  receivedAt?: number,
  options?: { senderType?: ConversationSenderType; adminUserId?: string | null; bypassOwnershipCheck?: boolean },
) {
  const safeBody = repairTextEncodingArtifacts(body);

  if (receivedAt !== undefined) {
    const elapsed = Date.now() - receivedAt;
    if (elapsed < MIN_REPLY_DELAY_MS) {
      await sleep(MIN_REPLY_DELAY_MS - elapsed);
    }
  }

  const senderType = options?.senderType ?? mapAutomatedOutboundSenderType();
  if (!options?.bypassOwnershipCheck && senderType === "BOT") {
    const freshConversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (
      freshConversation &&
      !canBotAutoReply({
        status: freshConversation.status,
        isHandoff: freshConversation.isHandoff,
        assignedAdminUserId: freshConversation.assignedAdminUserId,
      })
    ) {
      logger.info({ conversationId }, "Respuesta automatica descartada porque la conversacion ya paso a control humano");
      return { sent: false as const };
    }
  }

  const client = await getWhatsAppClient();
  await client.sendTextMessage(phone, safeBody);
  await saveMessage(conversationId, MessageDirection.OUTBOUND, MessageType.TEXT, safeBody, {
    senderType,
    adminUserId: options?.adminUserId ?? null,
  });
  return { sent: true as const };
}

/**
 * Un agente humano arma un carrito manual en el panel (OrderPanel, cliente sin pedido aun
 * o en handoff) y pide la direccion de envio. Sin esto, el mensaje se mandaba como texto
 * suelto sin tocar el orderFlow del bot — cuando el cliente respondia con su direccion, el
 * bot seguia "pensando" que estaba en un paso anterior (ej: preguntando domicilio/recoger) y
 * volvia a pedir la direccion que el cliente ya habia dado. Este endpoint sincroniza el
 * estado del flujo (step=ASK_ADDRESS, carrito, domicilio) para que la respuesta del cliente
 * se procese en el paso correcto y el bot pueda tomar el pedido de una vez.
 */
export async function requestDeliveryAddressFromHuman(
  conversationId: string,
  cart: CartLine[],
): Promise<{ message: string }> {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { contact: true } });
  if (!conversation) throw new Error("Conversacion no encontrada");

  const cartSummary = cart.map((i) => `${i.quantity}x ${i.productName}`).join(", ");
  const body = cartSummary
    ? `Su pedido es: ${cartSummary}. Para realizar el envio necesitamos los datos de entrega, ¿me regala la direccion completa y el barrio?`
    : "Perfecto, ¿cual es su direccion completa, barrio y un punto de referencia?";

  // Se encola por telefono igual que los mensajes entrantes: si el cliente escribe justo
  // cuando el humano hace esta accion desde el panel, sin esto las dos escrituras del
  // context podian pisarse entre si (la que termina de ultimo gana, sin importar el orden
  // real de los eventos) y corromper el estado del pedido.
  await contactMessageProcessingCoordinator.runSerializedContactTask(
    conversation.contactId,
    "HUMAN_REQUEST_DELIVERY_ADDRESS",
    async () => {
      const fresh = await prisma.conversation.findUnique({ where: { id: conversationId } });
      if (!fresh) return;
      const context = parseContext(fresh.context);
      const nextContext: ConversationContext = {
        ...context,
        orderFlow: {
          ...initialOrderFlowState,
          step: OrderFlowStep.ASK_ADDRESS,
          cart,
          deliveryType: "DELIVERY",
          sidesAsked: true,
        },
        pendingMenu: null,
        activeCart: null,
        checkout: invalidateCheckoutState(context.checkout),
      };
      await prisma.conversation.update({ where: { id: conversationId }, data: { context: toJsonContext(nextContext) } });
      await sendAndLog(conversationId, conversation.contact.phone, body);
    },
  );

  return { message: body };
}

export interface PendingOrderEdit {
  cart: CartLine[];
  deliveryType: DeliveryType | null;
  address: string | null;
  neighborhood: string | null;
  paymentMethod: PaymentMethod | null;
}

/**
 * El humano corrige el pedido que la IA recopilo (desde el panel, cuando ya esta en
 * handoff) y lo guarda SIN avisarle nada al cliente todavia — separado de "confirmar con
 * el cliente" a proposito, para poder corregir tranquilo antes de que el cliente vea algo.
 */
export async function savePendingOrder(conversationId: string, edit: PendingOrderEdit): Promise<void> {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { contact: true } });
  if (!conversation) throw new Error("Conversacion no encontrada");

  await contactMessageProcessingCoordinator.runSerializedContactTask(
    conversation.contactId,
    "HUMAN_SAVE_PENDING_ORDER",
    async () => {
      const fresh = await prisma.conversation.findUnique({ where: { id: conversationId } });
      if (!fresh) return;
      const context = parseContext(fresh.context);
      const nextContext: ConversationContext = {
        ...context,
        orderFlow: {
          ...context.orderFlow,
          cart: edit.cart,
          deliveryType: edit.deliveryType,
          address: edit.address,
          neighborhood: edit.neighborhood,
          paymentMethod: edit.paymentMethod,
        },
        activeCart: null,
        checkout: invalidateCheckoutState(context.checkout),
      };
      await prisma.conversation.update({ where: { id: conversationId }, data: { context: toJsonContext(nextContext) } });
    },
  );
}

/**
 * Manda al cliente el resumen del pedido (ya corregido por el humano si hizo falta) y le
 * pide confirmar, usando el mismo generador de IA/guardrails que el flujo normal — deja el
 * paso en CONFIRMING para que un "si" del cliente cree el pedido por el camino normal.
 */
export async function confirmPendingOrderWithAi(conversationId: string, edit: PendingOrderEdit): Promise<void> {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, include: { contact: true } });
  if (!conversation) throw new Error("Conversacion no encontrada");
  if (edit.cart.length === 0) throw new Error("El pedido no tiene productos");

  const settings = await getBusinessSettings();
  const nextOrderFlow: OrderFlowState = {
    ...initialOrderFlowState,
    step: OrderFlowStep.CONFIRMING,
    cart: edit.cart,
    deliveryType: edit.deliveryType,
    address: edit.address,
    neighborhood: edit.neighborhood,
    paymentMethod: edit.paymentMethod,
    sidesAsked: true,
    drinksAsked: true,
  };
  const nextContext: ConversationContext = {
    orderFlow: nextOrderFlow,
    pendingMenu: null,
    activeCart: null,
    checkout: buildEmptyCheckoutState(),
  };
  const prepared = await prepareConversationCheckout(nextContext, settings);
  if (!prepared.valid) {
    throw new Error("No se pudo validar el pedido");
  }

  await contactMessageProcessingCoordinator.runSerializedContactTask(
    conversation.contactId,
    "HUMAN_CONFIRM_PENDING_ORDER",
    async () => {
      const fresh = await prisma.conversation.findUnique({ where: { id: conversationId } });
      if (!fresh) return;
      await prisma.conversation.update({ where: { id: conversationId }, data: { context: toJsonContext(nextContext) } });
      await sendAndLog(conversationId, conversation!.contact.phone, prepared.replyText);
    },
  );
  return;

/*
  const pricing = await calculateCartPricing({
    cart: nextOrderFlow.cart,
    deliveryType: nextOrderFlow.deliveryType,
    currency: settings.currency,
    businessDeliveryFee: settings.deliveryFee,
  });
  if (!pricing.valid) {
    throw new Error(pricing.issues[0]?.message ?? "No se pudo validar el pedido");
  }
  nextOrderFlow.cart = pricing.repricedCartLines;
  const facts = formatCartPricingFacts(pricing);

  const message = await generateResponse({
    facts,
    askNext: "¿Confirma su pedido asi?",
    businessName: settings.restaurantName,
    tone: settings.assistantTone,
  });

  await contactMessageProcessingCoordinator.runSerializedContactTask(
    conversation.contactId,
    "HUMAN_CONFIRM_PENDING_ORDER",
    async () => {
      const fresh = await prisma.conversation.findUnique({ where: { id: conversationId } });
      if (!fresh) return;
      const context = parseContext(fresh.context);
      const nextContext: ConversationContext = { ...context, orderFlow: nextOrderFlow, activeCart: null };
      await prisma.conversation.update({ where: { id: conversationId }, data: { context: toJsonContext(nextContext) } });
      await sendAndLog(conversationId, conversation.contact.phone, message);
    },
  );
*/
}

async function escalateToHuman(params: {
  conversationId: string;
  phone: string;
  customerName: string | null;
  reason: string;
  lastMessage: string | null;
  receivedAt?: number;
  skipAutoMessage?: boolean;
}) {
  const current = await prisma.conversation.findUnique({ where: { id: params.conversationId } });
  if (!current) return;

  const alreadyHumanControlled = current.isHandoff || isHumanHandoffStatus(current.status);
  if (!alreadyHumanControlled) {
    await prisma.conversation.update({
      where: { id: params.conversationId },
      data: {
        isHandoff: true,
        handoffReason: params.reason,
        status: ConversationStatus.WAITING_HUMAN,
        assignedAdminUserId: null,
        takenAt: null,
        failedAttempts: 0,
      },
    });
    await prisma.handoff.create({
      data: { conversationId: params.conversationId, reason: params.reason, note: params.lastMessage },
    });
    await prisma.conversationAuditEvent.create({
      data: {
        conversationId: params.conversationId,
        eventType: "HANDOFF_REQUESTED",
        reason: params.reason,
        note: params.lastMessage,
      },
    });
  }

  await n8nClient.notifyHandoff({
    event: "conversation.handoff",
    conversation_id: params.conversationId,
    phone: params.phone,
    customer_name: params.customerName,
    reason: params.reason,
    last_message: params.lastMessage,
  });

  if (!alreadyHumanControlled && !params.skipAutoMessage) {
    const message =
      "Entiendo. Un miembro de nuestro equipo va a continuar su atencion en un momento. Gracias por su paciencia.";
    await sendAndLog(params.conversationId, params.phone, message, params.receivedAt, {
      senderType: "SYSTEM",
      bypassOwnershipCheck: true,
    });
  }
}

async function resolveProductFromEntities(
  entities: ExtractedEntities,
  fallbackText: string,
): Promise<ProductResolutionResult> {
  const query = [entities.productType, entities.size].filter(Boolean).join(" ") || fallbackText;
  const result = await resolveProductReference(query);
  if (result.status !== "MATCHED" || !result.product) return result;
  const product = result.product.product;
  return {
    ...result,
    product: {
      ...result.product,
      product: {
        ...product,
        price: await getEffectivePrice(product.id, product.price),
      },
    },
  };
}

interface ResolvedSides {
  matched: Array<{ id: string; name: string; price: number; categoryName: string }>;
  unmatchedTexts: string[];
}

async function resolveSidesFromEntities(entities: ExtractedEntities): Promise<ResolvedSides> {
  if (!entities.sides || entities.sides.length === 0) return { matched: [], unmatchedTexts: [] };
  const matched: Array<{ id: string; name: string; price: number; categoryName: string }> = [];
  const unmatchedTexts: string[] = [];
  for (const side of entities.sides) {
    const product = await findBestProductMatch(side);
    // Un "acompanante" nunca puede ser un combo — un combo es un paquete completo, no algo
    // que se agrega suelto. Bug real: el cliente pregunto "¿tienen gaseosas?" (una consulta,
    // no un pedido) y "gaseosas" matcheo por palabras contra un Combo Familiar (que incluye
    // "gaseosa" en su descripcion), agregando el combo completo al carrito sin que el
    // cliente lo pidiera.
    if (product && !product.isCombo) {
      matched.push({
        id: product.id,
        name: product.name,
        price: await getEffectivePrice(product.id, product.price),
        categoryName: product.categoryName,
      });
    } else {
      unmatchedTexts.push(side);
    }
  }
  return { matched, unmatchedTexts };
}

async function handleOrderCreation(params: {
  conversationId: string;
  contactId: string;
  phone: string;
  customerName: string | null;
  state: OrderFlowState;
  activeCart: StructuredCartState | null;
  checkout: CheckoutStateSnapshot | null;
}) {
  const settings = await getBusinessSettings();
  const prepared = await prepareCheckoutSummary({
    state: params.state,
    activeCart: params.activeCart,
    settings,
    previousCheckout: params.checkout,
  });
  const pricing = prepared.validation.pricing;
  const currentCheckout = prepared.checkout;

  if (!prepared.validation.valid || !pricing || !currentCheckout.summary) {
    await prisma.conversation.update({
      where: { id: params.conversationId },
      data: {
        context: toJsonContext({
          orderFlow: params.state,
          activeCart: params.activeCart,
          pendingMenu: null,
          checkout: currentCheckout,
        }),
        failedAttempts: 0,
      },
    });
    const message = await generateResponse({
      facts: prepared.validation.errors.map((error) => error.message),
      askNext: "Â¿Desea corregir el pedido para continuar?",
      businessName: settings.restaurantName,
      tone: settings.assistantTone,
    });
    await sendAndLog(params.conversationId, params.phone, message);
    return;
  }

  const previousSummary = params.checkout?.summary ?? null;
  // Solo se vuelve a pedir confirmacion cuando YA se le habia cotizado un resumen al cliente
  // y algo cambio despues (carrito, domicilio, descuento o precio). Antes tambien entraba
  // aqui cuando no habia resumen previo, y como el resumen se guardaba apenas en este punto,
  // el primer "si" del cliente siempre disparaba una segunda confirmacion con exactamente los
  // mismos valores que acababa de aceptar.
  const summaryBecameStale = Boolean(
    previousSummary &&
      (isCheckoutSummaryStale(params.checkout, params.state, params.activeCart) ||
        previousSummary.total !== currentCheckout.summary.total ||
        previousSummary.subtotal !== currentCheckout.summary.subtotal ||
        previousSummary.deliveryFee !== currentCheckout.summary.deliveryFee ||
        previousSummary.discount !== currentCheckout.summary.discount ||
        previousSummary.tax !== currentCheckout.summary.tax),
  );

  if (summaryBecameStale) {
    const repricedState: OrderFlowState = {
      ...params.state,
      step: OrderFlowStep.CONFIRMING,
      cart: pricing.repricedCartLines,
    };
    await prisma.conversation.update({
      where: { id: params.conversationId },
      data: {
        context: toJsonContext({
          orderFlow: repricedState,
          activeCart: pricing.repricedActiveCart,
          pendingMenu: null,
          checkout: currentCheckout,
        }),
        failedAttempts: 0,
      },
    });
    const facts = [
      "El pedido cambio antes de confirmar y necesito una nueva confirmacion.",
      ...formatCartPricingFacts(pricing),
    ];
    const message = await generateResponse({
      facts,
      askNext: "Estos son los valores finales actualizados. ¿Desea confirmar este pedido?",
      businessName: settings.restaurantName,
      tone: settings.assistantTone,
    });
    await sendAndLog(params.conversationId, params.phone, message);
    return;
  }

  const { order, createdNow } = await createOrder({
    confirmationId: currentCheckout.summary.confirmationId,
    contactId: params.contactId,
    phone: params.phone,
    customerName: params.customerName,
    items: pricing.repricedCartLines,
    deliveryType: params.state.deliveryType ?? "PICKUP",
    paymentMethod: params.state.paymentMethod ?? "CASH",
    deliveryFee: pricing.deliveryFee,
    total: pricing.total,
    currency: settings.currency,
    address: params.state.address,
    neighborhood: params.state.neighborhood,
    reference: params.state.reference,
    contactPhone: params.state.contactPhone,
  });

  if (!createdNow) {
    logger.warn(
      {
        conversationId: params.conversationId,
        confirmationId: currentCheckout.summary.confirmationId,
        orderId: order.id,
        orderCode: order.code,
      },
      "Se reutilizo una confirmacion de checkout ya procesada",
    );
    // El pedido ya existia (el cliente confirmo dos veces seguidas). Antes esta rama no
    // respondia nada porque el "Estamos confirmando su pedido..." ya habia salido; ahora que
    // ese mensaje intermedio no existe, hay que contestarle algo para no dejarlo en visto.
    const repeatedMessage = await generateResponse({
      facts: [
        `Su pedido ${order.code} ya estaba confirmado.`,
        `Total a pagar: ${formatCurrency(order.total, settings.currency)}.`,
      ],
      askNext: null,
      businessName: settings.restaurantName,
      tone: settings.assistantTone,
    });
    await sendAndLog(params.conversationId, params.phone, repeatedMessage);
    return;
  }

  await prisma.conversation.update({
    where: { id: params.conversationId },
    data: {
      context: toJsonContext({
        orderFlow: initialOrderFlowState,
        activeCart: null,
        pendingMenu: null,
        checkout: {
          ...currentCheckout,
          status: "ORDER_CREATED",
          orderId: order.id,
        },
      }),
      failedAttempts: 0,
      status: ConversationStatus.CLOSED,
    },
  });
  await markRecoveryConverted({
    conversationId: params.conversationId,
    orderId: order.id,
    orderCode: order.code,
  });

  const isTransfer = order.paymentMethod === "TRANSFER";
  const transferAccountFacts =
    isTransfer && settings.transferAccounts.length > 0
      ? settings.transferAccounts.map((acc) => `Opcion de transferencia: ${acc.bankName} - ${acc.accountInfo}.`)
      : [];
  const paymentNote = isTransfer
    ? "Cuando haga la transferencia, envienos la foto del comprobante por este chat para confirmar su pago."
    : "Paga al recibir su pedido.";

  const message = await generateResponse({
    facts: [
      `Pedido ${order.code} creado con exito.`,
      `Total a pagar: ${formatCurrency(order.total, settings.currency)}.`,
      ...transferAccountFacts,
      paymentNote,
      `El tiempo estimado de preparacion es de aproximadamente ${settings.estimatedPrepMinutes} minutos.`,
    ],
    askNext: null,
    businessName: settings.restaurantName,
    tone: settings.assistantTone,
  });

  await sendAndLog(params.conversationId, params.phone, message);

  if (isTransfer) {
    const accountsWithQr = settings.transferAccounts.filter((acc) => acc.qrImage);
    if (accountsWithQr.length > 0) {
      const client = await getWhatsAppClient();
      for (const acc of accountsWithQr) {
        await client.sendImageMessage(params.phone, acc.qrImage!, `Escanea para pagar por transferencia (${acc.bankName})`);
      }
    }
    await escalateToHuman({
      conversationId: params.conversationId,
      phone: params.phone,
      customerName: params.customerName,
      reason: HandoffReason.PAYMENT_ISSUE,
      lastMessage: `Pedido ${order.code} pendiente de confirmar pago por transferencia.`,
    });
    return;
  }
  return;

/*
  const pricing = await calculateCartPricing({
    cart: params.state.cart,
    activeCart: params.activeCart,
    deliveryType: params.state.deliveryType,
    currency: settings.currency,
    businessDeliveryFee: settings.deliveryFee,
  });

  if (!pricing.valid) {
    const message = await generateResponse({
      facts: [pricing.issues[0]?.message ?? "No pude validar el pedido con los datos actuales."],
      askNext: "¿Desea corregirlo para continuar?",
      businessName: settings.restaurantName,
      tone: settings.assistantTone,
    });
    await sendAndLog(params.conversationId, params.phone, message);
    return;
  }

  if (pricing.priceChanged) {
    const repricedState: OrderFlowState = {
      ...params.state,
      step: OrderFlowStep.CONFIRMING,
      cart: pricing.repricedCartLines,
    };
    await prisma.conversation.update({
      where: { id: params.conversationId },
      data: {
        context: toJsonContext({
          orderFlow: repricedState,
          activeCart: pricing.repricedActiveCart,
          pendingMenu: null,
        }),
        failedAttempts: 0,
      },
    });
    const message = await generateResponse({
      facts: [...pricing.changedMessages, ...formatCartPricingFacts(pricing)],
      askNext: "Antes de confirmar, estos son los valores actualizados. ¿Desea continuar con el pedido?",
      businessName: settings.restaurantName,
      tone: settings.assistantTone,
    });
    await sendAndLog(params.conversationId, params.phone, message);
    return;
  }

  const { order } = await createOrder({
    contactId: params.contactId,
    phone: params.phone,
    customerName: params.customerName,
    items: pricing.repricedCartLines,
    deliveryType: params.state.deliveryType ?? "PICKUP",
    paymentMethod: params.state.paymentMethod ?? "CASH",
    deliveryFee: pricing.deliveryFee,
    total: pricing.total,
    currency: settings.currency,
    address: params.state.address,
    neighborhood: params.state.neighborhood,
    reference: params.state.reference,
    contactPhone: params.state.contactPhone,
  });

  const isTransfer = order.paymentMethod === "TRANSFER";
  const transferAccountFacts =
    isTransfer && settings.transferAccounts.length > 0
      ? settings.transferAccounts.map((acc) => `Opcion de transferencia: ${acc.bankName} - ${acc.accountInfo}.`)
      : [];
  const paymentNote = isTransfer
    ? "Cuando haga la transferencia, envienos la foto del comprobante por este chat para confirmar su pago."
    : "Paga al recibir su pedido.";

  const message = await generateResponse({
    facts: [
      `Pedido ${order.code} creado con exito.`,
      `Total a pagar: ${formatCurrency(order.total, settings.currency)}.`,
      ...transferAccountFacts,
      paymentNote,
      `El tiempo estimado de preparacion es de aproximadamente ${settings.estimatedPrepMinutes} minutos.`,
    ],
    askNext: null,
    businessName: settings.restaurantName,
      tone: settings.assistantTone,
  });

  await sendAndLog(params.conversationId, params.phone, message);

  // Si paga por transferencia y el negocio configuro fotos de QR, se las mandamos aparte
  // (como imagenes reales, no solo texto) para que pueda pagar escaneando cualquiera.
  if (isTransfer) {
    const accountsWithQr = settings.transferAccounts.filter((acc) => acc.qrImage);
    if (accountsWithQr.length > 0) {
      const client = await getWhatsAppClient();
      for (const acc of accountsWithQr) {
        await client.sendImageMessage(params.phone, acc.qrImage!, `Escanea para pagar por transferencia (${acc.bankName})`);
      }
    }
  }

  if (isTransfer) {
    // Pago por transferencia: un humano tiene que revisar el comprobante y confirmar que
    // la plata realmente llego antes de que el pedido pase a preparacion — el bot deja de
    // responder automaticamente y un asesor atiende el chat hasta confirmar el pago.
    await escalateToHuman({
      conversationId: params.conversationId,
      phone: params.phone,
      customerName: params.customerName,
      reason: HandoffReason.PAYMENT_ISSUE,
      lastMessage: `Pedido ${order.code} pendiente de confirmar pago por transferencia.`,
    });
    return;
  }

  // El pedido ya quedo tomado: archivamos la conversacion de una vez en vez de esperar
  // los 30 min de inactividad. Si el cliente vuelve a escribir, arranca sesion nueva
  // (con saludo personalizado y contexto de este pedido).
  await prisma.conversation.update({
    where: { id: params.conversationId },
    data: { status: ConversationStatus.CLOSED },
  });
*/
}

/** Le avisa al cliente que un humano confirmo su pago por transferencia y ya arranco la preparacion. */
export async function notifyPaymentConfirmed(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { contact: true } });
  if (!order) return;

  const { conversation } = await getOrCreateActiveConversation(order.contactId);
  await sendAndLog(
    conversation.id,
    order.contact.phone,
    `Confirmamos su pago. Su pedido ${order.code} ya esta en preparacion.`,
  );
}

/**
 * Le avisa al cliente por WhatsApp que su pedido cambio de estado (llamado desde el
 * panel admin al mover un pedido, ej: "en cocina" -> "listo"). Si el estado no tiene
 * mensaje configurado (ej: RECEIVED, que ya se anuncia al crear el pedido), no hace nada.
 */
export async function notifyOrderStatusChange(orderId: string, status: string): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { contact: true } });
  if (!order) return;
  const message = buildOrderStatusCustomerMessage({
    status,
    orderCode: order.code,
    deliveryType: order.deliveryType as DeliveryType,
  });
  if (!message) return;

  const { conversation } = await getOrCreateActiveConversation(order.contactId);
  await sendAndLog(conversation.id, order.contact.phone, message);

  // Pedido cerrado (entregado/cancelado): archivamos la conversacion de una vez,
  // igual que al crear el pedido. Si el cliente vuelve a escribir, sesion nueva.
  if (status === OrderStatus.DELIVERED || status === OrderStatus.CANCELLED) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: ConversationStatus.CLOSED },
    });
  }
}

/**
 * Le manda al cliente el resumen de un pedido creado manualmente desde el panel
 * (ej: el agente tomo el pedido leyendo el chat) pidiendo que confirme que esta bien.
 */
export async function notifyManualOrderConfirmation(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { contact: true, items: { include: { product: true } } },
  });
  if (!order) return;

  const settings = await getBusinessSettings();
  const itemLines = order.items.map(
    (i) => `${i.quantity}x ${i.productName ?? i.product?.name ?? "Producto eliminado"} - ${formatCurrency(i.quantity * i.unitPrice, settings.currency)}`,
  );
  const deliveryLine =
    order.deliveryType === "DELIVERY"
      ? `Domicilio a ${order.address ?? "-"}${order.neighborhood ? `, ${order.neighborhood}` : ""} - ${formatCurrency(order.deliveryFee, settings.currency)}`
      : "Recoges en el local.";

  const message = await generateResponse({
    facts: [
      `Pedido ${order.code}:`,
      ...itemLines,
      deliveryLine,
      `Total: ${formatCurrency(order.total, settings.currency)}.`,
    ],
    askNext: "¿Esta bien su pedido asi?",
    businessName: settings.restaurantName,
    tone: settings.assistantTone,
  });

  const { conversation } = await getOrCreateActiveConversation(order.contactId);
  await sendAndLog(conversation.id, order.contact.phone, message);
}

/**
 * Le avisa al cliente que su pedido se corrigio (ej: se subio mal y el operador lo
 * ajusto desde el panel) — le manda el resumen actualizado, pide disculpas y confirma
 * que ya sigue en preparacion.
 */
export async function notifyOrderCorrection(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { contact: true, items: { include: { product: true } } },
  });
  if (!order) return;

  const settings = await getBusinessSettings();
  const itemLines = order.items.map(
    (i) => `${i.quantity}x ${i.productName ?? i.product?.name ?? "Producto eliminado"} - ${formatCurrency(i.quantity * i.unitPrice, settings.currency)}`,
  );

  const message = await generateResponse({
    facts: [
      `El pedido ${order.code} se corrigio. Le pedimos disculpas por el error.`,
      `Pedido corregido:`,
      ...itemLines,
      `Total: ${formatCurrency(order.total, settings.currency)}.`,
      `El pedido ya sigue en preparacion con estos datos correctos.`,
    ],
    askNext: null,
    businessName: settings.restaurantName,
    tone: settings.assistantTone,
    allowGreeting: false,
  });

  const { conversation } = await getOrCreateActiveConversation(order.contactId);
  await sendAndLog(conversation.id, order.contact.phone, message);
}

function buildOperationalRiskCustomerMessage(params: {
  orderCode: string;
  reason: "AWAITING_PAYMENT_STALE" | "RECEIVED_STALE" | "READY_FOR_PICKUP_STALE" | "READY_FOR_DISPATCH_STALE";
  delayMinutes: number;
  alertCount: number;
}): string {
  const severe = params.alertCount > 0;
  switch (params.reason) {
    case "AWAITING_PAYMENT_STALE":
      return severe
        ? `Tu pedido ${params.orderCode} sigue pendiente de confirmacion de pago y ya lleva mas demora de la normal. Nuestro equipo lo revisara manualmente; si ya transferiste, envianos el comprobante por este chat.`
        : `Tu pedido ${params.orderCode} sigue pendiente de confirmacion de pago. Si ya hiciste la transferencia, envianos el comprobante por este chat para agilizarlo.`;
    case "RECEIVED_STALE":
      return severe
        ? `Tu pedido ${params.orderCode} sigue en preparacion y presenta una demora mayor a la esperada. Ya lo dejamos priorizado con el equipo para moverlo cuanto antes.`
        : `Tu pedido ${params.orderCode} sigue en preparacion. Tenemos una demora y estamos moviendonos para sacarlo lo antes posible.`;
    case "READY_FOR_PICKUP_STALE":
      return severe
        ? `Tu pedido ${params.orderCode} ya esta listo para recoger desde hace rato. Si necesitas que lo esperemos un poco mas, responde por este chat y lo coordinamos.`
        : `Tu pedido ${params.orderCode} ya esta listo para recoger en el local. Cuando quieras, puedes pasar por el.`;
    case "READY_FOR_DISPATCH_STALE":
      return severe
        ? `Tu pedido ${params.orderCode} ya esta listo, pero el despacho va mas lento de lo normal. Nuestro equipo ya esta revisando la salida para darte respuesta lo antes posible.`
        : `Tu pedido ${params.orderCode} ya esta listo y estamos coordinando el despacho. Gracias por esperarnos un momento mas.`;
    default:
      return `Tu pedido ${params.orderCode} sigue en proceso.`;
  }
}

function getOperationalAlertFollowupThreshold(
  reason: "AWAITING_PAYMENT_STALE" | "RECEIVED_STALE" | "READY_FOR_PICKUP_STALE" | "READY_FOR_DISPATCH_STALE",
): number {
  switch (reason) {
    case "AWAITING_PAYMENT_STALE":
      return 20;
    case "RECEIVED_STALE":
      return 15;
    case "READY_FOR_PICKUP_STALE":
      return 30;
    case "READY_FOR_DISPATCH_STALE":
      return 15;
    default:
      return 20;
  }
}

function shouldEscalateOperationalRisk(
  reason: "AWAITING_PAYMENT_STALE" | "RECEIVED_STALE" | "READY_FOR_PICKUP_STALE" | "READY_FOR_DISPATCH_STALE",
  delayMinutes: number,
): boolean {
  switch (reason) {
    case "AWAITING_PAYMENT_STALE":
      return delayMinutes >= 30;
    case "RECEIVED_STALE":
      return delayMinutes >= 20;
    case "READY_FOR_PICKUP_STALE":
      return delayMinutes >= 45;
    case "READY_FOR_DISPATCH_STALE":
      return delayMinutes >= 20;
    default:
      return false;
  }
}

export async function notifyOrderOperationalRisk(params: {
  orderId: string;
  reason: "AWAITING_PAYMENT_STALE" | "RECEIVED_STALE" | "READY_FOR_PICKUP_STALE" | "READY_FOR_DISPATCH_STALE";
  delayMinutes: number;
}): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: params.orderId },
    include: { contact: true, events: true },
  });
  if (!order) return;

  const eventKey = `AUTO_CUSTOMER_ALERT:${params.reason}`;
  const sentAlerts = order.events.filter((event) => event.note?.includes(eventKey));
  if (sentAlerts.length >= 2) return;
  if (sentAlerts.length === 1 && params.delayMinutes < getOperationalAlertFollowupThreshold(params.reason)) return;

  const { conversation } = await getOrCreateActiveConversation(order.contactId);
  const message = buildOperationalRiskCustomerMessage({
    orderCode: order.code,
    reason: params.reason,
    delayMinutes: params.delayMinutes,
    alertCount: sentAlerts.length,
  });
  await sendAndLog(conversation.id, order.contact.phone, message);

  const shouldEscalate = shouldEscalateOperationalRisk(params.reason, params.delayMinutes);
  if (shouldEscalate) {
    const escalationReason =
      params.reason === "AWAITING_PAYMENT_STALE" ? HandoffReason.PAYMENT_ISSUE : HandoffReason.DELIVERY_PROBLEM;
    await escalateToHuman({
      conversationId: conversation.id,
      phone: order.contact.phone,
      customerName: order.contact.name,
      reason: escalationReason,
      lastMessage: `Atraso operativo serio en pedido ${order.code}: ${params.reason} (+${params.delayMinutes} min).`,
      skipAutoMessage: true,
    });
  }

  await prisma.orderEvent.create({
    data: {
      orderId: order.id,
      status: order.status,
      note: `${eventKey}:${sentAlerts.length + 1} ${message}`,
    },
  });
}

// Cola de procesamiento por numero de telefono: si el cliente manda 2 mensajes seguidos
// muy rapido (ej: "Si" y luego "Efectivo" casi al mismo tiempo), sin esto se procesan en
// paralelo — el segundo lee el estado del pedido (context) ANTES de que el primero termine
// de guardarlo, y su escritura pisa la del primero (se "pierden" items del carrito, el
// pedido "revierte" a una version vieja). Con esto, cada mensaje de un mismo numero espera
// a que el anterior termine de principio a fin antes de empezar.
/** Punto de entrada principal: procesa un mensaje entrante de WhatsApp ya normalizado. */
export async function handleIncomingMessage(input: InboundMessageInput): Promise<void> {
  if (!input.phone) {
    logger.warn({ input }, "Mensaje entrante sin numero de telefono, se descarta");
    return;
  }

  const contact = await getOrCreateContact(input.phone, input.name);
  const enqueued = await contactMessageProcessingCoordinator.enqueueIncomingMessage({
    waMessageId: input.waMessageId,
    contactId: contact.id,
    fromPhone: input.phone,
    customerName: input.name,
    inboundType: input.type,
    text: input.text,
    mediaId: input.mediaId,
    providerTimestamp: input.providerTimestamp,
  });

  if (!enqueued) {
    logger.info({ waMessageId: input.waMessageId, contactId: contact.id }, "Mensaje ya encolado, se omite duplicado");
  }

  await contactMessageProcessingCoordinator.drainIncomingMessages(contact.id, async (queued) => {
    await processIncomingQueuedMessage(contact.id, queued);
  });
}

async function processIncomingQueuedMessage(contactId: string, queued: QueuedInboundMessage): Promise<void> {
  const receivedAt = queued.createdAt.getTime();
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact) {
    throw new Error(`Contacto no encontrado para procesamiento serializado: ${contactId}`);
  }
  const input: InboundMessageInput = {
    waMessageId: queued.waMessageId,
    phone: queued.fromPhone,
    name: queued.customerName,
    type: queued.inboundType,
    text: queued.text,
    mediaId: queued.mediaId,
    mediaMimeType: null,
    providerTimestamp: queued.providerTimestamp,
  };
  const { conversation, isNewSession } = await getOrCreateActiveConversation(contact.id);

  const bodyForLog = input.text ?? `[${input.type}]`;
  const inboundMessage = await saveMessage(conversation.id, MessageDirection.INBOUND, input.type, bodyForLog, {
    senderType: mapInboundSenderType(),
  });

  // Se descarga la imagen/audio ANTES del corte por handoff: si no, un comprobante de pago
  // mandado mientras la conversacion ya esta en manos de un humano (el caso mas comun, ya
  // que el pedido por transferencia se escala automaticamente al crearse) nunca se guardaba
  // y el asesor no podia verlo en el panel.
  let inboundMedia: DownloadedMedia | null = null;
  if ((input.type === "AUDIO" || input.type === "IMAGE") && input.mediaId) {
    inboundMedia = await (await getWhatsAppClient()).downloadMedia(input.mediaId);
    if (inboundMedia) {
      await prisma.message.update({
        where: { id: inboundMessage.id },
        data: {
          mediaUrl: `data:${inboundMedia.mimeType};base64,${inboundMedia.base64}`,
          raw: {
            sourceType: input.type,
            mediaId: input.mediaId,
            webhookMimeType: input.mediaMimeType ?? null,
            downloadedMimeType: inboundMedia.mimeType,
            byteLength: inboundMedia.byteLength,
            contentLength: inboundMedia.contentLength,
            fileSize: inboundMedia.fileSize,
          } as Prisma.InputJsonValue,
        },
      });
    }
  }

  // Igual que el media: si el pedido es por transferencia queda en handoff desde que se
  // crea, asi que sin esto el comprobante nunca marcaba el pago como "reportado" — el
  // asesor lo veia como pendiente aunque el cliente ya hubiera mandado la foto.
  if (input.type === "IMAGE") {
    const latestOrder = await getLatestOrderForContact(contact.id);
    if (latestOrder && latestOrder.paymentMethod === "TRANSFER" && latestOrder.paymentStatus === PaymentStatus.PENDING) {
      await markPaymentReported({ orderId: latestOrder.id, note: "Comprobante enviado por WhatsApp" });
      await n8nClient.notifyPaymentReminder({
        event: "payment.reminder",
        order_id: latestOrder.id,
        order_code: latestOrder.code,
        phone: input.phone,
        total: latestOrder.total,
        payment_method: latestOrder.paymentMethod,
      });
      if (
        canBotAutoReply({
          status: conversation.status,
          isHandoff: conversation.isHandoff,
          assignedAdminUserId: conversation.assignedAdminUserId,
        })
      ) {
        await sendAndLog(
          conversation.id,
          input.phone,
          `Recibimos su comprobante para el pedido ${latestOrder.code}. Nuestro equipo lo va a confirmar en breve. ¡Gracias!`,
          receivedAt,
        );
      }
      return;
    }
  }

  if (conversation.isHandoff || isHumanHandoffStatus(conversation.status)) {
    logger.info({ conversationId: conversation.id }, "Conversacion en handoff, bot no responde automaticamente");
    return;
  }

  if (isNewSession) {
    const settings = await getBusinessSettings();
    const { isOpen } = checkIsOpen(settings);

    if (!isOpen && !settings.acceptsScheduledOrders) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { context: toJsonContext({ orderFlow: initialOrderFlowState, pendingMenu: null, activeCart: null, checkout: buildEmptyCheckoutState() }) },
      });
      await sendAndLog(conversation.id, input.phone, settings.outOfHoursMessage, receivedAt);
      return;
    }

    const lastOrder = await getLatestOrderForContact(contact.id);

    let message: string;
    let pendingMenu: PendingMenu = "WELCOME";
    if (lastOrder && contact.name) {
      const statusLabel = ORDER_STATUS_LABELS_ES[lastOrder.status] ?? lastOrder.status.toLowerCase();
      const greeting = await generateResponse({
        facts: [
          `El cliente se llama ${contact.name} y ya nos ha pedido antes.`,
          `Su ultimo pedido (${lastOrder.code}) quedo en estado: ${statusLabel}.`,
        ],
        askNext: null,
        businessName: settings.restaurantName,
        tone: settings.assistantTone,
        allowGreeting: true,
      });
      // Si el guardrail reemplazo el saludo por el mensaje de error generico (ej: el modelo
      // menciono algun numero que se confundio con un monto), no lo pegamos con el menu
      // numerado — se veria como un error pegado a la respuesta. Se usa un saludo fijo,
      // siempre seguro, en su lugar.
      const greetingLine =
        greeting === SAFE_FALLBACK_MESSAGE ? `¡Hola ${contact.name}! Bienvenido de nuevo a ${settings.restaurantName}.` : greeting;
      message = `${greetingLine}\n\n1. Ver el estado de mi pedido\n2. Hacer un nuevo pedido\n3. Ver el menu\n4. Otra cosa (escribeme libremente)`;
      pendingMenu = "RETURNING";
    } else if (settings.welcomeMessage.trim()) {
      // Si el negocio escribio su propio mensaje de bienvenida, se usa TAL CUAL (control
      // total) — antes se agregaba despues de un saludo fijo, y si el texto configurado YA
      // era un saludo completo (lo mas comun), terminaba duplicado/incoherente.
      message = settings.welcomeMessage;
      pendingMenu = "WELCOME";
    } else {
      const greetingLine = `¡Hola! Bienvenido a ${settings.restaurantName}${settings.agentName ? `, me llamo ${settings.agentName}` : ""}. ¿En que le ayudo hoy?`;
      const menuBlock = "1. Ver el menu\n2. Hacer un pedido\n3. Promociones\n4. Estado de un pedido";
      message = `${greetingLine}\n\n${menuBlock}`;
      pendingMenu = "WELCOME";
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { context: toJsonContext({ orderFlow: initialOrderFlowState, pendingMenu, activeCart: null, checkout: buildEmptyCheckoutState() }) },
    });
    await sendAndLog(conversation.id, input.phone, message, receivedAt);
    return;
  }

  if (input.type === "AUDIO") {
    await handleIncomingAudio(conversation.id, contact.id, contact.name, input.phone, receivedAt, inboundMessage.id, inboundMedia);
    return;
  }

  if (input.type === "IMAGE") {
    await handleIncomingImage(conversation.id, input.phone, receivedAt, inboundMedia);
    return;
  }

  if (input.type !== "TEXT" || !input.text) {
    await sendAndLog(
      conversation.id,
      input.phone,
      "No logre leer ese mensaje. ¿Me lo escribes en texto, por favor?",
      receivedAt,
    );
    return;
  }

  await handleTextMessage(conversation.id, contact.id, contact.name, input.phone, input.text, receivedAt);
}

async function handleIncomingAudio(
  conversationId: string,
  contactId: string,
  customerName: string | null,
  phone: string,
  receivedAt: number,
  inboundMessageId: string,
  media: DownloadedMedia | null,
) {
  const processed = await processWhatsAppAudio({
    media,
    transcribe: transcribeAudio,
  });

  // El data URL ya se guardo en processIncomingMessage (antes del corte por handoff); aqui
  // solo actualizamos el body con el texto transcrito para que se lea en el panel admin.
  await prisma.message.update({
    where: { id: inboundMessageId },
    data: {
      body: processed.transcript?.text ?? "[No se pudo transcribir]",
      raw: {
        sourceType: "AUDIO",
        transcriptionStatus: processed.status,
        transcriptionError: processed.debugReason,
        transcription: processed.transcript
          ? {
              ok: processed.transcript.ok,
              text: processed.transcript.text,
              language: processed.transcript.language,
              durationSeconds: processed.transcript.durationSeconds,
              provider: processed.transcript.provider,
              retryable: processed.transcript.retryable,
              errorCode: processed.transcript.errorCode,
            }
          : null,
      } as Prisma.InputJsonValue,
    },
  });

  if (processed.status !== "READY" || !processed.transcript?.text) {
    await sendAndLog(
      conversationId,
      phone,
      "No logre entender la nota de voz. ¿Me escribe su pedido o su pregunta en texto, por favor?",
      receivedAt,
    );
    return;
  }

  const normalizedAudioText = processed.normalizedText ?? processed.transcript.text;
  logger.info(
    { conversationId, transcript: processed.transcript.text, normalizedTranscript: normalizedAudioText },
    "Audio transcrito, se procesa como mensaje de texto",
  );
  await handleTextMessage(conversationId, contactId, customerName, phone, normalizedAudioText, receivedAt);
}

async function handleIncomingImage(
  conversationId: string,
  phone: string,
  receivedAt: number,
  media: { base64: string; mimeType: string } | null,
) {
  const settings = await getBusinessSettings();

  // El caso de comprobante de transferencia (marcar pago REPORTED) ya se resuelve en
  // processIncomingMessage antes de llegar aqui, incluyendo cuando la conversacion esta en
  // handoff. Aqui solo queda el caso "imagen normal" (plato, captura, etc), fuera de handoff.
  const description = media
    ? await describeImage({
        base64: media.base64,
        mimeType: media.mimeType,
        instructions:
          "Describe en una frase corta y en espanol que se ve en esta imagen, en el contexto de un negocio de comida (puede ser un plato, un comprobante de pago, una captura de pantalla, etc). No inventes precios ni datos que no se vean claramente.",
      })
    : null;

  if (!description) {
    await sendAndLog(
      conversationId,
      phone,
      "Recibi su imagen pero no logre analizarla. Si es un comprobante de pago cuenteme a que pedido corresponde; si es otra cosa, escribame en texto en que le ayudo.",
      receivedAt,
    );
    return;
  }

  const reply = await generateResponse({
    facts: [`El cliente envio una imagen. Lo que se ve en la imagen: ${description}`],
    askNext: "¿En que le ayudo con eso?",
    businessName: settings.restaurantName,
    tone: settings.assistantTone,
  });
  await sendAndLog(conversationId, phone, reply, receivedAt);
}

/**
 * Responde a una oferta de upsell pendiente ("¿Te agrego X por $Y?"). Se maneja aparte del
 * clasificador de intencion a proposito: un simple "no" o "si" respondiendo la oferta no debe
 * pasar por CONFIRM/CANCEL del pedido completo (ver docs/UPSELLING.md, riesgo de falso CANCEL).
 */
async function tryHandleUpsellOffer(params: {
  conversationId: string;
  context: ConversationContext;
  text: string;
  settings: Awaited<ReturnType<typeof getBusinessSettings>>;
  pendingQuestion: string | null;
}): Promise<{ handled: boolean; replyText?: string; madeProgress?: boolean }> {
  const upsell = params.context.upsell ?? { ...DEFAULT_UPSELL_STATE };
  const pendingProductId = upsell.pendingProductId;
  if (!pendingProductId) return { handled: false };

  if (isUpsellRejectMessage(params.text)) {
    params.context.upsell = {
      ...upsell,
      pendingProductId: null,
      rejectedProductIds: [...new Set([...upsell.rejectedProductIds, pendingProductId])],
      suspended: upsell.suspended || isUpsellSuspendAllMessage(params.text),
    };
    await createUpsellAuditEvent(params.conversationId, "UPSELL_REJECTED", pendingProductId);
    const replyText = await generateResponse({
      facts: [],
      askNext: params.pendingQuestion,
      extraInstructions: "El cliente rechazo un adicional sugerido, continua con normalidad sin insistir.",
      businessName: params.settings.restaurantName,
      tone: params.settings.assistantTone,
    });
    return { handled: true, replyText, madeProgress: true };
  }

  if (isUpsellAcceptMessage(params.text)) {
    params.context.upsell = { ...upsell, pendingProductId: null };

    const products = await listAllProductsFlat();
    const product = products.find((candidate) => candidate.id === pendingProductId);
    const cart = await ensureStructuredCart(params.context);
    const alreadyInCart = cart.items.some((item) => item.productId === pendingProductId);

    if (!product || !product.isAvailable) {
      await createUpsellAuditEvent(params.conversationId, "UPSELL_UNAVAILABLE", pendingProductId);
      const replyText = await generateResponse({
        facts: ["Ese producto ya no esta disponible en este momento."],
        askNext: params.pendingQuestion,
        businessName: params.settings.restaurantName,
        tone: params.settings.assistantTone,
      });
      return { handled: true, replyText, madeProgress: true };
    }

    if (alreadyInCart) {
      const replyText = await generateResponse({
        facts: [`Ya tiene ${product.name} en su pedido.`],
        askNext: params.pendingQuestion,
        businessName: params.settings.restaurantName,
        tone: params.settings.assistantTone,
      });
      return { handled: true, replyText, madeProgress: true };
    }

    const price = await getEffectivePrice(product.id, product.price);
    params.context.orderFlow = {
      ...params.context.orderFlow,
      cart: [...params.context.orderFlow.cart, { productId: product.id, productName: product.name, quantity: 1, unitPrice: price }],
    };
    params.context.activeCart = null;
    invalidateConversationCheckout(params.context);
    await createUpsellAuditEvent(params.conversationId, "UPSELL_ACCEPTED", pendingProductId);

    const replyText = await generateResponse({
      facts: [`Agregue ${product.name} (${formatCurrency(price, params.settings.currency)}) a su pedido.`],
      askNext: params.pendingQuestion,
      businessName: params.settings.restaurantName,
      tone: params.settings.assistantTone,
    });
    return { handled: true, replyText, madeProgress: true };
  }

  return { handled: false };
}

/**
 * Ofrece a lo sumo UN adicional (ver getCartRecommendations) al final de un turno donde el
 * producto principal + acompanantes/bebidas ya quedaron resueltos. Nunca reemplaza la
 * respuesta original del turno, solo le agrega la pregunta de upsell al final — igual que la
 * IA nunca decide el producto, aqui tampoco: solo se le pasa un hecho ya resuelto por backend.
 */
async function tryOfferUpsell(params: {
  conversationId: string;
  context: ConversationContext;
  settings: Awaited<ReturnType<typeof getBusinessSettings>>;
  conversationOwnership: { status: string; isHandoff: boolean; assignedAdminUserId: string | null };
  baseReplyText: string;
}): Promise<string> {
  if (!canBotAutoReply(params.conversationOwnership)) return params.baseReplyText;

  const upsell = params.context.upsell ?? { ...DEFAULT_UPSELL_STATE };
  if (upsell.suspended || upsell.pendingProductId) return params.baseReplyText;
  if (upsell.offeredProductIds.length >= params.settings.maxUpsellOffers) return params.baseReplyText;

  const cart = await ensureStructuredCart(params.context);
  const offers = await getCartRecommendations({ cart, rejectedProductIds: upsell.rejectedProductIds });
  const offer = offers[0];
  if (!offer) return params.baseReplyText;

  params.context.upsell = {
    ...upsell,
    offeredProductIds: [...upsell.offeredProductIds, offer.productId],
    pendingProductId: offer.productId,
  };
  await createUpsellAuditEvent(params.conversationId, "UPSELL_OFFERED", offer.productId);

  const upsellPhrase = await generateResponse({
    facts: [`${offer.name}: ${formatCurrency(offer.price, params.settings.currency)}.`],
    askNext: `¿Le agrego ${offer.name} por ${formatCurrency(offer.price, params.settings.currency)}?`,
    extraInstructions: "Esto es una sugerencia adicional aparte de lo que ya se confirmo arriba, no repitas el pedido ya hecho.",
    businessName: params.settings.restaurantName,
    tone: params.settings.assistantTone,
  });

  return `${params.baseReplyText}\n\n${upsellPhrase}`;
}

async function tryHandleStructuredCartInstruction(params: {
  context: ConversationContext;
  text: string;
  settings: Awaited<ReturnType<typeof getBusinessSettings>>;
  pendingQuestion: string | null;
}): Promise<{ handled: boolean; replyText?: string; madeProgress?: boolean }> {
  const instruction = parseStructuredCartInstruction(params.text);
  const hasCart = params.context.activeCart?.items.length || params.context.orderFlow.cart.length;
  if (!instruction || !hasCart) {
    return { handled: false };
  }

  const cart = await ensureStructuredCart(params.context);
  const categories = await listCatalog();
  const allProducts = categories.flatMap((category) => category.products);
  const priceById = await buildProductPriceMap();
  const result = applyStructuredCartInstruction(cart, instruction, allProducts, priceById);
  params.context.activeCart = result.updatedCart;
  params.context.orderFlow = {
    ...params.context.orderFlow,
    cart: exportStructuredCartLines(result.updatedCart),
  };
  invalidateConversationCheckout(params.context);

  const replyText = await generateResponse({
    facts: [result.message, ...summarizeStructuredCart(result.updatedCart)],
    askNext: result.requiresClarification ? result.message : params.pendingQuestion,
    businessName: params.settings.restaurantName,
    tone: params.settings.assistantTone,
  });

  return { handled: true, replyText, madeProgress: result.ok || Boolean(result.requiresClarification) };
}

async function tryHandlePendingRepeatReplacement(params: {
  context: ConversationContext;
  intent: string;
  text: string;
  settings: Awaited<ReturnType<typeof getBusinessSettings>>;
}): Promise<{ handled: boolean; replyText?: string; madeProgress?: boolean }> {
  const pending = params.context.repeatOrder?.pendingReplacement ?? null;
  if (!pending) {
    return { handled: false };
  }

  if (params.intent === Intent.CANCEL) {
    params.context.repeatOrder = {
      ...(params.context.repeatOrder ?? {}),
      pendingReplacement: null,
    };
    const replyText = await generateResponse({
      facts: ["Conservo el pedido actual y descarte el reemplazo por el pedido anterior."],
      askNext: getPendingOrderQuestion(params.context.orderFlow),
      businessName: params.settings.restaurantName,
      tone: params.settings.assistantTone,
    });
    return { handled: true, replyText, madeProgress: true };
  }

  if (params.intent !== Intent.CONFIRM) {
    return { handled: false };
  }

  params.context.orderFlow = pending.nextState;
  params.context.activeCart = pending.activeCart;
  params.context.checkout = buildEmptyCheckoutState((params.context.checkout?.version ?? 0) + 1);
  params.context.repeatOrder = {
    pendingReplacement: null,
    lastSourceOrderId: pending.sourceOrderId,
    lastSourceOrderCode: pending.sourceOrderCode,
  };

  const prepared = await prepareConversationCheckout(params.context, params.settings);
  const facts = [...pending.issueMessages];
  const replyText = facts.length > 0 ? `${facts.join("\n")}\n\n${prepared.replyText}` : prepared.replyText;

  return { handled: true, replyText, madeProgress: true };
}

async function tryHandleRepeatOrderRequest(params: {
  contactId: string;
  context: ConversationContext;
  intent: string;
  text: string;
  settings: Awaited<ReturnType<typeof getBusinessSettings>>;
  acceptedPaymentMethods: PaymentMethod[];
}): Promise<{ handled: boolean; replyText?: string; madeProgress?: boolean }> {
  if (!isRepeatOrderRequest(params.text)) {
    return { handled: false };
  }

  const preparation = await prepareRepeatOrder({
    contactId: params.contactId,
    text: params.text,
    acceptedPaymentMethods: params.acceptedPaymentMethods,
  });

  if (preparation.status === "NOT_FOUND") {
    const replyText = await generateResponse({
      facts: preparation.issues.map((issue) => issue.message),
      askNext: "Si quiere, puedo ayudarle a armar un pedido nuevo desde el menu actual.",
      businessName: params.settings.restaurantName,
      tone: params.settings.assistantTone,
    });
    return { handled: true, replyText, madeProgress: false };
  }

  if (preparation.status === "AMBIGUOUS") {
    const choices = formatRecentOrderChoices(preparation.recentOrders.slice(0, 2));
    const replyText = await generateResponse({
      facts: [
        ...preparation.issues.map((issue) => issue.message),
        ...(choices.length > 0 ? [`Pedidos recientes: ${choices.join(" | ")}.`] : []),
      ],
      askNext: "¿Cual de esos pedidos quiere repetir?",
      businessName: params.settings.restaurantName,
      tone: params.settings.assistantTone,
    });
    return { handled: true, replyText, madeProgress: false };
  }

  if (!preparation.sourceOrder || !preparation.activeCart || !preparation.nextState) {
    const replyText = await generateResponse({
      facts: preparation.issues.map((issue) => issue.message),
      askNext: "Necesito que me diga que quiere pedir hoy para continuar.",
      businessName: params.settings.restaurantName,
      tone: params.settings.assistantTone,
    });
    return { handled: true, replyText, madeProgress: false };
  }

  const hasExistingCart =
    params.context.orderFlow.cart.length > 0 ||
    Boolean(params.context.activeCart?.items.length) ||
    params.context.orderFlow.step !== OrderFlowStep.IDLE;

  if (hasExistingCart) {
    params.context.repeatOrder = {
      pendingReplacement: {
        sourceOrderId: preparation.sourceOrder.id,
        sourceOrderCode: preparation.sourceOrder.code,
        nextState: preparation.nextState,
        activeCart: preparation.activeCart,
        issueMessages: summarizeRepeatPreparation(preparation),
      },
      lastSourceOrderId: params.context.repeatOrder?.lastSourceOrderId ?? null,
      lastSourceOrderCode: params.context.repeatOrder?.lastSourceOrderCode ?? null,
    };
    const replyText = await generateResponse({
      facts: [
        "Ya tienes un pedido en curso.",
        ...summarizeRepeatPreparation(preparation),
      ],
      askNext: "¿Quieres reemplazar tu carrito actual por este pedido reconstruido?",
      businessName: params.settings.restaurantName,
      tone: params.settings.assistantTone,
    });
    return { handled: true, replyText, madeProgress: true };
  }

  params.context.orderFlow = preparation.nextState;
  params.context.activeCart = preparation.activeCart;
  params.context.checkout = buildEmptyCheckoutState((params.context.checkout?.version ?? 0) + 1);
  params.context.repeatOrder = {
    pendingReplacement: null,
    lastSourceOrderId: preparation.sourceOrder.id,
    lastSourceOrderCode: preparation.sourceOrder.code,
  };

  const prepared = await prepareConversationCheckout(params.context, params.settings);
  const facts = summarizeRepeatPreparation(preparation);
  const replyText = `${facts.join("\n")}\n\n${prepared.replyText}`;
  return { handled: true, replyText, madeProgress: true };
}

async function handleTextMessageLegacy(
  conversationId: string,
  contactId: string,
  customerName: string | null,
  phone: string,
  text: string,
  receivedAt: number,
) {
  return handleTextMessage(conversationId, contactId, customerName, phone, text, receivedAt);
/*
  if (messageContainsHandoffKeyword(text)) {
    await escalateToHuman({
      conversationId,
      phone,
      customerName,
      reason: /queja|reclamo/.test(text.toLowerCase()) ? HandoffReason.COMPLAINT : HandoffReason.CUSTOMER_REQUEST,
      lastMessage: text,
      receivedAt,
    });
    return;
  }

  const [history, settings] = await Promise.all([getRecentHistoryText(conversationId), getBusinessSettings()]);
  const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  const context = parseContext(conversation.context);
  const normalizedText = normalizeLocalizedText(text);
  const activeSentRecovery = await findLatestSentCartRecovery(conversationId);
  const inOrderFlowAlready = context.orderFlow.step !== OrderFlowStep.IDLE;

  if (isMarketingOptInMessage(normalizedText)) {
    await recordMarketingOptIn(contactId, "WHATSAPP_KEYWORD");
    const replyText = await generateResponse({
      facts: ["Listo, quedo autorizado para recibir promociones y novedades por WhatsApp."],
      askNext: inOrderFlowAlready ? getPendingOrderQuestion(context.orderFlow, settings.acceptedPaymentMethods as PaymentMethod[]) : null,
      businessName: settings.restaurantName,
      tone: settings.assistantTone,
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        context: toJsonContext(buildPersistedConversationContext(context)),
        failedAttempts: 0,
      },
    });
    await sendAndLog(conversationId, phone, replyText, receivedAt);
    return;
  }

  if (isMarketingOptOutMessage(normalizedText)) {
    await recordMarketingOptOut(contactId, normalizedText);
    const replyText = await generateResponse({
      facts: ["Listo, no le enviaremos promociones automaticas por WhatsApp."],
      askNext: inOrderFlowAlready ? getPendingOrderQuestion(context.orderFlow, settings.acceptedPaymentMethods as PaymentMethod[]) : null,
      businessName: settings.restaurantName,
      tone: settings.assistantTone,
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        context: toJsonContext(buildPersistedConversationContext(context)),
        failedAttempts: 0,
      },
    });
    await sendAndLog(conversationId, phone, replyText, receivedAt);
    return;
  }

  if (isCartRecoveryOptOutMessage(normalizedText)) {
    await recordCartRecoveryOptOut({
      contactId,
      conversationId,
      reason: normalizedText,
    });
    const replyText = await generateResponse({
      facts: ["Listo, no le enviaremos recordatorios automaticos de pedidos pendientes."],
      askNext: null,
      businessName: settings.restaurantName,
      tone: settings.assistantTone,
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        context: toJsonContext(buildPersistedConversationContext(context)),
        failedAttempts: 0,
      },
    });
    await sendAndLog(conversationId, phone, replyText, receivedAt);
    return;
  }

  if (activeSentRecovery && isCartRecoveryCancelMessage(normalizedText)) {
    await markRecoveryCancelled({ conversationId, note: normalizedText });
    context.orderFlow = initialOrderFlowState;
    context.activeCart = null;
    context.checkout = buildEmptyCheckoutState((context.checkout?.version ?? 0) + 1);
    const replyText = await generateResponse({
      facts: ["Listo, deje cancelado ese pedido pendiente y no le insistiremos con ese carrito."],
      askNext: null,
      businessName: settings.restaurantName,
      tone: settings.assistantTone,
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        context: toJsonContext(buildPersistedConversationContext(context)),
        failedAttempts: 0,
      },
    });
    await sendAndLog(conversationId, phone, replyText, receivedAt);
    return;
  }

  if (activeSentRecovery && (isCartRecoveryResumeMessage(normalizedText) || isRegionalConfirmation(normalizedText))) {
    await markRecoveryReplied({ conversationId, note: normalizedText });
    const replyText = await resumeRecoveredCartConversation({ context, settings });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        context: toJsonContext(buildPersistedConversationContext(context)),
        failedAttempts: 0,
      },
    });
    await sendAndLog(conversationId, phone, replyText, receivedAt);
    return;
  }

  if (activeSentRecovery) {
    await markRecoveryReplied({ conversationId, note: normalizedText });
  }

  // Atajo deterministico: si el cliente responde solo un numero suelto (las opciones
  // numeradas del ultimo menu que le mandamos) fuera de un pedido en curso, no le pedimos
  // a la IA que adivine — un numero suelto es facil de matchear por accidente contra
  // productos del catalogo cuyo nombre incluye un numero (ej: "2" vs "...2 gaseosas").
  // El significado de cada numero depende de cual menu se le mando (bienvenida normal vs
  // el de cliente recurrente con pedido previo), guardado en pendingMenu.
  const WELCOME_SHORTCUT: Record<string, string> = {
    "1": Intent.VIEW_MENU,
    "2": Intent.ORDER_PRODUCT,
    "3": Intent.ASK_PROMOTIONS,
    "4": Intent.ORDER_STATUS,
  };
  const RETURNING_SHORTCUT: Record<string, string> = {
    "1": Intent.ORDER_STATUS,
    "2": Intent.ORDER_PRODUCT,
    "3": Intent.VIEW_MENU,
    // "4" (otra cosa) no tiene atajo a proposito: cae a clasificacion normal por IA.
  };
  const activeShortcutMap =
    context.pendingMenu === "RETURNING" ? RETURNING_SHORTCUT : context.pendingMenu === "WELCOME" ? WELCOME_SHORTCUT : null;
  const shortcutIntent = !inOrderFlowAlready && activeShortcutMap ? activeShortcutMap[text.trim()] : undefined;

  // El menu numerado solo aplica a la respuesta inmediatamente siguiente.
  if (context.pendingMenu) {
    context.pendingMenu = null;
  }

  const [intentResult, entities] = shortcutIntent
    ? [{ intent: shortcutIntent, confidence: 1 }, EMPTY_ENTITIES]
    : await Promise.all([
        classifyIntent({ message: text, recentHistory: history, businessName: settings.restaurantName }),
        extractEntities({ message: text, recentHistory: history, businessName: settings.restaurantName }),
      ]);
  const intent = intentResult.intent;

  if (intent === Intent.COMPLAINT) {
    await escalateToHuman({ conversationId, phone, customerName, reason: HandoffReason.COMPLAINT, lastMessage: text, receivedAt });
    return;
  }
  if (intent === Intent.HUMAN_HANDOFF) {
    await escalateToHuman({
      conversationId,
      phone,
      customerName,
      reason: HandoffReason.CUSTOMER_REQUEST,
      lastMessage: text,
      receivedAt,
    });
    return;
  }

  const { isOpen } = checkIsOpen(settings);
  const inOrderFlow = context.orderFlow.step !== OrderFlowStep.IDLE;
  const isHoursGated = HOURS_GATED_INTENTS.includes(intent) || inOrderFlow;

  if (!isOpen && isHoursGated && !settings.acceptsScheduledOrders) {
    await sendAndLog(conversationId, phone, settings.outOfHoursMessage, receivedAt);
    return;
  }

  let madeProgress = intent !== Intent.UNKNOWN;
  let replyText: string;
  // Si el cliente pregunta algo informativo a mitad de un pedido (ej: pide el menu
  // mientras se le pregunta la direccion), respondemos la pregunta Y le recordamos que
  // sigue pendiente — asi no se pierde el hilo del pedido en curso.
  const acceptedPaymentMethods = settings.acceptedPaymentMethods as PaymentMethod[];
  const pendingQuestion = inOrderFlow ? getPendingOrderQuestion(context.orderFlow, acceptedPaymentMethods) : null;
  // Solo se busca en FAQ cuando la IA no logro clasificar la intencion — para intents ya
  // resueltos (precio, menu, pedido, etc) no tiene sentido gastar la consulta.
  const structuredCartResult = await tryHandleStructuredCartInstruction({ context, text, settings, pendingQuestion });
  if (structuredCartResult.handled) {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        context: toJsonContext({
          orderFlow: context.orderFlow,
          pendingMenu: context.pendingMenu ?? null,
          activeCart: context.activeCart,
          checkout: context.checkout,
        }),
        failedAttempts: structuredCartResult.madeProgress ? 0 : conversation.failedAttempts + 1,
      },
    });
    await sendAndLog(conversationId, phone, structuredCartResult.replyText!, receivedAt);
    return;
  }
  if (inOrderFlow && looksLikeCartTotalRequest(text)) {
    const pricing = await calculateConversationCartPricing(context, settings);
    if (!pricing.valid) {
      replyText = await generateResponse({
        facts: [pricing.issues[0]?.message ?? "No pude recalcular el pedido en este momento."],
        askNext: pendingQuestion,
        businessName: settings.restaurantName,
        tone: settings.assistantTone,
      });
      madeProgress = false;
    } else {
      context.orderFlow = { ...context.orderFlow, cart: pricing.repricedCartLines };
      if (pricing.repricedActiveCart) context.activeCart = pricing.repricedActiveCart;
      replyText = await generateResponse({
        facts: formatCartPricingFacts(pricing),
        askNext: pendingQuestion ?? "¿Confirmamos el pedido?",
        businessName: settings.restaurantName,
        tone: settings.assistantTone,
      });
      madeProgress = true;
    }
  } else {
  const faqMatch = intent === Intent.UNKNOWN ? await findFaqMatch(text) : null;

  if (intent === Intent.ORDER_STATUS) {
    replyText = await buildOrderStatusReply(contactId, settings);
  } else if (intent === Intent.VIEW_MENU) {
    const categoryMatch = await findCategoryMatch(text);
    replyText = categoryMatch
      ? await buildCategoryReply(categoryMatch, settings, pendingQuestion)
      : await buildMenuReply(settings, pendingQuestion);
  } else if (intent === Intent.ASK_PROMOTIONS) {
    replyText = await buildPromotionsReply(settings, pendingQuestion);
  } else if (
    intent === Intent.ASK_DELIVERY &&
    !(inOrderFlow && context.orderFlow.step === OrderFlowStep.ASK_DELIVERY_TYPE && entities.deliveryType)
  ) {
    // Si el cliente ya esta en el paso de "domicilio o recoger" y su mensaje trae la
    // respuesta (ej: "Domicilio"), dejamos que el flujo de pedido la procese en vez de
    // responderle con info generica de domicilio y volver a preguntar lo mismo.
    if (decision.nextState.step === OrderFlowStep.CONFIRMING || state.step === OrderFlowStep.CONFIRMING) {
      const pricing = await calculateCartPricing({
        cart: decision.nextState.cart,
        activeCart: context.activeCart ?? null,
        deliveryType: decision.nextState.deliveryType,
        currency: settings.currency,
        businessDeliveryFee: settings.deliveryFee,
      });
      if (pricing.valid) {
        decision.nextState = { ...decision.nextState, cart: pricing.repricedCartLines };
        if (pricing.repricedActiveCart) context.activeCart = pricing.repricedActiveCart;
        decision.facts = formatCartPricingFacts(pricing);
      } else {
        decision.facts = [pricing.issues[0]?.message ?? "No pude validar el pedido con los precios actuales."];
        decision.askNext = "Â¿Desea corregir el pedido para continuar?";
      }
    }
    replyText = await generateResponse({
      facts: [
        settings.deliveryFee > 0
          ? `El domicilio tiene un costo de ${formatCurrency(settings.deliveryFee, settings.currency)}.`
          : "El domicilio no tiene costo adicional.",
      ],
      askNext: pendingQuestion ?? "¿Desea que tomemos su pedido?",
      businessName: settings.restaurantName,
      tone: settings.assistantTone,
    });
  } else if (intent === Intent.ASK_ETA) {
    replyText = await generateResponse({
      facts: [`El tiempo estimado de preparacion es de aproximadamente ${settings.estimatedPrepMinutes} minutos.`],
      askNext: pendingQuestion,
      businessName: settings.restaurantName,
      tone: settings.assistantTone,
    });
  } else if (intent === Intent.ASK_PRICE) {
    const productResolution = await resolveProductFromEntities(entities, text);
    if (productResolution.status === "MATCHED" && productResolution.product) {
      const product = productResolution.product.product;
      const comboDetail =
        product.isCombo && product.comboItems.length > 0
          ? ` Incluye: ${product.comboItems.map((i) => `${i.quantity}x ${i.productName}`).join(", ")}.`
          : "";
      replyText = await generateResponse({
        facts: [
          `${product.name}${product.unitCount ? ` (${product.unitCount} unidades)` : ""}: ${formatCurrency(product.price, settings.currency)}.${comboDetail}`,
        ],
        askNext: pendingQuestion,
        businessName: settings.restaurantName,
      tone: settings.assistantTone,
      });
    } else if (productResolution.status === "AMBIGUOUS") {
      const options = productResolution.candidates.map((candidate) => candidate.product.name).slice(0, 4).join(", ");
      replyText = await generateResponse({
        facts: options ? [`Encontre varias opciones para "${productResolution.query}": ${options}.`] : [],
        askNext: "¿Cual de esas opciones desea consultar?",
        businessName: settings.restaurantName,
        tone: settings.assistantTone,
      });
    } else {
      const categoryMatch = await findCategoryMatch(text);
      replyText = categoryMatch
        ? await buildCategoryReply(categoryMatch, settings, pendingQuestion)
        : await generateResponse({
        facts: [],
        askNext: pendingQuestion ?? "¿De cual producto del menu desea saber el precio?",
        businessName: settings.restaurantName,
      tone: settings.assistantTone,
      });
      madeProgress = Boolean(categoryMatch);
    }
  } else if (intent === Intent.GREETING) {
    if (inOrderFlow) {
      // Saludo a mitad de pedido: no es una respuesta valida al slot pendiente, pero
      // tampoco es un fallo real del cliente — lo redirigimos con calidez en vez de
      // penalizarlo como intento fallido (evita escalar a humano por decir "hola").
      replyText = await generateResponse({
        facts: [],
        askNext: pendingQuestion,
        businessName: settings.restaurantName,
        tone: settings.assistantTone,
      });
    } else {
      replyText = settings.welcomeMessage;
    }
  } else if (intent === Intent.UNKNOWN && looksLikeRecommendationRequest(text)) {
    replyText = await buildRecommendationReply(settings, pendingQuestion);
    madeProgress = true;
  } else if (intent === Intent.UNKNOWN && faqMatch) {
    replyText = faqMatch.answer;
    madeProgress = true;
    } else {
      const cartBeforeTurn = JSON.stringify(context.orderFlow.cart);
      const result = await runOrderFlowTurn({ context, intent, entities, text, settings });
      replyText = result.replyText;
      madeProgress = result.madeProgress;
      context.orderFlow = result.nextState;
      if (!result.orderCreated && JSON.stringify(result.nextState.cart) !== cartBeforeTurn) {
        context.activeCart = null;
        invalidateConversationCheckout(context);
      }

      if (!result.orderCreated && result.nextState.step === OrderFlowStep.CONFIRMING) {
        const prepared = await prepareConversationCheckout(context, settings);
        replyText = prepared.replyText;
        madeProgress = prepared.valid;
      }

      if (result.orderCreated) {
        await handleOrderCreation({
          conversationId,
        contactId,
        phone,
        customerName,
        state: result.stateBeforeReset,
        activeCart: context.activeCart ?? null,
        checkout: context.checkout ?? null,
      });
      return;
    }
  }

  const newFailedAttempts = madeProgress ? 0 : conversation.failedAttempts + 1;

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      context: toJsonContext({
        orderFlow: context.orderFlow,
        pendingMenu: context.pendingMenu ?? null,
        activeCart: context.activeCart,
        checkout: context.checkout,
      }),
      failedAttempts: newFailedAttempts,
    },
  });

  if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
    await escalateToHuman({
      conversationId,
      phone,
      customerName,
      reason: HandoffReason.LOW_CONFIDENCE,
      lastMessage: text,
      receivedAt,
    });
    return;
  }

  await sendAndLog(conversationId, phone, replyText, receivedAt);
*/
}

async function handleTextMessage(
  conversationId: string,
  contactId: string,
  customerName: string | null,
  phone: string,
  text: string,
  receivedAt: number,
) {
  if (messageContainsHandoffKeyword(text)) {
    await escalateToHuman({
      conversationId,
      phone,
      customerName,
      reason: /queja|reclamo/.test(text.toLowerCase()) ? HandoffReason.COMPLAINT : HandoffReason.CUSTOMER_REQUEST,
      lastMessage: text,
      receivedAt,
    });
    return;
  }

  const [history, settings] = await Promise.all([getRecentHistoryText(conversationId), getBusinessSettings()]);
  const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  const context = parseContext(conversation.context);
  const normalizedText = normalizeLocalizedText(text);
  const inOrderFlowAlready = context.orderFlow.step !== OrderFlowStep.IDLE;
  // Pregunta que el bot dejo pendiente en el turno anterior. Se calcula ANTES de llamar a la IA
  // porque tanto el clasificador de intencion como el extractor de entidades la necesitan: sin
  // ella, un "No" o un "Ensalada" sueltos contestando "¿desea algun acompanante?" salian como
  // CANCEL / productType y el pedido se cancelaba o el bot re-preguntaba en bucle.
  const pendingQuestion = inOrderFlowAlready
    ? getPendingOrderQuestion(context.orderFlow, settings.acceptedPaymentMethods as PaymentMethod[])
    : null;

  // El cliente respondio con el numero de una categoria mostrada (menu numerado en dos
  // pasos): le mostramos los productos numerados de esa categoria y cortamos aqui, sin
  // pasar por clasificacion de IA (numero limpio = seleccion de lista, no texto libre).
  if (!inOrderFlowAlready && context.pendingMenu === "CATEGORIES") {
    const chosenIndex = parseMenuSelectionIndex(normalizedText);
    const categoryId = chosenIndex !== null ? (context.pendingCategoryIds ?? [])[chosenIndex - 1] : undefined;
    if (categoryId) {
      // Si la categoria elegida tiene subcategorias, las mostramos numeradas (mismo paso,
      // un nivel mas profundo) en vez de saltar directo a productos — asi soporta cualquier
      // profundidad de categoria > subcategoria > sub-subcategoria configurada en el panel.
      const numberedChildren = await buildNumberedCategoriesReply(categoryId);
      if (numberedChildren) {
        context.pendingCategoryIds = numberedChildren.categoryIds;
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { context: toJsonContext(buildPersistedConversationContext(context)) },
        });
        await sendAndLog(conversationId, phone, numberedChildren.text, receivedAt);
        return;
      }

      const categories = await listCatalog();
      const category = categories.find((c) => c.id === categoryId);
      const numbered = category ? buildNumberedProductsReply(category.name, category.products, settings) : null;
      if (numbered) {
        context.pendingMenu = "PRODUCTS";
        context.pendingCategoryIds = null;
        context.pendingProductIds = numbered.productIds;
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { context: toJsonContext(buildPersistedConversationContext(context)) },
        });
        await sendAndLog(conversationId, phone, numbered.text, receivedAt);
        return;
      }
    }
    // Numero invalido o categoria sin productos ni subcategorias mostrables: seguimos el
    // flujo normal (pendingMenu se limpia mas abajo, como cualquier otro pendingMenu vencido).
  }

  // El cliente respondio con el numero de un producto mostrado: en vez de reinventar la
  // logica de cantidad/acompanantes/precios, forzamos el intent y las entidades como si
  // hubiera escrito el nombre EXACTO del producto, y dejamos que el flujo normal de pedidos
  // (mas abajo) lo procese igual que cualquier pedido por texto.
  let forcedProductName: string | null = null;
  if (!inOrderFlowAlready && context.pendingMenu === "PRODUCTS") {
    const chosenIndex = parseMenuSelectionIndex(normalizedText);
    const productId = chosenIndex !== null ? (context.pendingProductIds ?? [])[chosenIndex - 1] : undefined;
    if (productId) {
      const categories = await listCatalog();
      const product = categories.flatMap((cat) => cat.products).find((p) => p.id === productId);
      if (product) {
        forcedProductName = product.name;
      }
    }
  }

  const welcomeShortcut: Record<string, string> = {
    "1": Intent.VIEW_MENU,
    "2": Intent.ORDER_PRODUCT,
    "3": Intent.ASK_PROMOTIONS,
    "4": Intent.ORDER_STATUS,
  };
  const returningShortcut: Record<string, string> = {
    "1": Intent.ORDER_STATUS,
    "2": Intent.ORDER_PRODUCT,
    "3": Intent.VIEW_MENU,
  };
  const activeShortcutMap =
    context.pendingMenu === "RETURNING" ? returningShortcut : context.pendingMenu === "WELCOME" ? welcomeShortcut : null;
  const shortcutIntent = !inOrderFlowAlready && activeShortcutMap ? activeShortcutMap[normalizedText.trim()] : undefined;

  if (context.pendingMenu) {
    context.pendingMenu = null;
    context.pendingCategoryIds = null;
    context.pendingProductIds = null;
  }

  const [intentResult, entities] = forcedProductName
    ? [{ intent: Intent.ORDER_PRODUCT, confidence: 1 }, { ...EMPTY_ENTITIES, productType: forcedProductName }]
    : shortcutIntent
    ? [{ intent: shortcutIntent, confidence: 1 }, EMPTY_ENTITIES]
    : await Promise.all([
        classifyIntent({ message: normalizedText, recentHistory: history, businessName: settings.restaurantName, pendingQuestion }),
        extractEntities({ message: normalizedText, recentHistory: history, businessName: settings.restaurantName, pendingQuestion }),
      ]);
  let intent = intentResult.intent;

  if (canApplyRegionalConfirmShortcut(context) && isRegionalConfirmation(normalizedText)) {
    intent = Intent.CONFIRM;
  } else if (inOrderFlowAlready && isRegionalCancellation(normalizedText)) {
    intent = Intent.CANCEL;
  }

  if (intent === Intent.COMPLAINT) {
    const deliveredConflict = await resolveDeliveredConflict({
      contactId,
      text: normalizedText,
      reference: context.orderTracking,
    });
    if (deliveredConflict.shouldHandoff) {
      context.orderTracking = deliveredConflict.orderTracking;
      const replyText = await generateResponse({
        facts: deliveredConflict.facts,
        askNext: null,
        businessName: settings.restaurantName,
        tone: settings.assistantTone,
      });
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          context: toJsonContext(buildPersistedConversationContext(context)),
          failedAttempts: 0,
        },
      });
      await sendAndLog(conversationId, phone, replyText, receivedAt);
      await escalateToHuman({
        conversationId,
        phone,
        customerName,
        reason: deliveredConflict.handoffReason ?? HandoffReason.DELIVERY_PROBLEM,
      lastMessage: deliveredConflict.handoffNote ?? text,
        receivedAt,
        skipAutoMessage: true,
      });
      return;
    }
  }

  if (intent === Intent.COMPLAINT) {
    await escalateToHuman({
      conversationId,
      phone,
      customerName,
      reason: HandoffReason.COMPLAINT,
      lastMessage: text,
      receivedAt,
    });
    return;
  }
  if (intent === Intent.HUMAN_HANDOFF) {
    await escalateToHuman({
      conversationId,
      phone,
      customerName,
      reason: HandoffReason.CUSTOMER_REQUEST,
      lastMessage: text,
      receivedAt,
    });
    return;
  }

  const { isOpen } = checkIsOpen(settings);
  const inOrderFlow = context.orderFlow.step !== OrderFlowStep.IDLE;
  const isHoursGated = HOURS_GATED_INTENTS.includes(intent) || inOrderFlow;

  if (!isOpen && isHoursGated && !settings.acceptsScheduledOrders) {
    await sendAndLog(conversationId, phone, settings.outOfHoursMessage, receivedAt);
    return;
  }

  let madeProgress = intent !== Intent.UNKNOWN;
  let replyText: string;
  let statusHandoff:
    | {
        reason: string;
        note: string;
      }
    | null = null;
  // true solo cuando el turno acaba de resolver el producto principal + acompanantes/bebidas
  // (transicion a ASK_DELIVERY_TYPE) — el punto seguro para ofrecer upsell (ver tryOfferUpsell).
  let upsellTrigger = false;
  const acceptedPaymentMethods = settings.acceptedPaymentMethods as PaymentMethod[];

  if (isUpsellOptOutMessage(normalizedText)) {
    context.upsell = { ...(context.upsell ?? DEFAULT_UPSELL_STATE), suspended: true };
  }

  const pendingUpsellResult = await tryHandleUpsellOffer({
    conversationId,
    context,
    text: normalizedText,
    settings,
    pendingQuestion,
  });
  if (pendingUpsellResult.handled) {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        context: toJsonContext(buildPersistedConversationContext(context)),
        failedAttempts: pendingUpsellResult.madeProgress ? 0 : conversation.failedAttempts + 1,
      },
    });
    await syncCartRecoveryFromConversation({
      conversationId,
      contactId,
      context,
      lastMessageAt: new Date(receivedAt),
    });
    await sendAndLog(conversationId, phone, pendingUpsellResult.replyText!, receivedAt);
    return;
  }

  const pendingRepeatReplacement = await tryHandlePendingRepeatReplacement({
    context,
    intent,
    text: normalizedText,
    settings,
  });
  if (pendingRepeatReplacement.handled) {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        context: toJsonContext(buildPersistedConversationContext(context)),
        failedAttempts: pendingRepeatReplacement.madeProgress ? 0 : conversation.failedAttempts + 1,
      },
    });
    await syncCartRecoveryFromConversation({
      conversationId,
      contactId,
      context,
      lastMessageAt: new Date(receivedAt),
    });
    await sendAndLog(conversationId, phone, pendingRepeatReplacement.replyText!, receivedAt);
    return;
  }

  const repeatOrderResult = await tryHandleRepeatOrderRequest({
    contactId,
    context,
    intent,
    text: normalizedText,
    settings,
    acceptedPaymentMethods,
  });
  if (repeatOrderResult.handled) {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        context: toJsonContext(buildPersistedConversationContext(context)),
        failedAttempts: repeatOrderResult.madeProgress ? 0 : conversation.failedAttempts + 1,
      },
    });
    await syncCartRecoveryFromConversation({
      conversationId,
      contactId,
      context,
      lastMessageAt: new Date(receivedAt),
    });
    await sendAndLog(conversationId, phone, repeatOrderResult.replyText!, receivedAt);
    return;
  }

  const structuredCartResult = await tryHandleStructuredCartInstruction({
    context,
    text: normalizedText,
    settings,
    pendingQuestion,
  });
  if (structuredCartResult.handled) {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        context: toJsonContext(buildPersistedConversationContext(context)),
        failedAttempts: structuredCartResult.madeProgress ? 0 : conversation.failedAttempts + 1,
      },
    });
    await syncCartRecoveryFromConversation({
      conversationId,
      contactId,
      context,
      lastMessageAt: new Date(receivedAt),
    });
    await sendAndLog(conversationId, phone, structuredCartResult.replyText!, receivedAt);
    return;
  }

  if (inOrderFlow && looksLikeCartTotalRequest(normalizedText)) {
    const pricing = await calculateConversationCartPricing(context, settings);
    if (!pricing.valid) {
      replyText = await generateResponse({
        facts: [pricing.issues[0]?.message ?? "No pude recalcular el pedido en este momento."],
        askNext: pendingQuestion,
        businessName: settings.restaurantName,
        tone: settings.assistantTone,
      });
      madeProgress = false;
    } else {
      context.orderFlow = { ...context.orderFlow, cart: pricing.repricedCartLines };
      if (pricing.repricedActiveCart) {
        context.activeCart = pricing.repricedActiveCart;
      }
      replyText = await generateResponse({
        facts: formatCartPricingFacts(pricing),
        askNext: pendingQuestion ?? "Â¿Confirmamos el pedido?",
        businessName: settings.restaurantName,
        tone: settings.assistantTone,
      });
      madeProgress = true;
    }
  } else {
    const faqMatch = intent === Intent.UNKNOWN ? await findFaqMatch(normalizedText) : null;
    const shouldHandleOrderStatus =
      intent === Intent.ORDER_STATUS ||
      intent === Intent.ASK_ETA ||
      (intent === Intent.UNKNOWN &&
        Boolean(context.orderTracking?.lastReferencedOrderId) &&
        looksLikeOrderStatusFollowUp(normalizedText));

    if (shouldHandleOrderStatus) {
      const statusResult = await resolveOrderStatusQuery({
        contactId,
        text: normalizedText,
        settings: { estimatedPrepMinutes: settings.estimatedPrepMinutes },
        reference: context.orderTracking,
        mode: intent === Intent.ASK_ETA ? "ETA" : "STATUS",
      });
      context.orderTracking = statusResult.orderTracking;
      replyText = await generateResponse({
        facts: statusResult.facts,
        askNext: statusResult.askNext,
        businessName: settings.restaurantName,
        tone: settings.assistantTone,
      });
      madeProgress = true;
      if (statusResult.kind === "FOUND" && statusResult.shouldHandoff && statusResult.handoffReason && statusResult.handoffNote) {
        statusHandoff = {
          reason: statusResult.handoffReason,
          note: statusResult.handoffNote,
        };
      }
    } else if (intent === Intent.VIEW_MENU) {
      const categoryMatch = await findCategoryMatch(normalizedText);
      if (categoryMatch) {
        const numbered = buildNumberedProductsReply(categoryMatch.categoryName, categoryMatch.products, settings);
        if (numbered) {
          replyText = numbered.text;
          context.pendingMenu = "PRODUCTS";
          context.pendingCategoryIds = null;
          context.pendingProductIds = numbered.productIds;
        } else {
          replyText = await buildCategoryReply(categoryMatch, settings, pendingQuestion);
        }
      } else {
        const numberedCategories = await buildNumberedCategoriesReply();
        if (numberedCategories) {
          replyText = numberedCategories.text;
          context.pendingMenu = "CATEGORIES";
          context.pendingCategoryIds = numberedCategories.categoryIds;
          context.pendingProductIds = null;
        } else {
          replyText = await buildMenuReply(settings, pendingQuestion);
        }
      }
    } else if (intent === Intent.ASK_PROMOTIONS) {
      replyText = await buildPromotionsReply(settings, pendingQuestion);
    } else if (
      intent === Intent.ASK_DELIVERY &&
      !(inOrderFlow && context.orderFlow.step === OrderFlowStep.ASK_DELIVERY_TYPE && entities.deliveryType)
    ) {
      replyText = await generateResponse({
        facts: [
          settings.deliveryFee > 0
            ? `El domicilio tiene un costo de ${formatCurrency(settings.deliveryFee, settings.currency)}.`
            : "El domicilio no tiene costo adicional.",
        ],
        askNext: pendingQuestion ?? "Â¿Desea que tomemos su pedido?",
        businessName: settings.restaurantName,
        tone: settings.assistantTone,
      });
    } else if (intent === Intent.ASK_PRICE) {
      const productResolution = await resolveProductFromEntities(entities, normalizedText);
      if (productResolution.status === "MATCHED" && productResolution.product) {
        const product = productResolution.product.product;
        const comboDetail =
          product.isCombo && product.comboItems.length > 0
            ? ` Incluye: ${product.comboItems.map((item) => `${item.quantity}x ${item.productName}`).join(", ")}.`
            : "";
        replyText = await generateResponse({
          facts: [
            `${product.name}${product.unitCount ? ` (${product.unitCount} unidades)` : ""}: ${formatCurrency(product.price, settings.currency)}.${comboDetail}`,
          ],
          askNext: pendingQuestion,
          businessName: settings.restaurantName,
          tone: settings.assistantTone,
        });
      } else if (productResolution.status === "AMBIGUOUS") {
        const options = productResolution.candidates.map((candidate) => candidate.product.name).slice(0, 4).join(", ");
        replyText = await generateResponse({
          facts: options ? [`Encontre varias opciones para "${productResolution.query}": ${options}.`] : [],
          askNext: "¿Cual de esas opciones desea consultar?",
          businessName: settings.restaurantName,
          tone: settings.assistantTone,
        });
      } else {
        const categoryMatch = await findCategoryMatch(normalizedText);
        replyText = categoryMatch
          ? await buildCategoryReply(categoryMatch, settings, pendingQuestion)
          : await generateResponse({
              facts: [],
              askNext: pendingQuestion ?? "Â¿De cual producto del menu desea saber el precio?",
              businessName: settings.restaurantName,
              tone: settings.assistantTone,
            });
        madeProgress = Boolean(categoryMatch);
      }
    } else if (intent === Intent.GREETING) {
      replyText = inOrderFlow
        ? await generateResponse({
            facts: [],
            askNext: pendingQuestion,
            businessName: settings.restaurantName,
            tone: settings.assistantTone,
          })
        : settings.welcomeMessage;
    } else if (intent === Intent.UNKNOWN && looksLikeRecommendationRequest(normalizedText)) {
      replyText = await buildRecommendationReply(settings, pendingQuestion);
      madeProgress = true;
    } else if (intent === Intent.UNKNOWN && faqMatch) {
      replyText = faqMatch.answer;
      madeProgress = true;
    } else {
      const cartBeforeTurn = JSON.stringify(context.orderFlow.cart);
      const stepBeforeTurn = context.orderFlow.step;
      const result = await runOrderFlowTurn({ context, intent, entities, text: normalizedText, settings });
      replyText = result.replyText;
      madeProgress = result.madeProgress;
      context.orderFlow = result.nextState;
      if (!result.orderCreated && JSON.stringify(result.nextState.cart) !== cartBeforeTurn) {
        context.activeCart = null;
      }

      // El turno termina esperando el "si" del cliente: dejamos ya cotizado y guardado el
      // checkout summary con los mismos valores que le acabamos de mostrar. Sin esto el
      // checkout llegaba vacio al turno siguiente, handleOrderCreation lo leia como resumen
      // desactualizado y le pedia una segunda confirmacion identica a la que ya habia dado.
      // Va despues de fijar orderFlow/activeCart para que la huella del resumen se calcule
      // sobre el mismo contexto que se va a persistir.
      if (!result.orderCreated && context.orderFlow.step === OrderFlowStep.CONFIRMING) {
        const prepared = await prepareCheckoutSummary({
          state: context.orderFlow,
          activeCart: context.activeCart ?? null,
          settings,
          previousCheckout: context.checkout,
        });
        if (prepared.validation.valid && prepared.checkout.summary) {
          context.checkout = prepared.checkout;
        }
      }

      // El producto principal + acompanantes/bebidas ya quedaron resueltos justo este turno
      // (no en uno anterior) y el pedido no se creo todavia — momento seguro para ofrecer un
      // adicional, antes de entrar a domicilio/pago/confirmacion.
      upsellTrigger = shouldOfferUpsellThisTurn({
        stepBeforeTurn,
        nextStep: result.nextState.step,
        orderCreated: result.orderCreated,
      });

      if (result.orderCreated) {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            context: toJsonContext(
              buildPersistedConversationContext({
                orderFlow: initialOrderFlowState,
                activeCart: null,
                checkout: buildEmptyCheckoutState(),
                repeatOrder: { pendingReplacement: null, lastSourceOrderId: null, lastSourceOrderCode: null },
                orderTracking: { lastReferencedOrderId: null, lastReferencedOrderCode: null },
                upsell: { ...DEFAULT_UPSELL_STATE },
              }),
            ),
            failedAttempts: 0,
          },
        });
        // Sin mensaje intermedio: handleOrderCreation manda el unico mensaje del cierre.
        if (replyText.trim()) {
          await sendAndLog(conversationId, phone, replyText, receivedAt);
        }
        await handleOrderCreation({
          conversationId,
          contactId,
          phone,
          customerName,
          state: result.stateBeforeReset,
          activeCart: context.activeCart ?? null,
          checkout: context.checkout ?? null,
        });
        return;
      }
    }
  }

  if (upsellTrigger && settings.upsellEnabled) {
    replyText = await tryOfferUpsell({
      conversationId,
      context,
      settings,
      conversationOwnership: {
        status: conversation.status,
        isHandoff: conversation.isHandoff,
        assignedAdminUserId: conversation.assignedAdminUserId,
      },
      baseReplyText: replyText,
    });
  }

  const newFailedAttempts = madeProgress ? 0 : conversation.failedAttempts + 1;
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      context: toJsonContext(buildPersistedConversationContext(context)),
      failedAttempts: newFailedAttempts,
    },
  });
  await syncCartRecoveryFromConversation({
    conversationId,
    contactId,
    context,
    lastMessageAt: new Date(receivedAt),
  });

  if (statusHandoff) {
    await sendAndLog(conversationId, phone, replyText, receivedAt);
    await escalateToHuman({
      conversationId,
      phone,
      customerName,
      reason: statusHandoff.reason,
      lastMessage: statusHandoff.note,
      receivedAt,
      skipAutoMessage: true,
    });
    return;
  }

  if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
    await escalateToHuman({
      conversationId,
      phone,
      customerName,
      reason: HandoffReason.LOW_CONFIDENCE,
      lastMessage: text,
      receivedAt,
    });
    return;
  }

  await sendAndLog(conversationId, phone, replyText, receivedAt);
}

type BusinessSettings = Awaited<ReturnType<typeof getBusinessSettings>>;

/**
 * Interpreta una respuesta del cliente como el numero de una lista mostrada (categoria o
 * producto). Deliberadamente estricto: solo acepta un numero limpio (con a lo sumo una
 * palabra de relleno tipo "el"/"opcion" antes), nunca un numero mezclado con otras palabras
 * ("quiero 2 pollos"), para no confundir cantidades u otros numeros con una seleccion de
 * lista. Si no es un numero limpio, devuelve null y el mensaje sigue el flujo normal.
 */
function parseMenuSelectionIndex(text: string): number | null {
  const withoutFiller = text
    .trim()
    .toLowerCase()
    .replace(/^(el|la|numero|número|opcion|opción)\s+/i, "")
    .replace(/[.,)]+$/g, "")
    .trim();
  if (/^\d{1,3}$/.test(withoutFiller)) {
    return Number(withoutFiller);
  }
  return null;
}

/** Una categoria es visible si tiene algun producto mostrable, o alguna subcategoria visible (recursivo). */
function categoryHasVisibleContent(
  category: Awaited<ReturnType<typeof listCatalog>>[number],
  allCategories: Awaited<ReturnType<typeof listCatalog>>,
): boolean {
  if (category.products.some((p) => p.showInMenu)) return true;
  const children = allCategories.filter((c) => c.parentCategoryId === category.id);
  return children.some((child) => categoryHasVisibleContent(child, allCategories));
}

/**
 * Lista numerada de (sub)categorias visibles bajo un padre dado (null = categorias
 * principales), en el orden configurado en el panel. Se usa tanto para el primer paso del
 * menu como para cada nivel de subcategoria que el cliente vaya eligiendo.
 */
async function buildNumberedCategoriesReply(
  parentCategoryId: string | null = null,
): Promise<{ text: string; categoryIds: string[] } | null> {
  const categories = await listCatalog();
  const scoped = categories.filter((cat) => (cat.parentCategoryId ?? null) === parentCategoryId);
  const visible = scoped.filter((cat) => categoryHasVisibleContent(cat, categories));
  if (visible.length === 0) return null;
  const lines = visible.map((cat, i) => `${i + 1}. ${cat.name}`);
  const heading = parentCategoryId ? "Estas son las opciones:" : "Estas son nuestras categorias:";
  const text = `${heading}\n\n${lines.join("\n")}\n\nResponde con el numero de la opcion que te interesa.`;
  return { text, categoryIds: visible.map((c) => c.id) };
}

/** Lista numerada de productos mostrables de una categoria, en el orden configurado en el panel. */
function buildNumberedProductsReply(
  categoryName: string,
  products: Awaited<ReturnType<typeof listCatalog>>[number]["products"],
  settings: BusinessSettings,
): { text: string; productIds: string[] } | null {
  const visible = products.filter((p) => p.showInMenu);
  if (visible.length === 0) return null;
  const lines = visible.map((p, i) => {
    const comboDetail =
      p.isCombo && p.comboItems.length > 0
        ? ` [incluye: ${p.comboItems.map((item) => `${item.quantity}x ${item.productName}`).join(", ")}]`
        : "";
    return `${i + 1}. ${p.name}${p.unitCount ? ` (${p.unitCount} unidades)` : ""}: ${formatCurrency(p.price, settings.currency)}${comboDetail}`;
  });
  const text = `*${categoryName}*\n\n${lines.join("\n")}\n\nResponde con el numero del producto que quieres pedir.`;
  return { text, productIds: visible.map((p) => p.id) };
}

async function buildMenuReply(settings: BusinessSettings, pendingQuestion?: string | null): Promise<string> {
  const categories = await listCatalog();
  const facts = categories.flatMap((cat) =>
    cat.products
      .filter((p) => p.showInMenu)
      .map((p) => {
      const comboDetail =
        p.isCombo && p.comboItems.length > 0
          ? ` [incluye: ${p.comboItems.map((i) => `${i.quantity}x ${i.productName}`).join(", ")}]`
          : "";
      return `${cat.name} - ${p.name}${p.unitCount ? ` (${p.unitCount} unidades)` : ""}: ${formatCurrency(p.price, settings.currency)}${comboDetail}`;
    }),
  );
  if (facts.length === 0) {
    return generateResponse({
      facts: ["El menu no esta disponible en este momento."],
      askNext: pendingQuestion ?? null,
      businessName: settings.restaurantName,
      tone: settings.assistantTone,
    });
  }
  return generateResponse({
    facts,
    askNext: pendingQuestion ?? "¿Que le gustaria pedir?",
    extraInstructions: "Organiza el menu agrupado por categoria, en lineas cortas.",
    businessName: settings.restaurantName,
      tone: settings.assistantTone,
  });
}

async function buildCategoryReply(
  categoryMatch: { categoryName: string; products: Awaited<ReturnType<typeof listCatalog>>[number]["products"] },
  settings: BusinessSettings,
  pendingQuestion?: string | null,
): Promise<string> {
  const facts = categoryMatch.products.map(
    (p) =>
      `${p.name}${p.unitCount ? ` (${p.unitCount} unidades)` : ""}: ${formatCurrency(p.price, settings.currency)}`,
  );
  return generateResponse({
    facts,
    askNext: pendingQuestion ?? "¿Cual le gustaria?",
    extraInstructions: `El cliente pregunto especificamente por la categoria "${categoryMatch.categoryName}", responde solo con esos items.`,
    businessName: settings.restaurantName,
    tone: settings.assistantTone,
  });
}

/** "recomiendame algo", "que me sugiere", "que me aconseja" — pedido explicito de recomendacion, generico para cualquier tipo de negocio de comida. */
function looksLikeRecommendationRequest(text: string): boolean {
  return /\b(recomiend|recomendacion|sugier|sugerenc|aconsej|que me dice|cual me recomienda)/i.test(text);
}

/**
 * Recomienda en base a datos reales del negocio, nunca inventados: primero una promocion
 * activa si hay (el negocio decidio explicitamente destacarla), si no el producto marcado
 * como "por defecto" de cada categoria (el negocio tambien lo eligio a mano en el catalogo).
 */
async function buildRecommendationReply(settings: BusinessSettings, pendingQuestion?: string | null): Promise<string> {
  const promos = (await listActivePromotions()).filter(isPromoActiveToday);
  if (promos.length > 0) {
    const promo = promos[0]!;
    return generateResponse({
      facts: [`Promocion activa: ${promo.title} — ${promo.description}.`],
      askNext: pendingQuestion ?? "¿Le gustaria aprovecharla?",
      businessName: settings.restaurantName,
      tone: settings.assistantTone,
    });
  }

  const categories = await listCatalog();
  const highlights = categories
    .map((c) => c.products.find((p) => p.isDefaultVariant && p.isAvailable && p.showInMenu))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  if (highlights.length === 0) {
    return generateResponse({
      facts: [],
      askNext: pendingQuestion ?? "¿Que le gustaria pedir del menu?",
      businessName: settings.restaurantName,
      tone: settings.assistantTone,
    });
  }

  return generateResponse({
    facts: highlights.map((p) => `${p.name}: ${formatCurrency(p.price, settings.currency)}`),
    askNext: pendingQuestion ?? "¿Le gustaria pedir alguno de estos?",
    extraInstructions: "El cliente pidio una recomendacion, presenta estos como tu sugerencia.",
    businessName: settings.restaurantName,
    tone: settings.assistantTone,
  });
}

async function buildPromotionsReply(settings: BusinessSettings, pendingQuestion?: string | null): Promise<string> {
  const promos = (await listActivePromotions()).filter(isPromoActiveToday);
  if (promos.length === 0) {
    return generateResponse({
      facts: ["No hay promociones activas en este momento."],
      askNext: pendingQuestion ?? null,
      businessName: settings.restaurantName,
      tone: settings.assistantTone,
    });
  }
  return generateResponse({
    // Si la promo tiene producto+descuento estructurado, calculamos el precio final real
    // (nunca dejamos que la IA calcule descuentos — asi no inventa montos incorrectos).
    facts: promos.map((p) => {
      if (p.productName && p.productPrice != null && p.discountType && p.discountValue != null) {
        const finalPrice = applyPromotionDiscount(p.productPrice, p);
        return `${p.title}: ${p.description} (${p.productName} con descuento queda en ${formatCurrency(finalPrice, settings.currency)}, antes ${formatCurrency(p.productPrice, settings.currency)}).`;
      }
      return `${p.title}: ${p.description}`;
    }),
    askNext: pendingQuestion ?? "¿Desea aprovechar alguna de estas promociones?",
    businessName: settings.restaurantName,
      tone: settings.assistantTone,
  });
}

async function buildOrderStatusReply(contactId: string, settings: BusinessSettings): Promise<string> {
  return generateResponse({
    facts: ["No pudimos consultar el estado del pedido en este momento."],
    askNext: null,
    businessName: settings.restaurantName,
    tone: settings.assistantTone,
  });
}

interface OrderFlowTurnResult {
  replyText: string;
  madeProgress: boolean;
  nextState: OrderFlowState;
  orderCreated: boolean;
  stateBeforeReset: OrderFlowState;
}

async function runOrderFlowTurn(params: {
  context: ConversationContext;
  intent: string;
  entities: ExtractedEntities;
  text: string;
  settings: Awaited<ReturnType<typeof getBusinessSettings>>;
}): Promise<OrderFlowTurnResult> {
  const { context, intent, entities, text, settings } = params;
  const state = context.orderFlow;

  // Frase de correccion explicita ("no, es de 8 presas", "mejor el otro", "en realidad...").
  // Se usa para reiniciar el pedido con el producto correcto incluso si la IA no clasifico
  // bien el intent como ORDER_PRODUCT (las correcciones son faciles de clasificar mal).
  // Exige al menos 3 palabras para no confundir un "No" o "no gracias" sueltos (respuestas
  // normales a preguntas de si/no, ej: "¿desea acompanantes?") con una correccion real.
  const looksLikeCorrection =
    text.trim().split(/\s+/).length >= 3 && /\b(no|mejor|en realidad|realmente)\b/i.test(text);

  // Intentamos resolver producto siempre que el intent sea de pedido o el mensaje suene a
  // correccion, sin importar el paso: si el cliente esta a mitad de flujo (ej: le
  // preguntamos domicilio) y menciona otro producto del menu, orderFlow.decideOrderFlow
  // detecta esto y reinicia el pedido en vez de trabarse en el slot que el cliente ignora.
  const needsProductMatch =
    state.step === OrderFlowStep.IDLE ||
    state.step === OrderFlowStep.COLLECTING_ITEMS ||
    intent === Intent.ORDER_PRODUCT ||
    looksLikeCorrection;
  const productResolution = needsProductMatch ? await resolveProductFromEntities(entities, text) : null;
  const matchedProduct =
    productResolution?.status === "MATCHED" && productResolution.product?.available
      ? {
          id: productResolution.product.product.id,
          name: productResolution.product.product.name,
          price: productResolution.product.product.price,
          categoryName: productResolution.product.product.categoryName,
          unitCount: productResolution.product.product.unitCount,
          isCombo: productResolution.product.product.isCombo,
          comboItems: productResolution.product.product.comboItems,
        }
      : null;

  if (productResolution?.status === "AMBIGUOUS") {
    const options = productResolution.candidates.map((candidate) => candidate.product.name).slice(0, 4);
    const replyText = await generateResponse({
      facts: options.length > 0 ? [`Encontre varias opciones para "${productResolution.query}": ${options.join(", ")}.`] : [],
      askNext: "¿Cual de esas opciones desea exactamente?",
      businessName: settings.restaurantName,
      tone: settings.assistantTone,
    });
    return { replyText, madeProgress: true, nextState: state, orderCreated: false, stateBeforeReset: state };
  }

  if (productResolution?.status === "MATCHED" && productResolution.product && !productResolution.product.available) {
    const suggestions = productResolution.suggestions
      .filter((candidate) => candidate.available)
      .map((candidate) => candidate.product.name)
      .slice(0, 3);
    const replyText = await generateResponse({
      facts: [
        `${productResolution.product.product.name} esta agotado en este momento.`,
        ...(suggestions.length > 0 ? [`Opciones relacionadas disponibles: ${suggestions.join(", ")}.`] : []),
      ],
      askNext: "¿Desea otra opcion del menu?",
      businessName: settings.restaurantName,
      tone: settings.assistantTone,
    });
    return { replyText, madeProgress: true, nextState: state, orderCreated: false, stateBeforeReset: state };
  }

  // El cliente pide una categoria completa en vez de un producto puntual (ej: "quiero una
  // bebida", "que tienen de acompañante") al arrancar o seguir armando el pedido — se le
  // muestra esa categoria con precios en vez del generico "¿que le gustaria pedir?", que no
  // ayuda si no sabe que hay disponible.
  if (
    !matchedProduct &&
    (state.step === OrderFlowStep.IDLE || state.step === OrderFlowStep.COLLECTING_ITEMS) &&
    intent === Intent.ORDER_PRODUCT
  ) {
    const categoryMatch = await findCategoryMatch(text);
    if (categoryMatch) {
      const replyText = await buildCategoryReply(categoryMatch, settings, null);
      return { replyText, madeProgress: true, nextState: state, orderCreated: false, stateBeforeReset: state };
    }
  }

  // Resolvemos acompanantes/otros productos mencionados en CUALQUIER paso del flujo de pedido,
  // no solo cuando se pregunta explicitamente por ellos — asi "pollo 8 piezas y una gaseosa"
  // en un solo mensaje no pierde la gaseosa.
  const { matched: matchedSides, unmatchedTexts: unmatchedSideTexts } =
    entities.sides && entities.sides.length > 0
      ? await resolveSidesFromEntities(entities)
      : { matched: [], unmatchedTexts: [] };

  // Bebidas/acompanantes disponibles del catalogo, para ofrecerlos explicitamente en
  // ASK_DRINKS/ASK_SIDES ("¿que desea tomar? tenemos: gaseosa, jugo natural...") en vez de
  // una pregunta generica sin precios.
  const drinksCategory = await findCategoryMatch("bebidas");
  const availableDrinks = (drinksCategory?.products ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    categoryName: drinksCategory!.categoryName,
  }));
  const sidesCategory = await findCategoryMatch("acompanantes");
  const availableSides = (sidesCategory?.products ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    categoryName: sidesCategory!.categoryName,
  }));

  let decision = decideOrderFlow({
    state,
    intent,
    entities,
    matchedProduct,
    matchedSides,
    unmatchedSideTexts,
    businessDeliveryFee: settings.deliveryFee,
    currency: settings.currency,
    isCorrectionAttempt: looksLikeCorrection,
    acceptedPaymentMethods: settings.acceptedPaymentMethods as PaymentMethod[],
    availableDrinks,
    availableSides,
    isExplicitCancelRequest: isExplicitCancelRequest(text),
  });

  if (decision.nextState.step === OrderFlowStep.CONFIRMING || state.step === OrderFlowStep.CONFIRMING) {
    const pricing = await calculateCartPricing({
      cart: decision.nextState.cart,
      activeCart: context.activeCart ?? null,
      deliveryType: decision.nextState.deliveryType,
      currency: settings.currency,
      businessDeliveryFee: settings.deliveryFee,
    });

    if (pricing.valid) {
      decision = {
        ...decision,
        nextState: { ...decision.nextState, cart: pricing.repricedCartLines },
        facts: formatCartPricingFacts(pricing),
      };
      if (pricing.repricedActiveCart) {
        context.activeCart = pricing.repricedActiveCart;
      }
    } else {
      decision = {
        ...decision,
        facts: [pricing.issues[0]?.message ?? "No pude validar el pedido con los precios actuales."],
        askNext: "¿Desea corregir el pedido para continuar?",
        readyToCreateOrder: false,
      };
    }
  }

  // Al confirmar que el pedido es a domicilio, le contamos de una vez el costo, un resumen
  // de lo que lleva pedido, y un estimado de entrega que refleja la cola de cocina actual
  // (no un numero fijo) en vez de mandarlo a preguntar eso por separado despues.
  let extraFacts: string[] = [];
  if (state.step === OrderFlowStep.ASK_DELIVERY_TYPE && decision.nextState.step === OrderFlowStep.ASK_ADDRESS) {
    const etaMinutes = await estimateDeliveryMinutes(settings.estimatedPrepMinutes);
    const cartSummary = state.cart.map((i) => `${i.quantity}x ${i.productName}`).join(", ");
    extraFacts = [
      settings.deliveryFee > 0
        ? `El domicilio tiene un costo de ${formatCurrency(settings.deliveryFee, settings.currency)}.`
        : "El domicilio no tiene costo adicional.",
      `Su pedido hasta ahora: ${cartSummary}.`,
      `Segun como esta la cocina ahora mismo, el tiempo estimado de entrega es de aproximadamente ${etaMinutes} minutos.`,
    ];
  }

  const stepChanged = decision.nextState.step !== state.step;
  const madeProgress = stepChanged || decision.facts.length > 0 || decision.readyToCreateOrder || decision.cancelled;

  let replyText: string;
  if (decision.readyToCreateOrder) {
    // No se manda nada en este punto: el unico mensaje del cierre lo arma handleOrderCreation
    // (pedido creado, total y tiempo estimado). El "Estamos confirmando su pedido..." que
    // habia antes solo agregaba un mensaje de relleno justo antes del mensaje real.
    replyText = "";
  } else {
    replyText = await generateResponse({
      facts: [...decision.facts, ...extraFacts],
      askNext: decision.askNext,
      businessName: settings.restaurantName,
      tone: settings.assistantTone,
    });
  }

  return {
    replyText,
    madeProgress,
    nextState: decision.readyToCreateOrder ? initialOrderFlowState : decision.nextState,
    orderCreated: decision.readyToCreateOrder,
    stateBeforeReset: state,
  };
}
