import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { ConversationStatus } from "@pollos/shared";

const state = vi.hoisted(() => ({
  contacts: [] as any[],
  conversations: [] as any[],
  messages: [] as any[],
  inboundMessages: [] as any[],
  leases: [] as any[],
  sentTexts: [] as Array<{ phone: string; body: string }>,
  catalog: [
    {
      id: "cat-pollo",
      name: "Pollo Asado",
      parentCategoryId: null,
      products: [
        {
          id: "prod-entero",
          name: "Pollo Asado Entero",
          price: 48000,
          showInMenu: true,
          isCombo: false,
          comboItems: [],
          unitCount: null,
          isAvailable: true,
          isDefaultVariant: true,
        },
      ],
    },
    {
      id: "cat-acompanantes",
      name: "Acompañantes",
      parentCategoryId: null,
      products: [
        {
          id: "prod-papas",
          name: "Papas Francesas",
          price: 6000,
          showInMenu: true,
          isCombo: false,
          comboItems: [],
          unitCount: null,
          isAvailable: true,
          isDefaultVariant: false,
        },
        {
          id: "prod-arepa",
          name: "Arepa",
          price: 3000,
          showInMenu: true,
          isCombo: false,
          comboItems: [],
          unitCount: null,
          isAvailable: true,
          isDefaultVariant: false,
        },
      ],
    },
    {
      id: "cat-bebidas",
      name: "Bebidas",
      parentCategoryId: null,
      products: [
        {
          id: "prod-coca",
          name: "Coca-Cola",
          price: 4000,
          showInMenu: true,
          isCombo: false,
          comboItems: [],
          unitCount: null,
          isAvailable: true,
          isDefaultVariant: false,
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
    deliveryFee: 0,
    maxUpsellOffers: 1,
    whatsappProvider: "meta",
    menuImages: [] as string[],
  },
  nextContactId: 1,
  nextConversationId: 1,
  nextMessageId: 1,
  nextInboundId: 1n,
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
        createdAt: new Date("2026-08-29T10:00:00.000-05:00"),
        updatedAt: new Date("2026-08-29T10:00:00.000-05:00"),
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
        createdAt: new Date("2026-08-29T10:00:00.000-05:00"),
        updatedAt: new Date("2026-08-29T10:00:00.000-05:00"),
      };
      state.conversations.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = state.conversations.find((item) => item.id === where.id);
      if (!row) throw new Error("conversation not found");
      Object.assign(row, data);
      row.updatedAt = new Date("2026-08-29T10:00:02.000-05:00");
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
      const row = { id: `msg-${state.nextMessageId++}`, createdAt: new Date("2026-08-29T10:00:03.000-05:00"), ...data };
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
        updatedAt: new Date("2026-08-29T10:00:00.000-05:00"),
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
  classifyIntent: vi.fn(async () => ({ intent: "ORDER_PRODUCT", confidence: 1 })),
}));

vi.mock("../src/modules/ai/entityExtractor.js", () => ({
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
  extractEntities: vi.fn(async () => ({
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
  })),
}));

vi.mock("../src/modules/ai/aiClient.js", () => ({
  describeImage: vi.fn(),
}));

function findCategoryByKeyword(keyword: string) {
  const normalized = keyword
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return state.catalog.find((cat: any) =>
    cat.name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .includes(normalized),
  );
}

vi.mock("../src/modules/products/productService.js", () => ({
  listCatalog: vi.fn(async () => state.catalog),
  listActivePromotions: vi.fn(async () => []),
  findBestProductMatch: vi.fn(async (query: string) => {
    const allProducts = state.catalog.flatMap((cat: any) => cat.products.map((p: any) => ({ ...p, categoryName: cat.name })));
    return allProducts.find((p: any) => p.name.toLowerCase() === query.trim().toLowerCase()) ?? null;
  }),
  findCategoryMatch: vi.fn(async (query: string) => {
    const category = findCategoryByKeyword(query);
    if (!category) return null;
    return { categoryName: category.name, products: category.products };
  }),
  applyPromotionDiscount: vi.fn(),
  isPromoActiveToday: vi.fn(() => true),
  getEffectivePrice: vi.fn(async (_id: string, price: number) => price),
  resolveProductReference: vi.fn(async (query: string) => {
    const allProducts = state.catalog.flatMap((cat: any) =>
      cat.products.map((p: any) => ({ ...p, categoryName: cat.name, categoryId: cat.id })),
    );
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
  createOrder: vi.fn(async () => ({ order: { id: "order-1", code: "POL-TEST-1" } })),
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
import { OrderFlowStep } from "@pollos/shared";

function seedInSides(overrides: Partial<any> = {}) {
  const contact = {
    id: `contact-${state.nextContactId++}`,
    phone: "573001112233",
    name: "Diego",
    cartRecoveryOptOutAt: null,
    cartRecoveryOptOutReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
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
        step: OrderFlowStep.ASK_SIDES,
        cart: [{ productId: "prod-entero", productName: "Pollo Asado Entero", quantity: 1, unitPrice: 48000 }],
        deliveryType: null,
        paymentMethod: null,
        address: null,
        neighborhood: null,
        reference: null,
        contactPhone: null,
        sidesAsked: false,
        drinksAsked: false,
        pendingProduct: null,
      },
      pendingMenu: null,
      pendingCategoryIds: null,
      pendingProductIds: null,
      pendingSideDrink: { step: "SIDES", stage: "CONFIRM", optionIds: [] },
      activeCart: null,
      checkout: null,
      repeatOrder: { pendingReplacement: null, lastSourceOrderId: null, lastSourceOrderCode: null },
      orderTracking: { lastReferencedOrderId: null, lastReferencedOrderCode: null },
      upsell: null,
      ...overrides,
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

describe("acompañantes/bebidas guiados por numero", () => {
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

  it("al llegar a ASK_SIDES pregunta si/no de forma fija, sin texto de IA", async () => {
    // Simula el turno que agrega el producto principal y hace que orderFlow entre a
    // ASK_SIDES por primera vez — se logra pidiendo el producto por numero completo,
    // desde IDLE, y confirmando la cantidad.
    const contact = {
      id: `contact-${state.nextContactId++}`,
      phone: "573001112233",
      name: "Diego",
      cartRecoveryOptOutAt: null,
      cartRecoveryOptOutReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
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
          step: OrderFlowStep.ASK_QUANTITY_OR_SIZE,
          cart: [],
          deliveryType: null,
          paymentMethod: null,
          address: null,
          neighborhood: null,
          reference: null,
          contactPhone: null,
          sidesAsked: false,
          drinksAsked: false,
          pendingProduct: { id: "prod-entero", name: "Pollo Asado Entero", price: 48000, categoryName: "Pollo Asado" },
        },
        pendingMenu: null,
        pendingCategoryIds: null,
        pendingProductIds: null,
        pendingSideDrink: null,
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

    await sendMessage(contact.phone, "1", "wamid-1");

    expect(state.sentTexts).toHaveLength(1);
    const body = state.sentTexts[0]!.body;
    expect(body).toContain("¿Deseas agregar algún acompañante?");
    expect(body).toContain("1. Sí");
    expect(body).toContain("2. No");
    // No debe traer la redaccion de IA confusa (mock de generateResponse concatena
    // facts+askNext con espacios, muy distinto al texto fijo esperado).
    expect(body).not.toContain("por favor dime el nombre exacto");

    const conv = state.conversations.find((c) => c.contactId === contact.id)!;
    expect(conv.context.pendingSideDrink).toEqual({ step: "SIDES", stage: "CONFIRM", optionIds: [] });
  });

  it("'1' en la confirmacion de acompanantes muestra los productos numerados", async () => {
    const { contact } = seedInSides();
    await sendMessage(contact.phone, "1", "wamid-1");

    expect(state.sentTexts).toHaveLength(1);
    const body = state.sentTexts[0]!.body;
    expect(body).toContain("1. Papas Francesas");
    expect(body).toContain("2. Arepa");

    const conv = state.conversations.find((c) => c.contactId === contact.id)!;
    expect(conv.context.pendingSideDrink).toEqual({
      step: "SIDES",
      stage: "PICK",
      optionIds: ["prod-papas", "prod-arepa"],
    });
  });

  it("elegir un acompanante por numero lo agrega y pasa a preguntar por bebidas", async () => {
    const { contact } = seedInSides({
      pendingSideDrink: { step: "SIDES", stage: "PICK", optionIds: ["prod-papas", "prod-arepa"] },
    });
    await sendMessage(contact.phone, "1", "wamid-1");

    const conv = state.conversations.find((c) => c.contactId === contact.id)!;
    expect(JSON.stringify(conv.context.orderFlow.cart)).toContain("Papas Francesas");
    expect(conv.context.orderFlow.step).toBe(OrderFlowStep.ASK_DRINKS);
    expect(conv.context.pendingSideDrink).toEqual({ step: "DRINKS", stage: "CONFIRM", optionIds: [] });

    const body = state.sentTexts[0]!.body;
    expect(body).toContain("¿Deseas agregar alguna bebida?");
    expect(body).toContain("1. Sí");
    expect(body).toContain("2. No");
  });

  it("'2' (no) en acompanantes no agrega nada y pasa directo a preguntar por bebidas", async () => {
    const { contact } = seedInSides();
    await sendMessage(contact.phone, "2", "wamid-1");

    const conv = state.conversations.find((c) => c.contactId === contact.id)!;
    expect(conv.context.orderFlow.cart).toHaveLength(1); // solo el plato principal, nada de acompanantes
    expect(conv.context.orderFlow.step).toBe(OrderFlowStep.ASK_DRINKS);

    const body = state.sentTexts[0]!.body;
    expect(body).toContain("¿Deseas agregar alguna bebida?");
  });

  it("una respuesta que no es 1 ni 2 insiste, sin romper el flujo", async () => {
    const { contact } = seedInSides();
    await sendMessage(contact.phone, "tal vez", "wamid-1");

    expect(state.sentTexts).toHaveLength(1);
    expect(state.sentTexts[0]!.body).toContain("Por favor responde 1");

    const conv = state.conversations.find((c) => c.contactId === contact.id)!;
    expect(conv.context.pendingSideDrink).toEqual({ step: "SIDES", stage: "CONFIRM", optionIds: [] });
    expect(conv.context.orderFlow.step).toBe(OrderFlowStep.ASK_SIDES);
  });
});
