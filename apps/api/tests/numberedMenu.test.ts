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
  sentImages: [] as Array<{ phone: string; dataUrl: string }>,
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
        {
          id: "prod-medio",
          name: "Pollo Asado Medio",
          price: 27000,
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
    // Jerarquia de 3 niveles: Menu (principal) > Acompanantes (subcategoria) > Gaseosas
    // (sub-subcategoria, con productos reales) — igual al ejemplo pedido por el negocio.
    {
      id: "cat-menu",
      name: "Menu",
      parentCategoryId: null,
      products: [],
    },
    {
      id: "cat-acompanantes",
      name: "Acompanantes",
      parentCategoryId: "cat-menu",
      products: [],
    },
    {
      id: "cat-gaseosas",
      name: "Gaseosas",
      parentCategoryId: "cat-acompanantes",
      products: [
        {
          id: "prod-gaseosa-personal",
          name: "Gaseosa Personal",
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
    sendImageMessage: vi.fn(async (phone: string, dataUrl: string) => {
      state.sentImages.push({ phone, dataUrl });
      return { success: true, providerMessageId: `wamid-img-${state.sentImages.length}` };
    }),
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
  classifyIntent: vi.fn(async ({ message }: any) => ({
    intent: /\bmenu\b|\bmenú\b/i.test(message) ? "VIEW_MENU" : "UNKNOWN",
    confidence: 1,
  })),
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

vi.mock("../src/modules/products/productService.js", () => ({
  listCatalog: vi.fn(async () => state.catalog),
  listActivePromotions: vi.fn(async () => []),
  findBestProductMatch: vi.fn(async () => null),
  findCategoryMatch: vi.fn(async () => null),
  applyPromotionDiscount: vi.fn(),
  isPromoActiveToday: vi.fn(() => true),
  getEffectivePrice: vi.fn(async (_id: string, price: number) => price),
  // Solo hace match EXACTO por nombre (case-insensitive) contra el catalogo de prueba —
  // suficiente para probar que un producto elegido por numero se resuelve sin ambiguedad.
  resolveProductReference: vi.fn(async (query: string) => {
    const allProducts = state.catalog.flatMap((cat: any) =>
      cat.products.map((p: any) => ({ ...p, categoryName: cat.name, categoryId: cat.id })),
    );
    const match = allProducts.find((p: any) => p.name.toLowerCase() === query.trim().toLowerCase());
    if (!match) {
      return { status: "NOT_FOUND", query, normalizedQuery: query, product: null, candidates: [], suggestions: [] };
    }
    const candidate = { product: match, confidence: 1, matchedBy: "EXACT_NAME", available: true, aliases: [] };
    return {
      status: "MATCHED",
      query,
      normalizedQuery: query,
      product: candidate,
      candidates: [candidate],
      suggestions: [],
    };
  }),
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
  n8nClient: { notifyPaymentReminder: vi.fn(), notifyHandoff: vi.fn() },
}));

vi.mock("../src/modules/faq/faqService.js", () => ({
  findFaqMatch: vi.fn(async () => null),
}));

vi.mock("../src/modules/payments/paymentService.js", () => ({
  markPaymentReported: vi.fn(),
}));

vi.mock("../src/modules/localization/localeService.js", () => ({
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

function seedActiveConversation(overrides: Partial<any> = {}) {
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
      orderFlow: { step: OrderFlowStep.IDLE, cart: [], deliveryType: null, paymentMethod: null, address: null, neighborhood: null, reference: null, contactPhone: null },
      pendingMenu: null,
      pendingCategoryIds: null,
      pendingProductIds: null,
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

describe("menu numerado por categoria/producto", () => {
  beforeEach(() => {
    state.contacts = [];
    state.conversations = [];
    state.messages = [];
    state.inboundMessages = [];
    state.leases = [];
    state.sentTexts = [];
    state.sentImages = [];
    state.settings.menuImages = [];
    state.nextContactId = 1;
    state.nextConversationId = 1;
    state.nextMessageId = 1;
    state.nextInboundId = 1n;
  });

  it("'menu' muestra categorias numeradas segun el orden del catalogo", async () => {
    const { contact } = seedActiveConversation();
    await sendMessage(contact.phone, "menu", "wamid-1");

    expect(state.sentTexts).toHaveLength(1);
    const body = state.sentTexts[0]!.body;
    expect(body).toContain("1. Pollo Asado");
    expect(body).toContain("2. Bebidas");

    const conv = state.conversations.find((c) => c.contactId === contact.id)!;
    expect(conv.context.pendingMenu).toBe("CATEGORIES");
    expect(conv.context.pendingCategoryIds).toEqual(["cat-pollo", "cat-bebidas", "cat-menu"]);
  });

  it("si hay fotos de menu configuradas, se mandan antes de la lista de categorias", async () => {
    state.settings.menuImages = ["data:image/jpeg;base64,AAA", "data:image/jpeg;base64,BBB"];
    const { contact } = seedActiveConversation();
    await sendMessage(contact.phone, "menu", "wamid-1");

    expect(state.sentImages).toEqual([
      { phone: contact.phone, dataUrl: "data:image/jpeg;base64,AAA" },
      { phone: contact.phone, dataUrl: "data:image/jpeg;base64,BBB" },
    ]);
    // Las fotos se mandan como mensajes aparte, antes del texto con la lista numerada.
    expect(state.sentTexts).toHaveLength(1);
    expect(state.sentTexts[0]!.body).toContain("1. Pollo Asado");
  });

  it("sin fotos de menu configuradas, no se manda ninguna imagen", async () => {
    const { contact } = seedActiveConversation();
    await sendMessage(contact.phone, "menu", "wamid-1");

    expect(state.sentImages).toHaveLength(0);
  });

  it("responder con el numero de categoria muestra los productos numerados de esa categoria", async () => {
    const { contact } = seedActiveConversation({
      pendingMenu: "CATEGORIES",
      pendingCategoryIds: ["cat-pollo", "cat-bebidas"],
    });
    await sendMessage(contact.phone, "2", "wamid-1");

    expect(state.sentTexts).toHaveLength(1);
    const body = state.sentTexts[0]!.body;
    expect(body).toContain("Bebidas");
    expect(body).toContain("1. Coca-Cola");

    const conv = state.conversations.find((c) => c.contactId === contact.id)!;
    expect(conv.context.pendingMenu).toBe("PRODUCTS");
    expect(conv.context.pendingProductIds).toEqual(["prod-coca"]);
    expect(conv.context.pendingCategoryIds).toBeNull();
  });

  it("responder con el numero de producto arranca el pedido con el producto exacto (sin ambiguedad)", async () => {
    const { contact } = seedActiveConversation({
      pendingMenu: "PRODUCTS",
      pendingProductIds: ["prod-entero", "prod-medio"],
    });
    await sendMessage(contact.phone, "1", "wamid-1");

    const conv = state.conversations.find((c) => c.contactId === contact.id)!;
    // El flujo de pedido avanzo con el producto exacto (Pollo Asado Entero) preguntando
    // cantidad/tamaño, no con ambiguedad ni con el generico "no entendi".
    expect(conv.context.orderFlow.step).toBe(OrderFlowStep.ASK_QUANTITY_OR_SIZE);
    expect(state.sentTexts[0]!.body).toContain("Pollo Asado Entero");
    expect(conv.context.pendingMenu).toBeNull();
  });

  it("un numero fuera de rango insiste con el numero, sin romper ni caer a la IA", async () => {
    const { contact } = seedActiveConversation({
      pendingMenu: "CATEGORIES",
      pendingCategoryIds: ["cat-pollo", "cat-bebidas"],
    });
    await sendMessage(contact.phone, "99", "wamid-1");

    expect(state.sentTexts).toHaveLength(1);
    expect(state.sentTexts[0]!.body).toContain("Por favor responde solo con el número");
    const conv = state.conversations.find((c) => c.contactId === contact.id)!;
    // El menu numerado sigue activo — la misma lista de categorias sirve para reintentar.
    expect(conv.context.pendingMenu).toBe("CATEGORIES");
    expect(conv.context.pendingCategoryIds).toEqual(["cat-pollo", "cat-bebidas"]);
  });

  it("un mensaje con numero mezclado con texto no se interpreta como seleccion de lista e insiste con el numero", async () => {
    const { contact } = seedActiveConversation({
      pendingMenu: "PRODUCTS",
      pendingProductIds: ["prod-entero", "prod-medio"],
    });
    await sendMessage(contact.phone, "quiero 2 pollos enteros", "wamid-1");

    // No debe haber tomado "2" como si fuera el producto 2 de la lista numerada — al no
    // coincidir con el patron estricto de numero limpio, se le pide de nuevo el numero en
    // vez de dejar que la IA adivine texto libre.
    expect(state.sentTexts).toHaveLength(1);
    expect(state.sentTexts[0]!.body).toContain("Por favor responde solo con el número");
    const conv = state.conversations.find((c) => c.contactId === contact.id)!;
    expect(conv.context.pendingMenu).toBe("PRODUCTS");
  });

  it("'cancelar' saca al cliente del menu numerado y cae al flujo normal", async () => {
    const { contact } = seedActiveConversation({
      pendingMenu: "PRODUCTS",
      pendingProductIds: ["prod-entero", "prod-medio"],
    });
    await sendMessage(contact.phone, "cancelar", "wamid-1");

    const conv = state.conversations.find((c) => c.contactId === contact.id)!;
    // "cancelar" no es un numero, pero es una señal explicita de salida — no debe atrapar
    // al cliente insistiendo con el numero, se limpia el menu numerado y sigue el flujo normal.
    expect(conv.context.pendingMenu).toBeNull();
  });

  it("categorias con subcategorias se navegan nivel por nivel (Menu > Acompanantes > Gaseosas)", async () => {
    const { contact } = seedActiveConversation();

    // Paso 1: "menu" solo muestra categorias principales (no las subcategorias anidadas).
    await sendMessage(contact.phone, "menu", "wamid-1");
    let conv = state.conversations.find((c) => c.contactId === contact.id)!;
    let body = state.sentTexts.at(-1)!.body;
    expect(body).toContain("1. Pollo Asado");
    expect(body).toContain("2. Bebidas");
    expect(body).toContain("3. Menu");
    expect(body).not.toContain("Acompanantes");
    expect(body).not.toContain("Gaseosas");
    expect(conv.context.pendingMenu).toBe("CATEGORIES");
    expect(conv.context.pendingCategoryIds).toEqual(["cat-pollo", "cat-bebidas", "cat-menu"]);

    // Paso 2: elegir "3" (Menu, sin productos propios pero con subcategoria) muestra
    // "Acompanantes" numerada, sin saltar a productos.
    await sendMessage(contact.phone, "3", "wamid-2");
    conv = state.conversations.find((c) => c.contactId === contact.id)!;
    body = state.sentTexts.at(-1)!.body;
    expect(body).toContain("1. Acompanantes");
    expect(conv.context.pendingMenu).toBe("CATEGORIES");
    expect(conv.context.pendingCategoryIds).toEqual(["cat-acompanantes"]);

    // Paso 3: elegir "1" (Acompanantes, tampoco tiene productos propios) muestra "Gaseosas".
    await sendMessage(contact.phone, "1", "wamid-3");
    conv = state.conversations.find((c) => c.contactId === contact.id)!;
    body = state.sentTexts.at(-1)!.body;
    expect(body).toContain("1. Gaseosas");
    expect(conv.context.pendingMenu).toBe("CATEGORIES");
    expect(conv.context.pendingCategoryIds).toEqual(["cat-gaseosas"]);

    // Paso 4: elegir "1" (Gaseosas, esta si tiene productos) por fin muestra el producto.
    await sendMessage(contact.phone, "1", "wamid-4");
    conv = state.conversations.find((c) => c.contactId === contact.id)!;
    body = state.sentTexts.at(-1)!.body;
    expect(body).toContain("1. Gaseosa Personal");
    expect(conv.context.pendingMenu).toBe("PRODUCTS");
    expect(conv.context.pendingProductIds).toEqual(["prod-gaseosa-personal"]);

    // Paso 5: elegir "1" finalmente arranca el pedido con el producto exacto.
    await sendMessage(contact.phone, "1", "wamid-5");
    conv = state.conversations.find((c) => c.contactId === contact.id)!;
    expect(conv.context.orderFlow.step).toBe(OrderFlowStep.ASK_QUANTITY_OR_SIZE);
    expect(state.sentTexts.at(-1)!.body).toContain("Gaseosa Personal");
    expect(conv.context.pendingMenu).toBeNull();
  });
});
