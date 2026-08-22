import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductDTO } from "@pollos/shared";

const orderServiceMocks = vi.hoisted(() => ({
  getLatestOrderForContact: vi.fn(),
  getRecentOrdersForContact: vi.fn(),
  getOrderByCodeForContact: vi.fn(),
}));

const productServiceMocks = vi.hoisted(() => ({
  listAllProductsForResolution: vi.fn(),
  getEffectivePrice: vi.fn(),
}));

vi.mock("../src/modules/orders/orderService.js", () => ({
  getLatestOrderForContact: orderServiceMocks.getLatestOrderForContact,
  getRecentOrdersForContact: orderServiceMocks.getRecentOrdersForContact,
  getOrderByCodeForContact: orderServiceMocks.getOrderByCodeForContact,
}));

vi.mock("../src/modules/products/productService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/products/productService.js")>();
  return {
    ...actual,
    listAllProductsForResolution: productServiceMocks.listAllProductsForResolution,
    getEffectivePrice: productServiceMocks.getEffectivePrice,
  };
});

import {
  formatRecentOrderChoices,
  isRepeatOrderRequest,
  prepareRepeatOrder,
  summarizeRepeatPreparation,
} from "../src/modules/conversation/repeatOrder.js";

function buildProduct(partial: Partial<ProductDTO> & Pick<ProductDTO, "id" | "name" | "price" | "categoryName">): ProductDTO {
  return {
    id: partial.id,
    categoryId: partial.categoryId ?? `${partial.categoryName}-id`,
    categoryName: partial.categoryName,
    name: partial.name,
    description: partial.description ?? null,
    price: partial.price,
    isAvailable: partial.isAvailable ?? true,
    sortOrder: partial.sortOrder ?? 1,
    isDefaultVariant: partial.isDefaultVariant ?? false,
    searchKeywords: partial.searchKeywords ?? null,
    unitCount: partial.unitCount ?? null,
    isCombo: partial.isCombo ?? false,
    comboItems: partial.comboItems ?? [],
    showInMenu: partial.showInMenu ?? true,
  };
}

function buildOrder(overrides: Partial<any> = {}) {
  return {
    id: overrides.id ?? "order-1",
    code: overrides.code ?? "POL-001",
    confirmationId: null,
    contactId: overrides.contactId ?? "contact-1",
    status: "RECEIVED",
    deliveryType: overrides.deliveryType ?? "DELIVERY",
    paymentMethod: overrides.paymentMethod ?? "CASH",
    paymentStatus: "PENDING",
    total: 61000,
    deliveryFee: 5000,
    address: overrides.address ?? "Cra 50 #20-30",
    neighborhood: overrides.neighborhood ?? "Tablazo",
    reference: overrides.reference ?? "Casa azul",
    contactPhone: overrides.contactPhone ?? "3000000000",
    scheduledFor: null,
    flaggedForReview: false,
    flagNote: null,
    createdAt: overrides.createdAt ?? new Date("2026-08-20T18:00:00-05:00"),
    updatedAt: overrides.updatedAt ?? new Date("2026-08-20T18:00:00-05:00"),
    items:
      overrides.items ??
      [
        {
          id: "item-1",
          orderId: "order-1",
          productId: "combo",
          productName: "Combo Familiar",
          quantity: 1,
          unitPrice: 56000,
          notes: "sin ensalada",
          product: null,
        },
      ],
    events: [],
  };
}

describe("repeatOrder", () => {
  const ensalada = buildProduct({ id: "ensalada", name: "Ensalada", price: 6000, categoryName: "Acompanantes" });
  const coca = buildProduct({ id: "coca", name: "Coca-Cola Grande", price: 7000, categoryName: "Bebidas" });
  const papas = buildProduct({ id: "papas", name: "Papas", price: 8000, categoryName: "Acompanantes" });
  const combo = buildProduct({
    id: "combo",
    name: "Combo Familiar",
    price: 62000,
    categoryName: "Combos",
    isCombo: true,
    comboItems: [
      { productId: ensalada.id, productName: ensalada.name, quantity: 1 },
      { productId: coca.id, productName: coca.name, quantity: 1 },
    ],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    orderServiceMocks.getRecentOrdersForContact.mockResolvedValue([buildOrder()]);
    orderServiceMocks.getLatestOrderForContact.mockResolvedValue(buildOrder());
    orderServiceMocks.getOrderByCodeForContact.mockResolvedValue(buildOrder());
    productServiceMocks.listAllProductsForResolution.mockResolvedValue([combo, ensalada, coca, papas]);
    productServiceMocks.getEffectivePrice.mockImplementation(async (_productId: string, basePrice: number) => basePrice);
  });

  it("TEST 1: reconstruye un carrito nuevo desde el ultimo pedido sin crear una orden confirmada", async () => {
    const result = await prepareRepeatOrder({
      contactId: "contact-1",
      text: "repita mi ultimo pedido",
      acceptedPaymentMethods: ["CASH", "TRANSFER", "CARD_ON_DELIVERY"],
    });

    expect(result.status).toBe("READY");
    expect(result.activeCart?.items).toHaveLength(1);
    expect(result.nextState?.step).toBe("CONFIRMING");
  });

  it("TEST 2: usa el precio actual y no el historico", async () => {
    productServiceMocks.getEffectivePrice.mockImplementation(async (productId: string, basePrice: number) =>
      productId === "combo" ? 65000 : basePrice,
    );

    const result = await prepareRepeatOrder({
      contactId: "contact-1",
      text: "repita mi ultimo pedido",
      acceptedPaymentMethods: ["CASH"],
    });

    expect(result.nextState?.cart[0]?.unitPrice).toBe(65000);
  });

  it("TEST 3: no reutiliza promociones historicas vencidas", async () => {
    const discountedHistory = buildOrder({
      items: [{ id: "item-1", orderId: "order-1", productId: "combo", productName: "Combo Familiar", quantity: 1, unitPrice: 50000, notes: null, product: null }],
    });
    orderServiceMocks.getLatestOrderForContact.mockResolvedValue(discountedHistory);
    orderServiceMocks.getRecentOrdersForContact.mockResolvedValue([discountedHistory]);

    const result = await prepareRepeatOrder({
      contactId: "contact-1",
      text: "lo mismo de la otra vez",
      acceptedPaymentMethods: ["CASH"],
    });

    expect(result.nextState?.cart[0]?.unitPrice).toBe(62000);
  });

  it("TEST 4: deja fuera productos historicos eliminados", async () => {
    const missing = buildOrder({
      items: [{ id: "item-1", orderId: "order-1", productId: "fantasma", productName: "Combo Viejo", quantity: 1, unitPrice: 40000, notes: null, product: null }],
    });
    orderServiceMocks.getLatestOrderForContact.mockResolvedValue(missing);
    orderServiceMocks.getRecentOrdersForContact.mockResolvedValue([missing]);

    const result = await prepareRepeatOrder({
      contactId: "contact-1",
      text: "repita mi ultimo pedido",
      acceptedPaymentMethods: ["CASH"],
    });

    expect(result.status).toBe("EMPTY");
    expect(result.issues[0]?.reason).toBe("PRODUCT_NOT_FOUND");
  });

  it("TEST 5: detecta productos actualmente agotados", async () => {
    productServiceMocks.listAllProductsForResolution.mockResolvedValue([buildProduct({ ...combo, isAvailable: false }), ensalada, coca, papas]);

    const result = await prepareRepeatOrder({
      contactId: "contact-1",
      text: "deme el mismo de ayer",
      acceptedPaymentMethods: ["CASH"],
    });

    expect(result.status).toBe("EMPTY");
    expect(result.issues[0]?.reason).toBe("PRODUCT_UNAVAILABLE");
  });

  it("TEST 6: detecta modificadores historicos que ya no son validos", async () => {
    const withModifier = buildOrder({
      items: [{ id: "item-1", orderId: "order-1", productId: "combo", productName: "Combo Familiar", quantity: 1, unitPrice: 62000, notes: "con yuca", product: null }],
    });
    orderServiceMocks.getLatestOrderForContact.mockResolvedValue(withModifier);
    orderServiceMocks.getRecentOrdersForContact.mockResolvedValue([withModifier]);

    const result = await prepareRepeatOrder({
      contactId: "contact-1",
      text: "repita el ultimo",
      acceptedPaymentMethods: ["CASH"],
    });

    expect(result.status).toBe("PARTIAL");
    expect(result.issues.some((issue) => issue.reason === "MODIFIER_INVALID")).toBe(true);
  });

  it("TEST 7: permite reconstruir y quitar un componente en la misma frase", async () => {
    const result = await prepareRepeatOrder({
      contactId: "contact-1",
      text: "lo mismo pero sin ensalada",
      acceptedPaymentMethods: ["CASH"],
    });

    const ensaladaComponent = result.activeCart?.items[0]?.components.find((component) => component.productId === "ensalada");
    expect(ensaladaComponent?.status).toBe("REMOVED");
  });

  it("TEST 8: permite reconstruir y agregar un cambio en la misma frase", async () => {
    const result = await prepareRepeatOrder({
      contactId: "contact-1",
      text: "lo mismo pero con papas",
      acceptedPaymentMethods: ["CASH"],
    });

    expect(result.activeCart?.items[0]?.components.some((component) => component.productId === "papas" && component.source === "ADDED")).toBe(true);
  });

  it("TEST 9: puede cambiar el fulfillment a PICKUP al repetir", async () => {
    const result = await prepareRepeatOrder({
      contactId: "contact-1",
      text: "el mismo pero hoy lo recojo",
      acceptedPaymentMethods: ["CASH"],
    });

    expect(result.nextState?.deliveryType).toBe("PICKUP");
    expect(result.nextState?.address).toBeNull();
  });

  it("TEST 10: puede reutilizar la direccion historica como candidata", async () => {
    const result = await prepareRepeatOrder({
      contactId: "contact-1",
      text: "lo mismo a la misma direccion",
      acceptedPaymentMethods: ["CASH"],
    });

    expect(result.nextState?.deliveryType).toBe("DELIVERY");
    expect(result.nextState?.address).toBe("Cra 50 #20-30");
    expect(result.nextState?.neighborhood).toBe("Tablazo");
  });

  it("TEST 11: rechaza pedir un codigo de otro customer", async () => {
    orderServiceMocks.getOrderByCodeForContact.mockResolvedValue(null);

    const result = await prepareRepeatOrder({
      contactId: "contact-1",
      text: "repitame el pedido #1842",
      acceptedPaymentMethods: ["CASH"],
    });

    expect(result.status).toBe("NOT_FOUND");
    expect(result.issues[0]?.reason).toBe("ORDER_NOT_FOUND");
  });

  it("TEST 12: 'lo de siempre' pide aclaracion si hay pedidos recientes distintos", async () => {
    const recentA = buildOrder({ code: "POL-100", items: [{ id: "a", orderId: "oa", productId: "combo", productName: "Combo Familiar", quantity: 1, unitPrice: 62000, notes: null, product: null }] });
    const recentB = buildOrder({ code: "POL-101", items: [{ id: "b", orderId: "ob", productId: "papas", productName: "Papas", quantity: 1, unitPrice: 8000, notes: null, product: null }] });
    orderServiceMocks.getRecentOrdersForContact.mockResolvedValue([recentA, recentB]);
    orderServiceMocks.getLatestOrderForContact.mockResolvedValue(recentA);

    const result = await prepareRepeatOrder({
      contactId: "contact-1",
      text: "lo de siempre",
      acceptedPaymentMethods: ["CASH"],
    });

    expect(result.status).toBe("AMBIGUOUS");
  });

  it("TEST 13: dos solicitudes iguales producen la misma reconstruccion base", async () => {
    const first = await prepareRepeatOrder({
      contactId: "contact-1",
      text: "repita mi ultimo pedido",
      acceptedPaymentMethods: ["CASH"],
    });
    const second = await prepareRepeatOrder({
      contactId: "contact-1",
      text: "repita mi ultimo pedido",
      acceptedPaymentMethods: ["CASH"],
    });

    expect(first.nextState?.cart).toEqual(second.nextState?.cart);
  });

  it("TEST 14: detecta frases de repeticion de pedido", () => {
    expect(isRepeatOrderRequest("mandeme lo mismo de la vez pasada")).toBe(true);
    expect(isRepeatOrderRequest("quiero ver el menu")).toBe(false);
  });

  it("TEST 15: resume pocos candidatos recientes sin enviar cientos de pedidos al flujo", () => {
    const choices = formatRecentOrderChoices([
      buildOrder({ code: "POL-100" }),
      buildOrder({ code: "POL-101", items: [{ id: "b", orderId: "ob", productId: "papas", productName: "Papas", quantity: 2, unitPrice: 8000, notes: null, product: null }] }),
    ]);

    expect(choices).toHaveLength(2);
    expect(summarizeRepeatPreparation({
      status: "READY",
      sourceOrder: buildOrder(),
      recentOrders: [buildOrder()],
      activeCart: {
        items: [
          {
            id: "item-1",
            productId: combo.id,
            productName: combo.name,
            categoryName: combo.categoryName,
            unitPrice: combo.price,
            components: [],
            notes: [],
          },
        ],
        lastReferencedItemId: "item-1",
      },
      nextState: {
        step: "CONFIRMING",
        cart: [{ productId: combo.id, productName: combo.name, quantity: 1, unitPrice: combo.price }],
        pendingProduct: null,
        sidesAsked: false,
        drinksAsked: false,
        deliveryType: "DELIVERY",
        address: "Cra 50 #20-30",
        neighborhood: "Tablazo",
        reference: null,
        contactPhone: null,
        paymentMethod: "CASH",
      },
      issues: [],
    })[0]).toContain("pedido");
  });
});
