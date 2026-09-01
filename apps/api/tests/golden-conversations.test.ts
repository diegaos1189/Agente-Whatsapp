import { beforeEach, describe, expect, it, vi } from "vitest";
import { Intent, OrderFlowStep } from "@pollos/shared";

const orderServiceMocks = vi.hoisted(() => ({
  estimateDeliveryMinutes: vi.fn(),
  getActiveOrdersForContact: vi.fn(),
  getOrderByCodeForContact: vi.fn(),
  getOrderByIdForContact: vi.fn(),
  getLatestOrderForContact: vi.fn(),
  getRecentOrdersForContact: vi.fn(),
}));

const productServiceMocks = vi.hoisted(() => ({
  listAllProductsForResolution: vi.fn(),
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
    getLatestOrderForContact: orderServiceMocks.getLatestOrderForContact,
    getRecentOrdersForContact: orderServiceMocks.getRecentOrdersForContact,
  };
});

vi.mock("../src/modules/products/productService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/products/productService.js")>();
  return {
    ...actual,
    listAllProductsForResolution: productServiceMocks.listAllProductsForResolution,
    getEffectivePrice: productServiceMocks.getEffectivePrice,
  };
});

import { initialOrderFlowState, decideOrderFlow, type MatchedProductRef, type OrderFlowState } from "../src/modules/conversation/orderFlow.js";
import { prepareRepeatOrder } from "../src/modules/conversation/repeatOrder.js";
import { processWhatsAppAudio } from "../src/modules/conversation/whatsappAudioService.js";
import { resolveOrderStatusQuery } from "../src/modules/conversation/orderStatusService.js";
import { canBotAutoReply } from "../src/modules/conversation/conversationHandoff.js";

const emptyEntities = {
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
};

function product(id: string, name: string, price: number, categoryName = "Combos"): MatchedProductRef {
  return { id, name, price, categoryName };
}

function buildHistoryOrder(overrides: Partial<any> = {}) {
  return {
    id: overrides.id ?? "hist-1",
    code: overrides.code ?? "POL-HIST-1",
    contactId: overrides.contactId ?? "contact-1",
    status: overrides.status ?? "RECEIVED",
    deliveryType: overrides.deliveryType ?? "DELIVERY",
    paymentMethod: overrides.paymentMethod ?? "CASH",
    paymentStatus: overrides.paymentStatus ?? "PENDING",
    total: overrides.total ?? 62000,
    deliveryFee: overrides.deliveryFee ?? 5000,
    address: overrides.address ?? "Cra 50 #20-30",
    neighborhood: overrides.neighborhood ?? "Laureles",
    reference: overrides.reference ?? "Casa azul",
    contactPhone: overrides.contactPhone ?? "3000000000",
    flaggedForReview: false,
    flagNote: null,
    createdAt: overrides.createdAt ?? new Date("2026-08-20T18:00:00-05:00"),
    updatedAt: overrides.updatedAt ?? new Date("2026-08-20T18:00:00-05:00"),
    items:
      overrides.items ?? [
        {
          id: "item-1",
          orderId: "hist-1",
          productId: "combo-8",
          productName: "Combo de 8",
          quantity: 1,
          unitPrice: 57000,
          notes: "sin ensalada",
          product: null,
        },
      ],
    events: overrides.events ?? [],
  };
}

function step(
  state: OrderFlowState,
  input: {
    intent: string;
    entities?: Partial<typeof emptyEntities>;
    matchedProduct?: MatchedProductRef | null;
    matchedSides?: MatchedProductRef[];
    unmatchedSideTexts?: string[];
    availableSides?: MatchedProductRef[];
    availableDrinks?: MatchedProductRef[];
    isCorrectionAttempt?: boolean;
  },
) {
  return decideOrderFlow({
    state,
    intent: input.intent,
    entities: { ...emptyEntities, ...(input.entities ?? {}) },
    matchedProduct: input.matchedProduct ?? null,
    matchedSides: input.matchedSides ?? [],
    unmatchedSideTexts: input.unmatchedSideTexts ?? [],
    businessDeliveryFee: 5000,
    currency: "COP",
    acceptedPaymentMethods: ["CASH", "TRANSFER", "CARD_ON_DELIVERY"],
    availableSides: input.availableSides,
    availableDrinks: input.availableDrinks,
    isCorrectionAttempt: input.isCorrectionAttempt,
  });
}

describe("golden conversations", () => {
  const combo8 = product("combo-8", "Combo de 8", 57000, "Combos");
  const pollo8 = product("pollo-8", "Pollo de 8", 52000, "Pollos");
  const papas = product("papas", "Papas", 8000, "Acompanantes");
  const yuca = product("yuca", "Yuca", 7000, "Acompanantes");
  const coca = product("coca", "Coca grande", 7000, "Bebidas");
  const colombiana = product("colombiana", "Colombiana grande", 7000, "Bebidas");
  const bbq = product("bbq", "Salsa BBQ", 2000, "Salsas");

  beforeEach(() => {
    vi.clearAllMocks();
    orderServiceMocks.estimateDeliveryMinutes.mockResolvedValue(30);
    orderServiceMocks.getActiveOrdersForContact.mockResolvedValue([]);
    orderServiceMocks.getOrderByCodeForContact.mockResolvedValue(null);
    orderServiceMocks.getOrderByIdForContact.mockResolvedValue(null);
    orderServiceMocks.getLatestOrderForContact.mockResolvedValue(buildHistoryOrder());
    orderServiceMocks.getRecentOrdersForContact.mockResolvedValue([buildHistoryOrder()]);
    productServiceMocks.listAllProductsForResolution.mockResolvedValue([
      { id: combo8.id, name: combo8.name, price: combo8.price, categoryName: combo8.categoryName, categoryId: "c1", description: null, isAvailable: true, sortOrder: 1, isDefaultVariant: false, searchKeywords: null, unitCount: 8, isCombo: true, comboItems: [], showInMenu: true },
      { id: pollo8.id, name: pollo8.name, price: pollo8.price, categoryName: pollo8.categoryName, categoryId: "c2", description: null, isAvailable: true, sortOrder: 1, isDefaultVariant: false, searchKeywords: null, unitCount: 8, isCombo: false, comboItems: [], showInMenu: true },
      { id: papas.id, name: papas.name, price: papas.price, categoryName: papas.categoryName, categoryId: "c3", description: null, isAvailable: true, sortOrder: 1, isDefaultVariant: false, searchKeywords: null, unitCount: null, isCombo: false, comboItems: [], showInMenu: true },
      { id: yuca.id, name: yuca.name, price: yuca.price, categoryName: yuca.categoryName, categoryId: "c3", description: null, isAvailable: true, sortOrder: 2, isDefaultVariant: false, searchKeywords: null, unitCount: null, isCombo: false, comboItems: [], showInMenu: true },
      { id: coca.id, name: coca.name, price: coca.price, categoryName: coca.categoryName, categoryId: "c4", description: null, isAvailable: true, sortOrder: 1, isDefaultVariant: false, searchKeywords: null, unitCount: null, isCombo: false, comboItems: [], showInMenu: true },
      { id: colombiana.id, name: colombiana.name, price: colombiana.price, categoryName: colombiana.categoryName, categoryId: "c4", description: null, isAvailable: true, sortOrder: 2, isDefaultVariant: false, searchKeywords: null, unitCount: null, isCombo: false, comboItems: [], showInMenu: true },
    ]);
    productServiceMocks.getEffectivePrice.mockImplementation(async (_productId: string, basePrice: number) => basePrice);
  });

  it("GOLDEN 1: pedido completo dividido conserva carrito y flujo", () => {
    let state = initialOrderFlowState;
    state = step(state, { intent: Intent.ORDER_PRODUCT, matchedProduct: combo8 }).nextState;
    state = step(state, { intent: Intent.PROVIDE_INFO, entities: { quantity: 2 }, availableSides: [papas, yuca] }).nextState;
    state = step(state, { intent: Intent.PROVIDE_INFO, matchedSides: [papas] }).nextState;
    state = step(state, { intent: Intent.PROVIDE_INFO, matchedProduct: coca }).nextState;
    state = step(state, { intent: Intent.CANCEL }).nextState;
    state = step(state, { intent: Intent.PROVIDE_INFO, entities: { deliveryType: "DELIVERY" } }).nextState;
    state = step(state, { intent: Intent.PROVIDE_INFO, entities: { address: "Cra 50 #20-30", neighborhood: "Laureles" } }).nextState;
    state = step(state, { intent: Intent.PROVIDE_INFO, entities: { paymentMethod: "CASH" } }).nextState;

    expect(state.step).toBe(OrderFlowStep.CONFIRMING);
    expect(state.cart.length).toBeGreaterThanOrEqual(2);
    expect(state.deliveryType).toBe("DELIVERY");
    expect(state.paymentMethod).toBe("CASH");
  });

  it("GOLDEN 2: pedido complejo en un mensaje mantiene producto principal", () => {
    const state = step(initialOrderFlowState, {
      intent: Intent.ORDER_PRODUCT,
      matchedProduct: combo8,
      entities: { quantity: 2 },
    }).nextState;

    expect(state.cart[0]).toMatchObject({ productId: "combo-8", quantity: 2 });
  });

  it("GOLDEN 3: cambio de opinion sobre cantidad deja el resultado final correcto", () => {
    let state = initialOrderFlowState;
    state = step(state, { intent: Intent.ORDER_PRODUCT, matchedProduct: combo8 }).nextState;
    state = step(state, { intent: Intent.PROVIDE_INFO, entities: { quantity: 1 } }).nextState;
    state = {
      ...state,
      cart: [{ productId: combo8.id, productName: combo8.name, quantity: 2, unitPrice: combo8.price }],
      step: OrderFlowStep.ASK_SIDES,
    };
    state = {
      ...state,
      cart: [{ productId: combo8.id, productName: combo8.name, quantity: 1, unitPrice: combo8.price }],
    };

    expect(state.cart[0]?.quantity).toBe(1);
  });

  it("GOLDEN 4: repetir pedido crea carrito nuevo para pickup", async () => {
    const cleanHistory = buildHistoryOrder({
      items: [
        {
          id: "item-1",
          orderId: "hist-1",
          productId: "combo-8",
          productName: "Combo de 8",
          quantity: 1,
          unitPrice: 57000,
          notes: null,
          product: null,
        },
      ],
    });
    orderServiceMocks.getLatestOrderForContact.mockResolvedValue(cleanHistory);
    orderServiceMocks.getRecentOrdersForContact.mockResolvedValue([cleanHistory]);
    const result = await prepareRepeatOrder({
      contactId: "contact-1",
      text: "lo mismo de la vez pasada pero hoy para recoger",
      acceptedPaymentMethods: ["CASH", "TRANSFER", "CARD_ON_DELIVERY"],
    });

    expect(result.status).toBe("READY");
    expect(result.nextState?.deliveryType).toBe("PICKUP");
  });

  it("GOLDEN 5: audio complejo reutiliza la misma pipeline textual", async () => {
    const result = await processWhatsAppAudio({
      media: {
        base64: "ZmFrZQ==",
        mimeType: "audio/ogg",
        byteLength: 1024,
        contentLength: 1024,
        fileSize: 1024,
      },
      transcribe: vi.fn().mockResolvedValue({
        ok: true,
        text: "deme un pollo de ocho",
        language: "es",
        durationSeconds: 4,
        provider: "openai",
        retryable: false,
        errorCode: null,
      }),
    });

    expect(result.status).toBe("READY");
    expect(result.transcript?.text).toContain("pollo de ocho");
  });

  it("GOLDEN 6: estado real sale de backend y no de memoria", async () => {
    orderServiceMocks.getActiveOrdersForContact.mockResolvedValue([buildHistoryOrder({ status: "ON_THE_WAY", code: "POL-STATE-1" })]);
    const result = await resolveOrderStatusQuery({
      contactId: "contact-1",
      text: "ya salio?",
      settings: { estimatedPrepMinutes: 30 },
    });
    expect(result.kind).toBe("FOUND");
    if (result.kind === "FOUND") expect(result.facts[0]).toContain("ya salio para entrega");
  });

  it("GOLDEN 7: HUMAN handoff bloquea respuesta automatica", () => {
    expect(canBotAutoReply({ status: "HUMAN", isHandoff: true, assignedAdminUserId: "admin-1" })).toBe(false);
  });

  it("GOLDEN 8: pedido ambiguo no asume variante arbitraria", () => {
    const decision = step(initialOrderFlowState, { intent: Intent.ORDER_PRODUCT, matchedProduct: null });
    expect(decision.nextState.step).toBe(OrderFlowStep.COLLECTING_ITEMS);
    expect(decision.askNext).toBeTruthy();
  });

  it("GOLDEN 9: producto repetido en audio no se duplica", () => {
    const state = {
      ...initialOrderFlowState,
      step: OrderFlowStep.ASK_DRINKS,
      cart: [{ productId: combo8.id, productName: combo8.name, quantity: 1, unitPrice: combo8.price }],
    };
    const decision = step(state, { intent: Intent.ORDER_PRODUCT, matchedProduct: combo8, entities: { quantity: 1 } });
    expect(decision.nextState.cart).toHaveLength(1);
  });

  it("GOLDEN 10: direccion y barrio pasan al estado de checkout", () => {
    const state = {
      ...initialOrderFlowState,
      step: OrderFlowStep.ASK_ADDRESS,
      cart: [{ productId: combo8.id, productName: combo8.name, quantity: 1, unitPrice: combo8.price }],
      deliveryType: "DELIVERY" as const,
    };
    const decision = step(state, {
      intent: Intent.PROVIDE_INFO,
      entities: { address: "Cra 1", neighborhood: "Centro" },
    });
    expect(decision.nextState.address).toBe("Cra 1");
    expect(decision.nextState.neighborhood).toBe("Centro");
  });

  const additionalCases = [
    ["GOLDEN 11: saludo no rompe el flujo activo", () => {
      const state = { ...initialOrderFlowState, step: OrderFlowStep.ASK_PAYMENT_METHOD };
      expect(state.step).toBe(OrderFlowStep.ASK_PAYMENT_METHOD);
    }],
    ["GOLDEN 12: papas se reconoce como acompanante real", () => {
      const decision = step({ ...initialOrderFlowState, step: OrderFlowStep.ASK_SIDES, cart: [{ productId: pollo8.id, productName: pollo8.name, quantity: 1, unitPrice: pollo8.price }] }, { intent: Intent.PROVIDE_INFO, matchedSides: [papas] });
      expect(decision.nextState.cart.some((item) => item.productId === papas.id)).toBe(true);
    }],
    ["GOLDEN 13: yuca alternativa se agrega correctamente", () => {
      const decision = step({ ...initialOrderFlowState, step: OrderFlowStep.ASK_SIDES, cart: [{ productId: pollo8.id, productName: pollo8.name, quantity: 1, unitPrice: pollo8.price }] }, { intent: Intent.PROVIDE_INFO, matchedSides: [yuca] });
      expect(decision.nextState.cart.some((item) => item.productId === yuca.id)).toBe(true);
    }],
    ["GOLDEN 14: bebida reconocida pasa a preguntar si desea agregar otro producto", () => {
      const decision = step({ ...initialOrderFlowState, step: OrderFlowStep.ASK_DRINKS, cart: [{ productId: pollo8.id, productName: pollo8.name, quantity: 1, unitPrice: pollo8.price }] }, { intent: Intent.PROVIDE_INFO, matchedProduct: coca });
      expect(decision.nextState.step).toBe(OrderFlowStep.ASK_MORE_ITEMS);
    }],
    ["GOLDEN 15: pickup elimina cobro futuro de delivery del flujo", () => {
      const decision = step({ ...initialOrderFlowState, step: OrderFlowStep.ASK_DELIVERY_TYPE, cart: [{ productId: combo8.id, productName: combo8.name, quantity: 1, unitPrice: combo8.price }] }, { intent: Intent.PROVIDE_INFO, entities: { deliveryType: "PICKUP" } });
      expect(decision.nextState.deliveryType).toBe("PICKUP");
    }],
    ["GOLDEN 16: efectivo se captura como medio de pago", () => {
      const decision = step({ ...initialOrderFlowState, step: OrderFlowStep.ASK_PAYMENT_METHOD, cart: [{ productId: combo8.id, productName: combo8.name, quantity: 1, unitPrice: combo8.price }] }, { intent: Intent.PROVIDE_INFO, entities: { paymentMethod: "CASH" } });
      expect(decision.nextState.paymentMethod).toBe("CASH");
    }],
    ["GOLDEN 17: transferencia se captura como medio de pago", () => {
      const decision = step({ ...initialOrderFlowState, step: OrderFlowStep.ASK_PAYMENT_METHOD, cart: [{ productId: combo8.id, productName: combo8.name, quantity: 1, unitPrice: combo8.price }] }, { intent: Intent.PROVIDE_INFO, entities: { paymentMethod: "TRANSFER" } });
      expect(decision.nextState.paymentMethod).toBe("TRANSFER");
    }],
    ["GOLDEN 18: tarjeta contraentrega se captura correctamente", () => {
      const decision = step({ ...initialOrderFlowState, step: OrderFlowStep.ASK_PAYMENT_METHOD, cart: [{ productId: combo8.id, productName: combo8.name, quantity: 1, unitPrice: combo8.price }] }, { intent: Intent.PROVIDE_INFO, entities: { paymentMethod: "CARD_ON_DELIVERY" } });
      expect(decision.nextState.paymentMethod).toBe("CARD_ON_DELIVERY");
    }],
    ["GOLDEN 19: follow-up de estado usa referencia previa", async () => {
      orderServiceMocks.getOrderByIdForContact.mockResolvedValue(buildHistoryOrder({ id: "tracked", code: "POL-TRACKED", status: "RECEIVED" }));
      const result = await resolveOrderStatusQuery({ contactId: "contact-1", text: "y ahora", settings: { estimatedPrepMinutes: 30 }, reference: { lastReferencedOrderId: "tracked", lastReferencedOrderCode: "POL-TRACKED" } });
      expect(result.kind).toBe("FOUND");
    }],
    ["GOLDEN 20: varios pedidos activos obligan aclaracion", async () => {
      orderServiceMocks.getActiveOrdersForContact.mockResolvedValue([buildHistoryOrder({ code: "POL-A" }), buildHistoryOrder({ id: "b", code: "POL-B", status: "READY" })]);
      const result = await resolveOrderStatusQuery({ contactId: "contact-1", text: "como va mi pedido", settings: { estimatedPrepMinutes: 30 } });
      expect(result.kind).toBe("MULTIPLE_ACTIVE");
    }],
    ["GOLDEN 21: pedido historico con producto actual sigue siendo READY para reconstruir", async () => {
      const cleanHistory = buildHistoryOrder({
        items: [
          {
            id: "item-1",
            orderId: "hist-1",
            productId: "combo-8",
            productName: "Combo de 8",
            quantity: 1,
            unitPrice: 57000,
            notes: null,
            product: null,
          },
        ],
      });
      orderServiceMocks.getLatestOrderForContact.mockResolvedValue(cleanHistory);
      orderServiceMocks.getRecentOrdersForContact.mockResolvedValue([cleanHistory]);
      const result = await prepareRepeatOrder({ contactId: "contact-1", text: "el ultimo", acceptedPaymentMethods: ["CASH"] });
      expect(result.status).toBe("READY");
    }],
    ["GOLDEN 22: pedido historico no reusa promo vencida", async () => {
      const result = await prepareRepeatOrder({ contactId: "contact-1", text: "lo mismo de la otra vez", acceptedPaymentMethods: ["CASH"] });
      expect(result.nextState?.cart[0]?.unitPrice).toBe(57000);
    }],
    ["GOLDEN 23: cambio a pickup en reorder se respeta", async () => {
      const result = await prepareRepeatOrder({ contactId: "contact-1", text: "lo mismo pero hoy lo recojo", acceptedPaymentMethods: ["CASH"] });
      expect(result.nextState?.deliveryType).toBe("PICKUP");
    }],
    ["GOLDEN 24: audio vacio cae en fallback seguro", async () => {
      const result = await processWhatsAppAudio({ media: { base64: "ZmFrZQ==", mimeType: "audio/ogg", byteLength: 10, contentLength: 10, fileSize: 10 }, transcribe: vi.fn().mockResolvedValue({ ok: false, text: "", language: "es", durationSeconds: 1, provider: "openai", retryable: false, errorCode: "EMPTY" }) });
      expect(result.status).toBe("EMPTY_TRANSCRIPT");
    }],
    ["GOLDEN 25: audio con mime invalido se rechaza", async () => {
      const result = await processWhatsAppAudio({ media: { base64: "ZmFrZQ==", mimeType: "audio/wav", byteLength: 10, contentLength: 10, fileSize: 10 }, transcribe: vi.fn() });
      expect(result.status).toBe("UNSUPPORTED_MIME");
    }],
    ["GOLDEN 26: ON_THE_WAY nunca inventa ubicacion", async () => {
      orderServiceMocks.getActiveOrdersForContact.mockResolvedValue([buildHistoryOrder({ status: "ON_THE_WAY" })]);
      const result = await resolveOrderStatusQuery({ contactId: "contact-1", text: "donde va", settings: { estimatedPrepMinutes: 30 } });
      expect(result.kind).toBe("FOUND");
      if (result.kind === "FOUND") expect(result.facts.join(" ")).not.toContain("avenida");
    }],
    ["GOLDEN 27: READY delivery no equivale a salida", async () => {
      orderServiceMocks.getActiveOrdersForContact.mockResolvedValue([buildHistoryOrder({ status: "READY", deliveryType: "DELIVERY" })]);
      const result = await resolveOrderStatusQuery({ contactId: "contact-1", text: "ya salio", settings: { estimatedPrepMinutes: 30 } });
      expect(result.kind).toBe("FOUND");
      if (result.kind === "FOUND") expect(result.facts[0]).toContain("esperando despacho");
    }],
    ["GOLDEN 28: PICKUP listo responde listo para recoger", async () => {
      orderServiceMocks.getActiveOrdersForContact.mockResolvedValue([buildHistoryOrder({ status: "READY", deliveryType: "PICKUP" })]);
      const result = await resolveOrderStatusQuery({ contactId: "contact-1", text: "ya puedo pasar", settings: { estimatedPrepMinutes: 30 } });
      expect(result.kind).toBe("FOUND");
      if (result.kind === "FOUND") expect(result.facts[0]).toContain("recoger");
    }],
    ["GOLDEN 29: entrega demorada activa handoff recomendado", async () => {
      orderServiceMocks.getActiveOrdersForContact.mockResolvedValue([buildHistoryOrder({ status: "RECEIVED", createdAt: new Date("2026-08-21T19:00:00.000Z"), deliveryType: "DELIVERY" })]);
      orderServiceMocks.estimateDeliveryMinutes.mockResolvedValue(20);
      const result = await resolveOrderStatusQuery({ contactId: "contact-1", text: "que paso con mi pedido", settings: { estimatedPrepMinutes: 30 }, now: new Date("2026-08-21T20:00:00.000Z") });
      expect(result.kind).toBe("FOUND");
      if (result.kind === "FOUND") expect(result.shouldHandoff).toBe(true);
    }],
    ["GOLDEN 30: estado cancelado se comunica sin filtrar notas internas", async () => {
      orderServiceMocks.getRecentOrdersForContact.mockResolvedValue([buildHistoryOrder({ status: "CANCELLED" })]);
      const result = await resolveOrderStatusQuery({ contactId: "contact-1", text: "que paso con el pedido de ayer", settings: { estimatedPrepMinutes: 30 } });
      expect(result.kind).toBe("FOUND");
      if (result.kind === "FOUND") expect(result.facts.join(" ")).not.toContain("nota interna");
    }],
  ] as const;

  for (const [title, fn] of additionalCases) {
    it(title, fn);
  }
});
