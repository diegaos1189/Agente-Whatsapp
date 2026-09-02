import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { ConversationStatus } from "@pollos/shared";

const state = vi.hoisted(() => {
  let releaseSecondEnqueue = () => {};
  return {
    contacts: [] as any[],
    conversations: [] as any[],
    messages: [] as any[],
    inboundMessages: [] as any[],
    leases: [] as any[],
    sentTexts: [] as Array<{ phone: string; body: string }>,
    catalog: [
      {
        id: "cat-pollos",
        name: "Pollos",
        products: [
          {
            id: "pollo-8",
            name: "Pollo 8 presas",
            price: 42000,
            showInMenu: true,
            isCombo: false,
            comboItems: [],
            unitCount: 8,
            isAvailable: true,
            isDefaultVariant: true,
          },
        ],
      },
    ],
    settings: {
      restaurantId: "local-deployment",
      restaurantName: "Pollos Test",
      agentName: "Lina",
      welcomeMessage: "Bienvenido a Pollos Test",
      assistantTone: "amable",
      acceptsScheduledOrders: false,
      outOfHoursMessage: "Cerrado",
      acceptedPaymentMethods: ["CASH"],
      currency: "COP",
      deliveryFee: 0,
      maxUpsellOffers: 1,
      whatsappProvider: "meta",
      menuImages: [] as string[],
    },
    blockSecondEnqueue: false,
    secondEnqueuePromise: Promise.resolve(),
    resetSecondEnqueueGate() {
      this.secondEnqueuePromise = new Promise<void>((resolve) => {
        releaseSecondEnqueue = resolve;
      });
    },
    releaseSecondEnqueue() {
      releaseSecondEnqueue();
    },
    emptyQueueObserved: false,
    pauseLeaseReleaseOnce: false,
    nextContactId: 1,
    nextConversationId: 1,
    nextMessageId: 1,
    nextInboundId: 1n,
  };
});

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

vi.mock("../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../src/db/prisma.js", () => {
  const contactApi = {
    findUnique: vi.fn(async ({ where }: any) => {
      // El contacto ahora es unico por (restaurante, telefono), igual que en la base real.
      if (where.restaurantId_phone) {
        const { restaurantId, phone } = where.restaurantId_phone;
        return state.contacts.find((item) => item.restaurantId === restaurantId && item.phone === phone) ?? null;
      }
      if (where.phone) return state.contacts.find((item) => item.phone === where.phone) ?? null;
      if (where.id) return state.contacts.find((item) => item.id === where.id) ?? null;
      return null;
    }),
    create: vi.fn(async ({ data }: any) => {
      if (state.contacts.some((item) => item.phone === data.phone)) {
        throw new Prisma.PrismaClientKnownRequestError("duplicate contact", {
          code: "P2002",
          clientVersion: "5.22.0",
        });
      }
      const row = {
        id: `contact-${state.nextContactId++}`,
        restaurantId: data.restaurantId ?? "local-deployment",
        phone: data.phone,
        name: data.name ?? null,
        cartRecoveryOptOutAt: null,
        cartRecoveryOptOutReason: null,
        createdAt: new Date("2026-08-22T10:00:00.000-05:00"),
        updatedAt: new Date("2026-08-22T10:00:00.000-05:00"),
      };
      state.contacts.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = state.contacts.find((item) => item.id === where.id);
      if (!row) throw new Error("contact not found");
      Object.assign(row, data);
      row.updatedAt = new Date("2026-08-22T10:00:01.000-05:00");
      return row;
    }),
  };

  const conversationApi = {
    findFirst: vi.fn(async ({ where }: any) => {
      const rows = state.conversations
        .filter((item) => item.contactId === where.contactId && where.status.in.includes(item.status))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return rows[0] ?? null;
    }),
    create: vi.fn(async ({ data }: any) => {
      const row = {
        id: `conv-${state.nextConversationId++}`,
        restaurantId: "local-deployment",
        contactId: data.contactId,
        status: data.status ?? ConversationStatus.ACTIVE,
        isHandoff: false,
        handoffReason: null,
        assignedAdminUserId: null,
        takenAt: null,
        failedAttempts: 0,
        context: clone(data.context ?? {}),
        lastMessageAt: null,
        createdAt: new Date("2026-08-22T10:00:00.000-05:00"),
        updatedAt: new Date("2026-08-22T10:00:00.000-05:00"),
      };
      state.conversations.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = state.conversations.find((item) => item.id === where.id);
      if (!row) throw new Error("conversation not found");
      Object.assign(row, data);
      row.updatedAt = new Date("2026-08-22T10:00:02.000-05:00");
      return row;
    }),
    findUnique: vi.fn(async ({ where }: any) => state.conversations.find((item) => item.id === where.id) ?? null),
    findUniqueOrThrow: vi.fn(async ({ where }: any) => {
      const row = state.conversations.find((item) => item.id === where.id);
      if (!row) throw new Error("conversation not found");
      return row;
    }),
  };

  const messageApi = {
    create: vi.fn(async ({ data }: any) => {
      const row = {
        id: `msg-${state.nextMessageId++}`,
        createdAt: new Date("2026-08-22T10:00:03.000-05:00"),
        ...data,
      };
      state.messages.push(row);
      return row;
    }),
    findMany: vi.fn(async ({ where, orderBy, take }: any) => {
      let rows = state.messages.filter((item) => item.conversationId === where.conversationId);
      if (orderBy?.createdAt === "desc") rows = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      if (take) rows = rows.slice(0, take);
      return rows;
    }),
  };

  const inboundApi = {
    create: vi.fn(async ({ data }: any) => {
      if (state.inboundMessages.some((item) => item.waMessageId === data.waMessageId)) {
        throw new Prisma.PrismaClientKnownRequestError("duplicate inbound", {
          code: "P2002",
          clientVersion: "5.22.0",
        });
      }
      const isSecond = state.inboundMessages.length === 1;
      if (state.blockSecondEnqueue && isSecond) {
        await state.secondEnqueuePromise;
      }
      const row = {
        id: state.nextInboundId++,
        waMessageId: data.waMessageId,
        contactId: data.contactId,
        fromPhone: data.fromPhone,
        customerName: data.customerName ?? null,
        inboundType: data.inboundType,
        text: data.text ?? null,
        mediaId: data.mediaId ?? null,
        providerTimestamp: data.providerTimestamp ?? null,
        processingStatus: "PENDING",
        attempts: 0,
        processingStartedAt: null,
        processedAt: null,
        lastError: null,
        leaseExpiresAt: null,
        createdAt: new Date(Date.now() - 10_000),
        updatedAt: new Date("2026-08-22T10:00:00.000-05:00"),
      };
      state.inboundMessages.push(row);
      return row;
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      const next = state.inboundMessages
        .filter((item) => {
          if (item.contactId !== where.contactId) return false;
          return where.OR.some((rule: any) => {
            if (rule.processingStatus === "PENDING") return item.processingStatus === "PENDING";
            if (rule.processingStatus === "FAILED") return item.processingStatus === "FAILED";
            if (rule.processingStatus === "PROCESSING" && rule.leaseExpiresAt?.lt) {
              return item.processingStatus === "PROCESSING" && item.leaseExpiresAt && item.leaseExpiresAt < rule.leaseExpiresAt.lt;
            }
            return false;
          });
        })
        .sort((a, b) => Number(a.id - b.id))[0] ?? null;

      if (!next && state.blockSecondEnqueue && !state.emptyQueueObserved) {
        state.emptyQueueObserved = true;
        state.pauseLeaseReleaseOnce = true;
        state.releaseSecondEnqueue();
      }

      return next;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const rows = state.inboundMessages.filter((item) => {
        if (where.id && item.id !== where.id) return false;
        return where.OR.some((rule: any) => {
          if (rule.processingStatus === "PENDING") return item.processingStatus === "PENDING";
          if (rule.processingStatus === "FAILED") return item.processingStatus === "FAILED";
          if (rule.processingStatus === "PROCESSING" && rule.leaseExpiresAt?.lt) {
            return item.processingStatus === "PROCESSING" && item.leaseExpiresAt && item.leaseExpiresAt < rule.leaseExpiresAt.lt;
          }
          return false;
        });
      });
      for (const row of rows) {
        row.processingStatus = data.processingStatus ?? row.processingStatus;
        row.processingStartedAt = data.processingStartedAt ?? row.processingStartedAt;
        row.leaseExpiresAt = data.leaseExpiresAt ?? row.leaseExpiresAt;
        row.lastError = data.lastError ?? row.lastError;
        if (data.attempts?.increment) row.attempts += data.attempts.increment;
      }
      return { count: rows.length };
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: any) => {
      const row = state.inboundMessages.find((item) => item.id === where.id);
      if (!row) throw new Error("inbound not found");
      return row;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = state.inboundMessages.find((item) => item.id === where.id);
      if (!row) throw new Error("inbound not found");
      Object.assign(row, data);
      return row;
    }),
  };

  const leaseApi = {
    updateMany: vi.fn(async ({ where, data }: any) => {
      const rows = state.leases.filter((item) => {
        if (where.contactId && item.contactId !== where.contactId) return false;
        if (where.leaseToken && item.leaseToken !== where.leaseToken) return false;
        if (where.OR) {
          return where.OR.some((rule: any) => {
            if (rule.leaseToken) return item.leaseToken === rule.leaseToken;
            if (rule.leaseExpiresAt?.lt) return item.leaseExpiresAt < rule.leaseExpiresAt.lt;
            return false;
          });
        }
        return true;
      });

      if (data.processingState === "IDLE" && state.pauseLeaseReleaseOnce) {
        state.pauseLeaseReleaseOnce = false;
        await Promise.resolve();
      }

      for (const row of rows) {
        Object.assign(row, data);
      }
      return { count: rows.length };
    }),
    create: vi.fn(async ({ data }: any) => {
      if (state.leases.some((item) => item.contactId === data.contactId)) {
        throw new Prisma.PrismaClientKnownRequestError("duplicate lease", {
          code: "P2002",
          clientVersion: "5.22.0",
        });
      }
      state.leases.push({ ...data });
      return data;
    }),
  };

  const prisma = {
    contact: contactApi,
    conversation: conversationApi,
    message: messageApi,
    inboundWhatsAppMessage: inboundApi,
    contactMessageProcessingLease: leaseApi,
    $transaction: vi.fn(async (arg: any) => {
      if (typeof arg === "function") {
        return arg({
          inboundWhatsAppMessage: inboundApi,
          contactMessageProcessingLease: leaseApi,
        });
      }
      throw new Error("unsupported transaction usage");
    }),
  };

  return { prisma };
});

vi.mock("../src/modules/business/businessHoursService.js", () => ({
  getBusinessSettings: vi.fn(async () => state.settings),
  checkIsOpen: vi.fn(() => ({ isOpen: true })),
}));

vi.mock("../src/modules/whatsapp/whatsappClient.js", () => ({
  getWhatsAppClient: vi.fn(async () => ({
    sendTextMessage: vi.fn(async (phone: string, body: string) => {
      state.sentTexts.push({ phone, body });
      return { success: true, providerMessageId: `wamid-out-${state.sentTexts.length}` };
    }),
  })),
}));

vi.mock("../src/modules/ai/responseGenerator.js", () => ({
  generateResponse: vi.fn(async ({ facts, askNext }: any) => {
    const factText = Array.isArray(facts) ? facts.filter(Boolean).join(" | ") : "";
    return [factText, askNext].filter(Boolean).join("\n");
  }),
}));

vi.mock("../src/modules/ai/intentClassifier.js", () => ({
  classifyIntent: vi.fn(async () => ({ intent: "UNKNOWN", confidence: 0 })),
}));

vi.mock("../src/modules/ai/entityExtractor.js", () => ({
  EMPTY_ENTITIES: {},
  extractEntities: vi.fn(async () => ({})),
}));

vi.mock("../src/modules/ai/aiClient.js", () => ({
  transcribeAudio: vi.fn(),
  describeImage: vi.fn(),
}));

vi.mock("../src/modules/products/productService.js", () => ({
  listCatalog: vi.fn(async () => state.catalog),
  listActivePromotions: vi.fn(async () => []),
  findBestProductMatch: vi.fn(async () => null),
  findCategoryMatch: vi.fn(async () => null),
  applyPromotionDiscount: vi.fn(),
  isPromoActiveToday: vi.fn(() => true),
  getEffectivePrice: vi.fn(async (_restaurantId: string, _id: string, price: number) => price),
  resolveProductReference: vi.fn(async () => null),
  listAllProductsFlat: vi.fn(async () => state.catalog.flatMap((category: any) => category.products)),
}));

vi.mock("../src/modules/orders/orderService.js", () => ({
  createOrder: vi.fn(),
  getLatestOrderForContact: vi.fn(async () => null),
  ORDER_STATUS_LABELS_ES: {},
  ORDER_STATUS_CUSTOMER_MESSAGE: {},
  estimateDeliveryMinutes: vi.fn(() => 45),
}));

vi.mock("../src/modules/n8n/n8nClient.js", () => ({
  n8nClient: {
    notifyPaymentReminder: vi.fn(),
  },
}));

vi.mock("../src/modules/faq/faqService.js", () => ({
  findFaqMatch: vi.fn(async () => null),
}));

vi.mock("../src/modules/payments/paymentService.js", () => ({
  markPaymentReported: vi.fn(),
}));

vi.mock("../src/modules/localization/localeService.js", () => ({
  isGenericOrderConfirmation: vi.fn(() => false),
  isPlainAffirmativeReply: vi.fn(() => false),
  isRegionalCancellation: vi.fn(() => false),
  isRegionalConfirmation: vi.fn(() => false),
  normalizeLocalizedText: vi.fn((text: string) => text),
}));

vi.mock("../src/modules/conversation/cartRecoveryService.js", () => ({
  findLatestSentCartRecovery: vi.fn(async () => null),
  isCartRecoveryCancelMessage: vi.fn(() => false),
  isCartRecoveryOptOutMessage: vi.fn(() => false),
  isCartRecoveryResumeMessage: vi.fn(() => false),
  markRecoveryCancelled: vi.fn(),
  markRecoveryConverted: vi.fn(),
  markRecoveryReplied: vi.fn(),
  recordCartRecoveryOptOut: vi.fn(),
  syncCartRecoveryFromConversation: vi.fn(),
}));

vi.mock("../src/modules/conversation/recommendationService.js", () => ({
  createUpsellAuditEvent: vi.fn(),
  getCartRecommendations: vi.fn(async () => []),
  isUpsellAcceptMessage: vi.fn(() => false),
  isUpsellOptOutMessage: vi.fn(() => false),
  isUpsellRejectMessage: vi.fn(() => false),
  isUpsellSuspendAllMessage: vi.fn(() => false),
  shouldOfferUpsellThisTurn: vi.fn(() => false),
}));

vi.mock("../src/modules/conversation/orderStatusService.js", () => ({
  looksLikeOrderStatusFollowUp: vi.fn(() => false),
  resolveDeliveredConflict: vi.fn(async () => ({ shouldHandoff: false, orderTracking: { lastReferencedOrderId: null, lastReferencedOrderCode: null } })),
  resolveOrderStatusQuery: vi.fn(async () => ({ kind: "NOT_FOUND", facts: ["No hay pedidos recientes"], askNext: null, orderTracking: { lastReferencedOrderId: null, lastReferencedOrderCode: null } })),
}));

vi.mock("../src/modules/conversation/whatsappAudioService.js", () => ({
  processWhatsAppAudio: vi.fn(),
}));

import { handleIncomingMessage } from "../src/modules/conversation/conversationService.js";

describe("handleIncomingMessage lease race", () => {
  beforeEach(() => {
    state.contacts = [];
    state.conversations = [];
    state.messages = [];
    state.inboundMessages = [];
    state.leases = [];
    state.sentTexts = [];
    state.blockSecondEnqueue = true;
    state.resetSecondEnqueueGate();
    state.emptyQueueObserved = false;
    state.pauseLeaseReleaseOnce = false;
    state.nextContactId = 1;
    state.nextConversationId = 1;
    state.nextMessageId = 1;
    state.nextInboundId = 1n;
  });

  it("procesa dos webhooks paralelos de sesion nueva con una sola conversacion y una sola bienvenida", async () => {
    await Promise.all([
      handleIncomingMessage({
        restaurantId: "local-deployment",
        waMessageId: "wamid-1",
        phone: "573001112233",
        name: "Diego",
        type: "TEXT",
        text: "ola",
        mediaId: null,
        providerTimestamp: "2026-08-22T10:00:00-05:00",
      }),
      handleIncomingMessage({
        restaurantId: "local-deployment",
        waMessageId: "wamid-2",
        phone: "573001112233",
        name: "Diego",
        type: "TEXT",
        text: "1",
        mediaId: null,
        providerTimestamp: "2026-08-22T10:00:01-05:00",
      }),
    ]);

    expect(state.conversations).toHaveLength(1);
    expect(state.sentTexts.filter((item) => item.body === state.settings.welcomeMessage)).toHaveLength(1);
    expect(state.inboundMessages).toHaveLength(2);
    expect(state.inboundMessages.every((item) => item.processingStatus === "PROCESSED")).toBe(true);
    expect(state.sentTexts).toHaveLength(2);
    // "1" = VIEW_MENU en el shortcut de bienvenida: ahora primero muestra categorias
    // numeradas (menu en dos pasos) en vez del listado plano de productos.
    expect(state.sentTexts[1]?.body).toContain("1. Pollos");
  });
});
