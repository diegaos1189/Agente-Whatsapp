import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CategoryDTO, ProductDTO } from "@pollos/shared";
import type { StructuredCartState } from "../src/modules/conversation/structuredCart.js";

const productServiceMocks = vi.hoisted(() => ({
  listCatalog: vi.fn<() => Promise<CategoryDTO[]>>(),
  getEffectivePrice: vi.fn<(restaurantId: string, productId: string, basePrice: number) => Promise<number>>(),
}));

vi.mock("../src/modules/products/productService.js", () => ({
  listCatalog: productServiceMocks.listCatalog,
  getEffectivePrice: productServiceMocks.getEffectivePrice,
}));

import { calculateCartPricing, formatCartPricingFacts } from "../src/modules/orders/pricingService.js";

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

  productServiceMocks.getEffectivePrice.mockImplementation(async (_restaurantId, productId, basePrice) => effectivePrices?.[productId] ?? basePrice);
}

describe("pricingService", () => {
  const pollo = buildProduct({ id: "pollo", name: "Pollo Frito 8 piezas", price: 52000, categoryName: "Pollos" });
  const gaseosa = buildProduct({ id: "gaseosa", name: "Gaseosa 1.5L", price: 9000, categoryName: "Bebidas" });
  const papas = buildProduct({ id: "papas", name: "Papas Francesas", price: 8000, categoryName: "Acompanantes" });
  const bbq = buildProduct({ id: "bbq", name: "Salsa BBQ", price: 2000, categoryName: "Salsas" });
  const arepa = buildProduct({ id: "arepa", name: "Arepa", price: 3000, categoryName: "Acompanantes" });
  const combo = buildProduct({
    id: "combo",
    name: "Combo Familiar",
    price: 68000,
    categoryName: "Combos",
    isCombo: true,
    comboItems: [
      { productId: gaseosa.id, productName: gaseosa.name, quantity: 1 },
      { productId: papas.id, productName: papas.name, quantity: 1 },
    ],
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calcula total simple desde cart legacy", async () => {
    setCatalog([pollo]);

    const pricing = await calculateCartPricing({
      cart: [{ productId: pollo.id, productName: pollo.name, quantity: 1, unitPrice: pollo.price }],
      deliveryType: "PICKUP",
      currency: "COP",
      businessDeliveryFee: 5000,
    });

    expect(pricing.valid).toBe(true);
    expect(pricing.subtotal).toBe(52000);
    expect(pricing.total).toBe(52000);
  });

  it("respeta cantidades legacy y suma multiples unidades", async () => {
    setCatalog([pollo]);

    const pricing = await calculateCartPricing({
      cart: [{ productId: pollo.id, productName: pollo.name, quantity: 2, unitPrice: pollo.price }],
      deliveryType: "PICKUP",
      currency: "COP",
      businessDeliveryFee: 5000,
    });

    expect(pricing.items).toHaveLength(2);
    expect(pricing.subtotal).toBe(104000);
    expect(pricing.total).toBe(104000);
  });

  it("agrega costo de modificador compatible en carrito estructurado", async () => {
    setCatalog([pollo, bbq]);
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
              productId: bbq.id,
              productName: bbq.name,
              categoryName: bbq.categoryName,
              quantity: 1,
              unitPrice: bbq.price,
              source: "ADDED",
              status: "ACTIVE",
            },
          ],
          notes: [],
        },
      ],
      lastReferencedItemId: "item-1",
    };

    const pricing = await calculateCartPricing({
      cart: [],
      activeCart,
      deliveryType: "PICKUP",
      currency: "COP",
      businessDeliveryFee: 5000,
    });

    expect(pricing.valid).toBe(true);
    expect(pricing.subtotal).toBe(54000);
    expect(pricing.items[0]?.modifiers[0]).toMatchObject({ name: "Salsa BBQ", total: 2000 });
  });

  it("acumula dos modificadores y conserva notas resumidas", async () => {
    setCatalog([combo, gaseosa, papas, bbq, arepa]);
    const activeCart: StructuredCartState = {
      items: [
        {
          id: "item-1",
          productId: combo.id,
          productName: combo.name,
          categoryName: combo.categoryName,
          unitPrice: combo.price,
          components: [
            {
              id: "included-gaseosa",
              productId: gaseosa.id,
              productName: gaseosa.name,
              categoryName: gaseosa.categoryName,
              quantity: 1,
              unitPrice: gaseosa.price,
              source: "INCLUDED",
              status: "ACTIVE",
            },
            {
              id: "included-papas",
              productId: papas.id,
              productName: papas.name,
              categoryName: papas.categoryName,
              quantity: 1,
              unitPrice: papas.price,
              source: "INCLUDED",
              status: "REMOVED",
            },
            {
              id: "added-arepa",
              productId: arepa.id,
              productName: arepa.name,
              categoryName: arepa.categoryName,
              quantity: 1,
              unitPrice: arepa.price,
              source: "ADDED",
              status: "ACTIVE",
            },
            {
              id: "added-bbq",
              productId: bbq.id,
              productName: bbq.name,
              categoryName: bbq.categoryName,
              quantity: 1,
              unitPrice: bbq.price,
              source: "ADDED",
              status: "ACTIVE",
            },
          ],
          notes: ["sin cebolla"],
        },
      ],
      lastReferencedItemId: "item-1",
    };

    const pricing = await calculateCartPricing({
      cart: [],
      activeCart,
      deliveryType: "PICKUP",
      currency: "COP",
      businessDeliveryFee: 5000,
    });

    expect(pricing.valid).toBe(true);
    expect(pricing.subtotal).toBe(65000);
    expect(pricing.items[0]?.notes).toContain("sin Papas Francesas");
    expect(pricing.items[0]?.notes).toContain("Arepa");
    expect(pricing.items[0]?.notes).toContain("sin cebolla");
  });

  it("aplica descuento porcentual desde getEffectivePrice", async () => {
    setCatalog([pollo], { [pollo.id]: 46800 });

    const pricing = await calculateCartPricing({
      cart: [{ productId: pollo.id, productName: pollo.name, quantity: 1, unitPrice: pollo.price }],
      deliveryType: "PICKUP",
      currency: "COP",
      businessDeliveryFee: 5000,
    });

    expect(pricing.discount).toBe(5200);
    expect(pricing.total).toBe(46800);
  });

  it("aplica descuento fijo y delivery en el total final", async () => {
    setCatalog([pollo], { [pollo.id]: 47000 });

    const pricing = await calculateCartPricing({
      cart: [{ productId: pollo.id, productName: pollo.name, quantity: 1, unitPrice: pollo.price }],
      deliveryType: "DELIVERY",
      currency: "COP",
      businessDeliveryFee: 6000,
    });

    expect(pricing.discount).toBe(5000);
    expect(pricing.deliveryFee).toBe(6000);
    expect(pricing.total).toBe(53000);
  });

  it("detecta cambio de precio antes de confirmar y devuelve lineas repriced", async () => {
    setCatalog([pollo], { [pollo.id]: 55000 });

    const pricing = await calculateCartPricing({
      cart: [{ productId: pollo.id, productName: pollo.name, quantity: 1, unitPrice: 52000 }],
      deliveryType: "PICKUP",
      currency: "COP",
      businessDeliveryFee: 5000,
    });

    expect(pricing.priceChanged).toBe(true);
    expect(pricing.changedMessages[0]).toContain("cambio");
    expect(pricing.repricedCartLines[0]?.unitPrice).toBe(55000);
  });

  it("marca invalido un producto inexistente o fuera del catalogo actual", async () => {
    setCatalog([pollo]);

    const pricing = await calculateCartPricing({
      cart: [{ productId: "desconocido", productName: "Producto Fantasma", quantity: 1, unitPrice: 1000 }],
      deliveryType: "PICKUP",
      currency: "COP",
      businessDeliveryFee: 5000,
    });

    expect(pricing.valid).toBe(false);
    expect(pricing.issues[0]?.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("rechaza modificador incompatible con el producto", async () => {
    setCatalog([pollo, gaseosa]);
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
              productId: gaseosa.id,
              productName: gaseosa.name,
              categoryName: gaseosa.categoryName,
              quantity: 1,
              unitPrice: gaseosa.price,
              source: "ADDED",
              status: "ACTIVE",
            },
          ],
          notes: [],
        },
      ],
      lastReferencedItemId: "item-1",
    };

    const pricing = await calculateCartPricing({
      cart: [],
      activeCart,
      deliveryType: "PICKUP",
      currency: "COP",
      businessDeliveryFee: 5000,
    });

    expect(pricing.valid).toBe(false);
    expect(pricing.issues[0]?.code).toBe("COMPONENT_INCOMPATIBLE");
  });

  it("marca invalido componentes agotados y deja tax en cero", async () => {
    setCatalog([pollo, buildProduct({ ...bbq, isAvailable: false })]);
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
              productId: bbq.id,
              productName: bbq.name,
              categoryName: bbq.categoryName,
              quantity: 1,
              unitPrice: bbq.price,
              source: "ADDED",
              status: "ACTIVE",
            },
          ],
          notes: [],
        },
      ],
      lastReferencedItemId: "item-1",
    };

    const pricing = await calculateCartPricing({
      cart: [],
      activeCart,
      deliveryType: "PICKUP",
      currency: "COP",
      businessDeliveryFee: 5000,
    });

    expect(pricing.valid).toBe(false);
    expect(pricing.tax).toBe(0);
    expect(pricing.issues[0]?.code).toBe("COMPONENT_UNAVAILABLE");
  });

  it("formatea hechos monetarios listos para la IA sin recalcular nada", async () => {
    setCatalog([pollo], { [pollo.id]: 47000 });

    const pricing = await calculateCartPricing({
      cart: [{ productId: pollo.id, productName: pollo.name, quantity: 1, unitPrice: pollo.price }],
      deliveryType: "DELIVERY",
      currency: "COP",
      businessDeliveryFee: 6000,
    });
    const facts = formatCartPricingFacts(pricing);

    expect(facts).toContain("Subtotal: 47.000 COP");
    expect(facts).toContain("Descuento aplicado: -5.000 COP");
    expect(facts).toContain("Domicilio: 6.000 COP");
    expect(facts).toContain("Total: 53.000 COP");
  });
});
