import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { ConversationStatus, OrderFlowStep } from "@pollos/shared";

// Reproduce el bucle de confirmacion real reportado en un pedido a domicilio (ver captura:
// "1" repetido tres veces, el bot sigue mandando "¿Confirma su pedido asi?" con el mismo total
// sin crear nunca el pedido) recorriendo el flujo COMPLETO desde cero, incluyendo la seleccion
// de acompanante Y bebida por el menu numerado deterministico (pendingMenu "ADDON", ver fix en
// sidesNumberedSelection.test.ts) antes de domicilio/direccion/pago/confirmar — asi de fiel al
// reporte real como es posible ("...con papitas a la francesa, ensalada y arepa con queso,
// ademas de unos aros de cebolla y un agua brisa grande"). La idea es detectar si algo se
// acumula/desincroniza (checkout, activeCart, pendingMenu) a lo largo de varios turnos que un
// test de un solo paso no alcanza a ver.

const state = vi.hoisted(() => ({
  contacts: [] as any[],
  conversations: [] as any[],
  messages: [] as any[],
  inboundMessages: [] as any[],
  leases: [] as any[],
  sentTexts: [] as Array<{ phone: string; body: string }>,
  catalog: [
    {
      id: "cat-asados",
      name: "Asados",
      parentCategoryId: null,
      products: [
        {
          id: "prod-chuzo",
          name: "Chuzo de pollo",
          price: 21500,
          showInMenu: true,
          isCombo: false,
          comboItems: [],
          unitCount: null,
          isAvailable: true,
          isDefaultVariant: true,
          categoryName: "Asados",
        },
      ],
    },
    {
      id: "cat-acompanantes",
      name: "Acompanantes",
      parentCategoryId: null,
      products: [
        {
          id: "side-aros",
          name: "Aros de cebolla",
          price: 4600,
          showInMenu: true,
          isCombo: false,
          comboItems: [],
          unitCount: null,
          isAvailable: true,
          isDefaultVariant: false,
          categoryName: "Acompanantes",
        },
      ],
    },
    {
      id: "cat-bebidas",
      name: "Bebidas",
      parentCategoryId: null,
      products: [
        {
          id: "drink-agua",
          name: "Agua Brisa grande",
          price: 3500,
          showInMenu: true,
          isCombo: false,
          comboItems: [],
          unitCount: null,
          isAvailable: true,
          isDefaultVariant: false,
          categoryName: "Bebidas",
        },
      ],
    },
  ],
  settings: {
    restaurantName: "Pollos Test",
    agentName: "Lina",
    welcomeMessage: "Bienvenido a Pollos Test",
    assistantTone: "amable",
    acceptsScheduledOrders: false,
    outOfHoursMessage: "Cerrado",
    acceptedPaymentMethods: ["CASH"],
    currency: "COP",
    deliveryFee: 4500,
    maxUpsellOffers: 1,
    whatsappProvider: "meta",
    acceptsPickup: true,
    acceptsDelivery: true,
    minimumDeliveryOrder: 0,
    deliveryCoverageKeywords: [] as string[],
    transferAccounts: [] as any[],
    estimatedPrepMinutes: 20,
  },
  nextContactId: 1,
  nextConversationId: 1,
  nextMessageId: 1,
  nextInboundId: 1n,
  nextOrderId: 1,
}));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

vi.mock("../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn((...args: any[]) => console.error("LOGGER.ERROR", ...args)),
  },
}));

vi.mock("../src/db/prisma.js", () => {
  const contactApi = {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.phone) return state.contacts.find((item) => item.phone === where.phone) ?? null;
      if (where.id) return state.contacts.find((item) => item.id === where.id) ?? null;
      return null;
    }),
    create: vi.fn(async ({ data }: any) => {
      const row = {
        id: `contact-${state.nextContactId++}`,
        phone: data.phone,
        name: data.name ?? null,
        cartRecoveryOptOutAt: null,
        cartRecoveryOptOutReason: null,
        createdAt: new Date("2026-08-23T10:00:00.000-05:00"),
        updatedAt: new Date("2026-08-23T10:00:00.000-05:00"),
      };
      state.contacts.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = state.contacts.find((item) => item.id === where.id);
      if (!row) throw new Error("contact not found");
      Object.assign(row, data);
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
        contactId: data.contactId,
        status: data.status ?? ConversationStatus.ACTIVE,
        isHandoff: false,
        handoffReason: null,
        assignedAdminUserId: null,
        takenAt: null,
        failedAttempts: 0,
        context: clone(data.context ?? {}),
        lastMessageAt: null,
        createdAt: new Date("2026-08-23T10:00:00.000-05:00"),
        updatedAt: new Date("2026-08-23T10:00:00.000-05:00"),
      };
      state.conversations.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = state.conversations.find((item) => item.id === where.id);
      if (!row) throw new Error("conversation not found");
      Object.assign(row, data);
      row.updatedAt = new Date("2026-08-23T10:00:02.000-05:00");
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
      const row = { id: `msg-${state.nextMessageId++}`, createdAt: new Date("2026-08-23T10:00:03.000-05:00"), ...data };
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
        throw new Prisma.PrismaClientKnownRequestError("duplicate inbound", { code: "P2002", clientVersion: "5.22.0" });
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
        updatedAt: new Date("2026-08-23T10:00:00.000-05:00"),
      };
      state.inboundMessages.push(row);
      return row;
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      return (
        state.inboundMessages
          .filter((item) => {
            if (item.contactId !== where.contactId) return false;
            return where.OR.some((rule: any) => {
              if (rule.processingStatus === "PENDING") return item.processingStatus === "PENDING";
              if (rule.processingStatus === "FAILED") return item.processingStatus === "FAILED";
              return false;
            });
          })
          .sort((a, b) => Number(a.id - b.id))[0] ?? null
      );
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const rows = state.inboundMessages.filter((item) => {
        if (where.id && item.id !== where.id) return false;
        return where.OR.some((rule: any) => rule.processingStatus === "PENDING" || rule.processingStatus === "FAILED");
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
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    }),
    create: vi.fn(async ({ data }: any) => {
      if (state.leases.some((item) => item.contactId === data.contactId)) {
        throw new Prisma.PrismaClientKnownRequestError("duplicate lease", { code: "P2002", clientVersion: "5.22.0" });
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
        return arg({ inboundWhatsAppMessage: inboundApi, contactMessageProcessingLease: leaseApi });
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
    sendImageMessage: vi.fn(async () => ({ success: true, providerMessageId: "wamid-img" })),
  })),
}));

vi.mock("../src/modules/ai/responseGenerator.js", () => ({
  generateResponse: vi.fn(async ({ facts, askNext }: any) => {
    const parts = [...(facts ?? [])];
    if (askNext) parts.push(askNext);
    return parts.join(" ");
  }),
}));

vi.mock("../src/modules/ai/intentClassifier.js", () => ({
  classifyIntent: vi.fn(async () => ({ intent: "UNKNOWN", confidence: 1 })),
}));

const { EMPTY_ENTITIES } = vi.hoisted(() => ({
  EMPTY_ENTITIES: {
    productType: null,
    quantity: null,
    size: null,
    sides: null,
    deliveryType: null,
    address: null,
    neighborhood: null,
    reference: null,
    paymentMethod: null,
    name: null,
    contactPhone: null,
  },
}));

// Extractor "de bolsillo" basado en palabras clave — se comporta como la IA real para los
// mensajes puntuales que este test manda (domicilio, direccion, efectivo), sin necesitar un
// modelo real. Deliberadamente simple: solo cubre lo que el flujo necesita en cada paso.
vi.mock("../src/modules/ai/entityExtractor.js", () => ({
  EMPTY_ENTITIES,
  extractEntities: vi.fn(async ({ message }: any) => {
    const text = (message as string).toLowerCase();
    const entities = { ...EMPTY_ENTITIES };
    if (text.includes("domicilio")) entities.deliveryType = "DELIVERY";
    if (text.includes("calle")) {
      entities.address = "Calle 10 # 5-20";
      entities.neighborhood = "Centro";
    }
    if (text.includes("efectivo")) entities.paymentMethod = "CASH";
    return entities;
  }),
}));

vi.mock("../src/modules/ai/aiClient.js", () => ({
  describeImage: vi.fn(),
}));

vi.mock("../src/modules/products/productService.js", () => ({
  listCatalog: vi.fn(async () => state.catalog),
  listActivePromotions: vi.fn(async () => []),
  findBestProductMatch: vi.fn(async (query: string) => {
    const normalized = query.trim().toLowerCase();
    const allProducts = state.catalog.flatMap((cat: any) => cat.products.map((p: any) => ({ ...p, categoryName: cat.name })));
    return allProducts.find((p: any) => p.name.toLowerCase() === normalized) ?? null;
  }),
  findCategoryMatch: vi.fn(async (query: string) => {
    const normalized = query.trim().toLowerCase();
    const category = state.catalog.find((cat: any) => cat.name.toLowerCase() === normalized);
    return category ? { categoryName: category.name, products: category.products } : null;
  }),
  applyPromotionDiscount: vi.fn(),
  isPromoActiveToday: vi.fn(() => true),
  getEffectivePrice: vi.fn(async (_id: string, price: number) => price),
  // Solo hace match EXACTO por nombre (case-insensitive) contra el catalogo de prueba —
  // suficiente para que el producto elegido por numero (forcedProductName) se resuelva.
  resolveProductReference: vi.fn(async (query: string) => {
    const allProducts = state.catalog.flatMap((cat: any) => cat.products.map((p: any) => ({ ...p, categoryName: cat.name })));
    const match = allProducts.find((p: any) => p.name.toLowerCase() === query.trim().toLowerCase());
    if (!match) {
      return { status: "NOT_FOUND", query, normalizedQuery: query, product: null, candidates: [], suggestions: [] };
    }
    const candidate = { product: match, confidence: 1, matchedBy: "EXACT_NAME", available: true, aliases: [] };
    return { status: "MATCHED", query, normalizedQuery: query, product: candidate, candidates: [candidate], suggestions: [] };
  }),
  listAllProductsFlat: vi.fn(async () => state.catalog.flatMap((category: any) => category.products)),
}));

vi.mock("../src/modules/orders/orderService.js", () => ({
  createOrder: vi.fn(async ({ items, deliveryType, paymentMethod, deliveryFee, total }: any) => ({
    order: {
      id: `order-${state.nextOrderId++}`,
      code: `POL-${state.nextOrderId}`,
      contactId: "contact-1",
      status: "RECEIVED",
      deliveryType,
      paymentMethod,
      paymentStatus: "PENDING",
      total,
      deliveryFee,
      address: null,
      neighborhood: null,
      reference: null,
      contactPhone: null,
      flaggedForReview: false,
      flagNote: null,
      createdAt: new Date("2026-08-23T10:00:00.000-05:00"),
      updatedAt: new Date("2026-08-23T10:00:00.000-05:00"),
      items,
      events: [],
    },
    createdNow: true,
  })),
  getLatestOrderForContact: vi.fn(async () => null),
  ORDER_STATUS_LABELS_ES: {},
  ORDER_STATUS_CUSTOMER_MESSAGE: {},
  estimateDeliveryMinutes: vi.fn(() => 45),
}));

vi.mock("../src/modules/n8n/n8nClient.js", () => ({
  n8nClient: { notifyPaymentReminder: vi.fn(), notifyHandoff: vi.fn() },
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
  resolveDeliveredConflict: vi.fn(async () => ({
    shouldHandoff: false,
    orderTracking: { lastReferencedOrderId: null, lastReferencedOrderCode: null },
  })),
  resolveOrderStatusQuery: vi.fn(async () => ({
    kind: "NOT_FOUND",
    facts: ["No hay pedidos recientes"],
    askNext: null,
    orderTracking: { lastReferencedOrderId: null, lastReferencedOrderCode: null },
  })),
}));

vi.mock("../src/modules/conversation/whatsappAudioService.js", () => ({
  processWhatsAppAudio: vi.fn(),
}));

import { handleIncomingMessage } from "../src/modules/conversation/conversationService.js";

function seedIdleConversation() {
  const contact = {
    id: `contact-${state.nextContactId++}`,
    phone: "573001112233",
    name: "Diego",
    cartRecoveryOptOutAt: null,
    cartRecoveryOptOutReason: null,
    createdAt: new Date("2026-08-23T09:00:00.000-05:00"),
    updatedAt: new Date("2026-08-23T09:00:00.000-05:00"),
  };
  state.contacts.push(contact);

  const conversation = {
    id: `conv-${state.nextConversationId++}`,
    contactId: contact.id,
    status: ConversationStatus.ACTIVE,
    isHandoff: false,
    handoffReason: null,
    assignedAdminUserId: null,
    takenAt: null,
    failedAttempts: 0,
    context: {
      orderFlow: {
        step: OrderFlowStep.IDLE,
        cart: [],
        pendingProduct: null,
        sidesAsked: false,
        drinksAsked: false,
        deliveryType: null,
        address: null,
        neighborhood: null,
        reference: null,
        contactPhone: null,
        paymentMethod: null,
      },
      pendingMenu: "PRODUCTS",
      pendingCategoryIds: null,
      pendingProductIds: ["prod-chuzo"],
      activeCart: null,
      checkout: null,
      repeatOrder: { pendingReplacement: null, lastSourceOrderId: null, lastSourceOrderCode: null },
      orderTracking: { lastReferencedOrderId: null, lastReferencedOrderCode: null },
      upsell: null,
    },
    lastMessageAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  state.conversations.push(conversation);
  return { contact, conversation };
}

async function sendMessage(phone: string, text: string, waMessageId: string) {
  await handleIncomingMessage({
    waMessageId,
    phone,
    name: "Diego",
    type: "TEXT",
    text,
    mediaId: null,
    providerTimestamp: new Date().toISOString(),
  });
}

describe("bucle de confirmacion en pedido a domicilio recorriendo el flujo completo", () => {
  beforeEach(() => {
    state.contacts = [];
    state.conversations = [];
    state.messages = [];
    state.inboundMessages = [];
    state.leases = [];
    state.sentTexts = [];
    state.nextContactId = 1;
    state.nextConversationId = 1;
    state.nextMessageId = 1;
    state.nextInboundId = 1n;
  });

  it("producto -> acompanante por numero -> bebida por numero -> domicilio -> direccion -> efectivo -> \"1\" crea el pedido sin repetir la confirmacion", async () => {
    const { contact } = seedIdleConversation();

    await sendMessage(contact.phone, "1", "wamid-1"); // elige "Chuzo de pollo" del menu numerado
    await sendMessage(contact.phone, "1", "wamid-2"); // cantidad: 1 -> muestra menu numerado de acompanantes (ADDON)
    await sendMessage(contact.phone, "1", "wamid-3"); // elige "Aros de cebolla" por numero -> muestra menu numerado de bebidas (ADDON)
    await sendMessage(contact.phone, "1", "wamid-4"); // elige "Agua Brisa grande" por numero
    await sendMessage(contact.phone, "domicilio", "wamid-5"); // tipo de entrega
    await sendMessage(contact.phone, "Calle 10 # 5-20, Centro", "wamid-6"); // direccion
    await sendMessage(contact.phone, "efectivo", "wamid-7"); // metodo de pago

    const convBeforeConfirm = state.conversations.find((c) => c.contactId === contact.id)!;
    expect(convBeforeConfirm.context.orderFlow.step).toBe(OrderFlowStep.CONFIRMING);
    expect(convBeforeConfirm.context.orderFlow.cart.map((i: any) => i.productName)).toEqual([
      "Chuzo de pollo",
      "Aros de cebolla",
      "Agua Brisa grande",
    ]);
    const confirmPromptCount = state.sentTexts.length;

    await sendMessage(contact.phone, "1", "wamid-8"); // confirma

    const conv = state.conversations.find((c) => c.contactId === contact.id)!;
    const newMessages = state.sentTexts.slice(confirmPromptCount);
    expect(conv.context.orderFlow.step).not.toBe(OrderFlowStep.CONFIRMING);
    expect(newMessages).toHaveLength(1);
    expect(newMessages[0]!.body).not.toContain("¿Confirma su pedido");
    expect(newMessages[0]!.body).not.toContain("necesito una nueva confirmacion");
    expect(newMessages[0]!.body).toContain("creado con exito");
  });
});
