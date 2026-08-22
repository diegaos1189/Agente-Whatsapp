import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BusinessSettingsDTO, CategoryDTO, ProductDTO } from "@pollos/shared";
import type { StructuredCartState } from "../src/modules/conversation/structuredCart.js";
import { initialOrderFlowState } from "../src/modules/conversation/orderFlow.js";

const productServiceMocks = vi.hoisted(() => ({
  listCatalog: vi.fn<() => Promise<CategoryDTO[]>>(),
  getEffectivePrice: vi.fn<(productId: string, basePrice: number) => Promise<number>>(),
}));

vi.mock("../src/modules/products/productService.js", () => ({
  listCatalog: productServiceMocks.listCatalog,
  getEffectivePrice: productServiceMocks.getEffectivePrice,
}));

import {
  buildEmptyCheckoutState,
  computeCheckoutFingerprint,
  invalidateCheckoutState,
  isCheckoutSummaryStale,
  prepareCheckoutSummary,
  validateCheckout,
} from "../src/modules/orders/checkoutService.js";

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

function setCatalog(products: ProductDTO[], effectivePrices?: Record<string, number>) {
  const byCategory = new Map<string, ProductDTO[]>();
  for (const product of products) {
    const bucket = byCategory.get(product.categoryName) ?? [];
    bucket.push(product);
    byCategory.set(product.categoryName, bucket);
  }

  productServiceMocks.listCatalog.mockResolvedValue(
    Array.from(byCategory.entries()).map(([name, categoryProducts], index) => ({
      id: `cat-${index + 1}`,
      name,
      slug: name.toLowerCase().replace(/\s+/g, "-"),
      sortOrder: index + 1,
      products: categoryProducts,
    })),
  );
  productServiceMocks.getEffectivePrice.mockImplementation(async (productId, basePrice) => effectivePrices?.[productId] ?? basePrice);
}

function buildSettings(overrides: Partial<BusinessSettingsDTO> = {}): BusinessSettingsDTO {
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
    outOfHoursMessage: "En este momento estamos cerrados.",
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

describe("checkoutService", () => {
  const pollo = buildProduct({ id: "pollo", name: "Pollo Frito 8 piezas", price: 52000, categoryName: "Pollos" });
  const bbq = buildProduct({ id: "bbq", name: "Salsa BBQ", price: 2000, categoryName: "Salsas" });
  const bebida = buildProduct({ id: "gaseosa", name: "Gaseosa 1.5L", price: 9000, categoryName: "Bebidas" });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("valida un carrito correcto listo para confirmar", async () => {
    setCatalog([pollo]);
    const state = {
      ...initialOrderFlowState,
      step: "CONFIRMING",
      cart: [{ productId: pollo.id, productName: pollo.name, quantity: 1, unitPrice: pollo.price }],
      deliveryType: "PICKUP" as const,
      paymentMethod: "CASH" as const,
    };

    const result = await validateCheckout({
      state,
      activeCart: null,
      settings: buildSettings(),
      at: new Date("2026-08-21T15:00:00-05:00"),
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.pricing?.total).toBe(52000);
  });

  it("rechaza producto agotado antes de confirmar", async () => {
    setCatalog([buildProduct({ ...pollo, isAvailable: false })]);
    const state = {
      ...initialOrderFlowState,
      cart: [{ productId: pollo.id, productName: pollo.name, quantity: 1, unitPrice: pollo.price }],
      deliveryType: "PICKUP" as const,
      paymentMethod: "CASH" as const,
    };
    const result = await validateCheckout({ state, activeCart: null, settings: buildSettings(), at: new Date("2026-08-21T15:00:00-05:00") });

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe("PRODUCT_UNAVAILABLE");
  });

  it("rechaza producto desactivado/no existente", async () => {
    setCatalog([pollo]);
    const state = {
      ...initialOrderFlowState,
      cart: [{ productId: "fantasma", productName: "Fantasma", quantity: 1, unitPrice: 1000 }],
      deliveryType: "PICKUP" as const,
      paymentMethod: "CASH" as const,
    };
    const result = await validateCheckout({ state, activeCart: null, settings: buildSettings(), at: new Date("2026-08-21T15:00:00-05:00") });

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("rechaza modificador invalido", async () => {
    setCatalog([pollo, bebida]);
    const activeCart: StructuredCartState = {
      items: [
        {
          id: "item-1",
          productId: pollo.id,
          productName: pollo.name,
          categoryName: pollo.categoryName,
          unitPrice: pollo.price,
          components: [
            {
              id: "component-1",
              productId: bebida.id,
              productName: bebida.name,
              categoryName: bebida.categoryName,
              quantity: 1,
              unitPrice: bebida.price,
              source: "ADDED",
              status: "ACTIVE",
            },
          ],
          notes: [],
        },
      ],
      lastReferencedItemId: "item-1",
    };
    const state = {
      ...initialOrderFlowState,
      cart: [{ productId: pollo.id, productName: pollo.name, quantity: 1, unitPrice: pollo.price }],
      deliveryType: "PICKUP" as const,
      paymentMethod: "CASH" as const,
    };
    const result = await validateCheckout({ state, activeCart, settings: buildSettings(), at: new Date("2026-08-21T15:00:00-05:00") });

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe("COMPONENT_INCOMPATIBLE");
  });

  it("rechaza checkout con local cerrado", async () => {
    setCatalog([pollo]);
    const state = {
      ...initialOrderFlowState,
      cart: [{ productId: pollo.id, productName: pollo.name, quantity: 1, unitPrice: pollo.price }],
      deliveryType: "PICKUP" as const,
      paymentMethod: "CASH" as const,
    };
    const result = await validateCheckout({ state, activeCart: null, settings: buildSettings(), at: new Date("2026-08-21T01:00:00-05:00") });

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe("STORE_CLOSED");
  });

  it("rechaza delivery fuera de cobertura", async () => {
    setCatalog([pollo]);
    const state = {
      ...initialOrderFlowState,
      cart: [{ productId: pollo.id, productName: pollo.name, quantity: 1, unitPrice: pollo.price }],
      deliveryType: "DELIVERY" as const,
      paymentMethod: "CASH" as const,
      address: "Cra 50 #20-30",
      neighborhood: "Ciudad Jardin",
    };
    const result = await validateCheckout({
      state,
      activeCart: null,
      settings: buildSettings({ deliveryCoverageKeywords: ["Tablazo"] }),
      at: new Date("2026-08-21T15:00:00-05:00"),
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe("DELIVERY_OUT_OF_COVERAGE");
  });

  it("rechaza delivery menor al pedido minimo", async () => {
    setCatalog([pollo]);
    const state = {
      ...initialOrderFlowState,
      cart: [{ productId: pollo.id, productName: pollo.name, quantity: 1, unitPrice: pollo.price }],
      deliveryType: "DELIVERY" as const,
      paymentMethod: "CASH" as const,
      address: "Cra 50 #20-30",
      neighborhood: "Tablazo",
    };
    const result = await validateCheckout({
      state,
      activeCart: null,
      settings: buildSettings({ minimumDeliveryOrder: 60000, deliveryCoverageKeywords: ["Tablazo"] }),
      at: new Date("2026-08-21T15:00:00-05:00"),
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe("DELIVERY_MINIMUM_NOT_MET");
  });

  it("rechaza forma de pago invalida", async () => {
    setCatalog([pollo]);
    const state = {
      ...initialOrderFlowState,
      cart: [{ productId: pollo.id, productName: pollo.name, quantity: 1, unitPrice: pollo.price }],
      deliveryType: "PICKUP" as const,
      paymentMethod: "TRANSFER" as const,
    };
    const result = await validateCheckout({
      state,
      activeCart: null,
      settings: buildSettings({ acceptedPaymentMethods: ["CASH"] }),
      at: new Date("2026-08-21T15:00:00-05:00"),
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe("PAYMENT_METHOD_INVALID");
  });

  it("pide nueva confirmacion si el precio cambia despues del resumen", async () => {
    setCatalog([pollo], { [pollo.id]: 52000 });
    const state = {
      ...initialOrderFlowState,
      step: "CONFIRMING",
      cart: [{ productId: pollo.id, productName: pollo.name, quantity: 1, unitPrice: pollo.price }],
      deliveryType: "PICKUP" as const,
      paymentMethod: "CASH" as const,
    };
    const first = await prepareCheckoutSummary({
      state,
      activeCart: null,
      settings: buildSettings(),
      previousCheckout: buildEmptyCheckoutState(),
      at: new Date("2026-08-21T15:00:00-05:00"),
    });

    setCatalog([pollo], { [pollo.id]: 55000 });
    const second = await prepareCheckoutSummary({
      state,
      activeCart: null,
      settings: buildSettings(),
      previousCheckout: first.checkout,
      at: new Date("2026-08-21T15:05:00-05:00"),
    });

    expect(first.checkout.summary?.total).toBe(52000);
    expect(second.checkout.summary?.total).toBe(55000);
    expect(second.checkout.summary?.confirmationId).not.toBe(first.checkout.summary?.confirmationId);
  });

  it("invalida confirmaciones obsoletas cuando cambia el carrito despues del resumen", async () => {
    setCatalog([pollo, bbq]);
    const state = {
      ...initialOrderFlowState,
      step: "CONFIRMING",
      cart: [{ productId: pollo.id, productName: pollo.name, quantity: 1, unitPrice: pollo.price }],
      deliveryType: "PICKUP" as const,
      paymentMethod: "CASH" as const,
    };
    const prepared = await prepareCheckoutSummary({
      state,
      activeCart: null,
      settings: buildSettings(),
      previousCheckout: buildEmptyCheckoutState(),
      at: new Date("2026-08-21T15:00:00-05:00"),
    });

    const updatedState = {
      ...state,
      cart: [...state.cart, { productId: bbq.id, productName: bbq.name, quantity: 1, unitPrice: bbq.price }],
    };

    expect(isCheckoutSummaryStale(prepared.checkout, updatedState, null)).toBe(true);
    expect(invalidateCheckoutState(prepared.checkout).version).toBeGreaterThan(prepared.checkout.version);
    expect(computeCheckoutFingerprint(state, null)).not.toBe(computeCheckoutFingerprint(updatedState, null));
  });
});
