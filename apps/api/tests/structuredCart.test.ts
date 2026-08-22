import { describe, expect, it, vi } from "vitest";
import type { ProductDTO } from "@pollos/shared";
import {
  applyStructuredCartInstruction,
  createStructuredCartFromLegacyLines,
  exportStructuredCartLines,
  parseStructuredCartInstruction,
} from "../src/modules/conversation/structuredCart.js";
import { createContactMessageProcessingCoordinator } from "../src/modules/conversation/contactMessageProcessingCoordinator.js";
import { createIncomingWhatsAppMessageIdempotencyService } from "../src/modules/whatsapp/incomingWhatsAppMessageIdempotencyService.js";

const products: ProductDTO[] = [
  {
    id: "combo8",
    categoryId: "combos",
    categoryName: "Combos",
    name: "Combo de 8",
    description: null,
    price: 68000,
    isAvailable: true,
    sortOrder: 1,
    isDefaultVariant: true,
    searchKeywords: "combo 8 familiar",
    unitCount: 8,
    isCombo: true,
    comboItems: [
      { productId: "papas", productName: "Papas Francesas", quantity: 1 },
      { productId: "ensalada", productName: "Ensalada", quantity: 1 },
      { productId: "gaseosa15", productName: "Gaseosa 1.5L", quantity: 1 },
    ],
    showInMenu: true,
  },
  {
    id: "papas",
    categoryId: "sides",
    categoryName: "Acompanantes",
    name: "Papas Francesas",
    description: null,
    price: 9000,
    isAvailable: true,
    sortOrder: 1,
    isDefaultVariant: false,
    searchKeywords: null,
    unitCount: null,
    isCombo: false,
    comboItems: [],
    showInMenu: true,
  },
  {
    id: "ensalada",
    categoryId: "sides",
    categoryName: "Acompanantes",
    name: "Ensalada",
    description: null,
    price: 6000,
    isAvailable: true,
    sortOrder: 2,
    isDefaultVariant: false,
    searchKeywords: null,
    unitCount: null,
    isCombo: false,
    comboItems: [],
    showInMenu: true,
  },
  {
    id: "gaseosa15",
    categoryId: "drinks",
    categoryName: "Bebidas",
    name: "Gaseosa 1.5L",
    description: null,
    price: 9000,
    isAvailable: true,
    sortOrder: 1,
    isDefaultVariant: true,
    searchKeywords: null,
    unitCount: null,
    isCombo: false,
    comboItems: [],
    showInMenu: true,
  },
  {
    id: "colombiana",
    categoryId: "drinks",
    categoryName: "Bebidas",
    name: "Colombiana",
    description: null,
    price: 5000,
    isAvailable: true,
    sortOrder: 2,
    isDefaultVariant: false,
    searchKeywords: null,
    unitCount: null,
    isCombo: false,
    comboItems: [],
    showInMenu: true,
  },
  {
    id: "bbq",
    categoryId: "extras",
    categoryName: "Salsas",
    name: "BBQ",
    description: null,
    price: 0,
    isAvailable: true,
    sortOrder: 1,
    isDefaultVariant: false,
    searchKeywords: null,
    unitCount: null,
    isCombo: false,
    comboItems: [],
    showInMenu: false,
  },
  {
    id: "picante",
    categoryId: "extras",
    categoryName: "Salsas",
    name: "Picante",
    description: null,
    price: 0,
    isAvailable: true,
    sortOrder: 2,
    isDefaultVariant: false,
    searchKeywords: null,
    unitCount: null,
    isCombo: false,
    comboItems: [],
    showInMenu: false,
  },
];

const priceById = new Map(products.map((product) => [product.id, product.price]));

function createTwoCombosCart() {
  return createStructuredCartFromLegacyLines(
    [{ productId: "combo8", productName: "Combo de 8", quantity: 2, unitPrice: 68000 }],
    products,
    priceById,
  );
}

function runInstruction(text: string, cart = createTwoCombosCart()) {
  const instruction = parseStructuredCartInstruction(text);
  expect(instruction).not.toBeNull();
  return applyStructuredCartInstruction(cart, instruction!, products, priceById);
}

describe("structured cart", () => {
  it("TEST 1: modifica solo el segundo combo al quitar ensalada", () => {
    const result = runInstruction("Al segundo quitele la ensalada.");
    expect(result.ok).toBe(true);
    expect(result.updatedCart.items[0]!.components.some((component) => component.productId === "ensalada" && component.status === "REMOVED")).toBe(false);
    expect(result.updatedCart.items[1]!.components.some((component) => component.productId === "ensalada" && component.status === "REMOVED")).toBe(true);
  });

  it("TEST 2: agrega BBQ solo al primer combo", () => {
    const result = runInstruction("Al primero pongale BBQ.");
    expect(result.ok).toBe(true);
    expect(result.updatedCart.items[0]!.components.some((component) => component.productId === "bbq")).toBe(true);
    expect(result.updatedCart.items[1]!.components.some((component) => component.productId === "bbq")).toBe(false);
  });

  it("TEST 3: duplica correctamente un item con 'otro igual'", () => {
    const cart = createStructuredCartFromLegacyLines(
      [{ productId: "combo8", productName: "Combo de 8", quantity: 1, unitPrice: 68000 }],
      products,
      priceById,
    );
    const result = runInstruction("Deme otro igual.", cart);
    expect(result.ok).toBe(true);
    expect(result.updatedCart.items).toHaveLength(2);
    expect(result.updatedCart.items[1]!.components.map((component) => component.productId)).toEqual(
      result.updatedCart.items[0]!.components.map((component) => component.productId),
    );
  });

  it("TEST 4: remueve el componente correcto al pedir quitar las papas", () => {
    const cart = createStructuredCartFromLegacyLines(
      [{ productId: "combo8", productName: "Combo de 8", quantity: 1, unitPrice: 68000 }],
      products,
      priceById,
    );
    const result = runInstruction("Quite las papas.", cart);
    expect(result.ok).toBe(true);
    expect(result.updatedCart.items[0]!.components.find((component) => component.productId === "papas")?.status).toBe("REMOVED");
  });

  it("TEST 5: reemplaza la gaseosa por Colombiana", () => {
    const cart = createStructuredCartFromLegacyLines(
      [{ productId: "combo8", productName: "Combo de 8", quantity: 1, unitPrice: 68000 }],
      products,
      priceById,
    );
    const result = runInstruction("Cambieme la gaseosa por Colombiana.", cart);
    expect(result.ok).toBe(true);
    expect(result.updatedCart.items[0]!.components.some((component) => component.productId === "colombiana" && component.status === "ACTIVE")).toBe(true);
  });

  it("TEST 6: deja un solo item cuando el cliente dice 'deme uno solo'", () => {
    const result = runInstruction("Mejor deme uno solo.");
    expect(result.ok).toBe(true);
    expect(result.updatedCart.items).toHaveLength(1);
  });

  it("TEST 7: referencia ambigua pide aclaracion", () => {
    const cart = createTwoCombosCart();
    const instruction = parseStructuredCartInstruction("Cambieme la bebida.");
    const result = applyStructuredCartInstruction(cart, instruction!, products, priceById);
    expect(result.ok).toBe(false);
    expect(result.requiresClarification).toBe(true);
  });

  it("TEST 8: dos mensajes rapidos del mismo carrito respetan serializacion", async () => {
    const cartHolder = {
      current: createStructuredCartFromLegacyLines(
        [{ productId: "combo8", productName: "Combo de 8", quantity: 1, unitPrice: 68000 }],
        products,
        priceById,
      ),
    };
    const executionOrder: string[] = [];
    const store = {
      enqueueIncomingMessage: vi.fn(),
      tryAcquireLease: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true),
      renewLease: vi.fn().mockResolvedValue(undefined),
      releaseLease: vi.fn().mockResolvedValue(undefined),
      claimNextQueuedMessage: vi.fn(),
      markQueuedMessageProcessed: vi.fn(),
      markQueuedMessageFailed: vi.fn(),
    };
    const coordinator = createContactMessageProcessingCoordinator(store, {
      sleep: async () => {},
      uuid: (() => {
        let i = 0;
        return () => `lease-${++i}`;
      })(),
    });

    await Promise.all([
      coordinator.runSerializedContactTask("contact-1", "FIRST", async () => {
        executionOrder.push("first:start");
        cartHolder.current = runInstruction("Deme otro igual.", cartHolder.current).updatedCart;
        executionOrder.push(`first:items=${cartHolder.current.items.length}`);
      }),
      coordinator.runSerializedContactTask("contact-1", "SECOND", async () => {
        executionOrder.push(`second:sees=${cartHolder.current.items.length}`);
        cartHolder.current = runInstruction("Al segundo quitele la ensalada.", cartHolder.current).updatedCart;
      }),
    ]);

    expect(executionOrder).toEqual(["first:start", "first:items=2", "second:sees=2"]);
    expect(cartHolder.current.items[1]!.components.some((component) => component.productId === "ensalada" && component.status === "REMOVED")).toBe(true);
  });

  it("TEST 9: no agrega productos/modificadores inexistentes", () => {
    const result = runInstruction("Al primero pongale salsa marciana.");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("menu real");
  });

  it("TEST 10: el reprocesamiento del mismo waMessageId sigue bloqueado", async () => {
    const claimed = new Set<string>();
    const service = createIncomingWhatsAppMessageIdempotencyService({
      async claim(input) {
        if (claimed.has(input.waMessageId)) return false;
        claimed.add(input.waMessageId);
        return true;
      },
    });

    await expect(service.claim({ waMessageId: "wamid-1", fromPhone: "57", inboundType: "TEXT", providerTimestamp: null })).resolves.toBe(true);
    await expect(service.claim({ waMessageId: "wamid-1", fromPhone: "57", inboundType: "TEXT", providerTimestamp: null })).resolves.toBe(false);
  });

  it("simula la conversacion completa y conserva tres items diferenciados", () => {
    let cart = createStructuredCartFromLegacyLines(
      [{ productId: "combo8", productName: "Combo de 8", quantity: 2, unitPrice: 68000 }],
      products,
      priceById,
    );

    cart = runInstruction("Al primero pongale BBQ.", cart).updatedCart;
    cart = runInstruction("El segundo sin ensalada.", cart).updatedCart;
    cart = runInstruction("Deme otro igual al primero.", cart).updatedCart;

    const replaceInstruction = parseStructuredCartInstruction("Al tercero cambieme la bebida.");
    const replaceResult = applyStructuredCartInstruction(cart, replaceInstruction!, products, priceById);
    expect(replaceResult.requiresClarification).toBe(true);

    const lines = exportStructuredCartLines(cart);
    expect(lines).toHaveLength(3);
    expect(lines[0]!.notes).toContain("BBQ");
    expect(lines[1]!.notes).toContain("sin Ensalada");
    expect(lines[2]!.notes).toContain("BBQ");
  });
});
