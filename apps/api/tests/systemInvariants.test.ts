import { beforeEach, describe, expect, it, vi } from "vitest";
import { createIncomingWhatsAppMessageIdempotencyService } from "../src/modules/whatsapp/incomingWhatsAppMessageIdempotencyService.js";
import { canBotAutoReply } from "../src/modules/conversation/conversationHandoff.js";

const orderServiceMocks = vi.hoisted(() => ({
  estimateDeliveryMinutes: vi.fn(),
  getActiveOrdersForContact: vi.fn(),
  getOrderByCodeForContact: vi.fn(),
  getOrderByIdForContact: vi.fn(),
  getRecentOrdersForContact: vi.fn(),
}));

const productServiceMocks = vi.hoisted(() => ({
  listCatalog: vi.fn(),
  getEffectivePrice: vi.fn(),
}));

vi.mock("../src/modules/orders/orderService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/orders/orderService.js")>();
  return {
    ...actual,
    estimateDeliveryMinutes: orderServiceMocks.estimateDeliveryMinutes,
    getActiveOrdersForContact: orderServiceMocks.getActiveOrdersForContact,
    getOrderByCodeForContact: orderServiceMocks.getOrderByCodeForContact,
    getOrderByIdForContact: orderServiceMocks.getOrderByIdForContact,
    getRecentOrdersForContact: orderServiceMocks.getRecentOrdersForContact,
  };
});

vi.mock("../src/modules/products/productService.js", () => ({
  listCatalog: productServiceMocks.listCatalog,
  getEffectivePrice: productServiceMocks.getEffectivePrice,
}));

import { resolveOrderStatusQuery } from "../src/modules/conversation/orderStatusService.js";
import { initialOrderFlowState } from "../src/modules/conversation/orderFlow.js";
import { validateCheckout } from "../src/modules/orders/checkoutService.js";

function buildSettings(overrides: Record<string, unknown> = {}) {
  return {
    id: "settings",
    restaurantName: "Pollos",
    logoUrl: null,
    phone: "3000000000",
    address: "Centro",
    currency: "COP",
    timezone: "America/Bogota",
    openingHours: { fri: { open: "09:00", close: "23:00" } },
    deliveryFee: 5000,
    acceptsDelivery: true,
    acceptsPickup: true,
    minimumDeliveryOrder: 0,
    deliveryCoverageKeywords: [],
    estimatedPrepMinutes: 30,
    acceptsScheduledOrders: false,
    acceptedPaymentMethods: ["CASH", "TRANSFER", "CARD_ON_DELIVERY"],
    transferAccounts: [],
    outOfHoursMessage: "Cerrado",
    welcomeMessage: "Hola",
    assistantTone: "Amable",
    agentName: "Sara",
    dailyArchiveTime: "23:30",
    whatsappProvider: "mock",
    whatsappPhoneNumberId: "",
    whatsappToken: "",
    whatsappAppSecret: "",
    whatsappVerifyToken: "",
    whatsappApiVersion: "v21.0",
    ...overrides,
  };
}

describe("system invariants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orderServiceMocks.estimateDeliveryMinutes.mockResolvedValue(30);
    orderServiceMocks.getActiveOrdersForContact.mockResolvedValue([]);
    orderServiceMocks.getOrderByCodeForContact.mockResolvedValue(null);
    orderServiceMocks.getOrderByIdForContact.mockResolvedValue(null);
    orderServiceMocks.getRecentOrdersForContact.mockResolvedValue([]);
    productServiceMocks.listCatalog.mockResolvedValue([
      {
        id: "cat-1",
        name: "Pollos",
        slug: "pollos",
        sortOrder: 1,
        products: [{ id: "pollo-8", name: "Pollo 8", price: 52000, isAvailable: true }],
      },
    ]);
    productServiceMocks.getEffectivePrice.mockImplementation(async (_productId: string, basePrice: number) => basePrice);
  });

  it("INVARIANTE 2: un waMessageId se procesa maximo una vez", async () => {
    const store = { claim: vi.fn().mockResolvedValue(true) };
    const service = createIncomingWhatsAppMessageIdempotencyService(store);
    const message = { waMessageId: "wamid-1", fromPhone: "573001", inboundType: "TEXT", providerTimestamp: null };

    await expect(service.claim(message)).resolves.toBe(true);
    await expect(service.claim(message)).resolves.toBe(false);
  });

  it("INVARIANTE 4: una conversacion HUMAN nunca recibe respuesta automatica IA", () => {
    expect(canBotAutoReply({ status: "HUMAN", isHandoff: true, assignedAdminUserId: "admin-1" })).toBe(false);
    expect(canBotAutoReply({ status: "WAITING_HUMAN", isHandoff: true, assignedAdminUserId: null })).toBe(false);
  });

  it("INVARIANTE 6: un pedido no puede confirmarse con carrito vacio", async () => {
    const result = await validateCheckout({
      state: { ...initialOrderFlowState, deliveryType: "PICKUP", paymentMethod: "CASH" },
      activeCart: null,
      settings: buildSettings(),
      at: new Date("2026-08-21T15:00:00-05:00"),
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.code === "EMPTY_CART")).toBe(true);
  });

  it("INVARIANTE 7: un producto no disponible no puede confirmarse", async () => {
    productServiceMocks.listCatalog.mockResolvedValue([
      {
        id: "cat-1",
        name: "Pollos",
        slug: "pollos",
        sortOrder: 1,
        products: [{ id: "pollo-8", name: "Pollo 8", price: 52000, isAvailable: false }],
      },
    ]);

    const result = await validateCheckout({
      state: {
        ...initialOrderFlowState,
        cart: [{ productId: "pollo-8", productName: "Pollo 8", quantity: 1, unitPrice: 52000 }],
        deliveryType: "PICKUP",
        paymentMethod: "CASH",
      },
      activeCart: null,
      settings: buildSettings(),
      at: new Date("2026-08-21T15:00:00-05:00"),
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.code === "PRODUCT_UNAVAILABLE")).toBe(true);
  });

  it("INVARIANTE 8: el total confirmado proviene de pricing/checkout y no del texto del cliente", async () => {
    const result = await validateCheckout({
      state: {
        ...initialOrderFlowState,
        cart: [{ productId: "pollo-8", productName: "Pollo 8", quantity: 2, unitPrice: 52000 }],
        deliveryType: "PICKUP",
        paymentMethod: "CASH",
      },
      activeCart: null,
      settings: buildSettings(),
      at: new Date("2026-08-21T15:00:00-05:00"),
    });

    expect(result.valid).toBe(true);
    expect(result.pricing?.total).toBe(104000);
  });

  it("INVARIANTE 9: el cliente solo puede consultar sus propios pedidos", async () => {
    orderServiceMocks.getOrderByCodeForContact.mockResolvedValue(null);

    const result = await resolveOrderStatusQuery({
      contactId: "contact-a",
      text: "pedido POL-OTRO",
      settings: { estimatedPrepMinutes: 30 },
    });

    expect(result.kind).toBe("NOT_FOUND");
  });
});
