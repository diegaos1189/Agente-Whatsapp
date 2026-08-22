import { describe, expect, it, vi } from "vitest";
import type { ProductDTO } from "@pollos/shared";

const state = vi.hoisted(() => ({
  recommendationRules: [] as any[],
  products: [] as any[],
}));

vi.mock("../src/db/prisma.js", () => ({
  prisma: {
    productRecommendation: {
      findMany: vi.fn(async ({ where }: any) => {
        if (where?.active === true) return state.recommendationRules.filter((r) => r.active);
        return state.recommendationRules;
      }),
    },
    product: {
      findMany: vi.fn(async ({ select, include }: any) => {
        if (select) return state.products.map((p) => ({ id: p.id, name: p.name }));
        return state.products.map((p) => ({ ...p, category: include?.category ? { name: p.categoryName } : undefined }));
      }),
    },
    promotion: {
      findMany: vi.fn(async () => []),
    },
    conversationAuditEvent: {
      create: vi.fn(async () => ({})),
    },
  },
}));

import {
  selectCartRecommendation,
  getCartRecommendations,
  isUpsellAcceptMessage,
  isUpsellRejectMessage,
  isUpsellSuspendAllMessage,
  isUpsellOptOutMessage,
  createUpsellAuditEvent,
  shouldOfferUpsellThisTurn,
  type RecommendationRuleInput,
} from "../src/modules/conversation/recommendationService.js";
import { prisma } from "../src/db/prisma.js";
import type { StructuredCartState } from "../src/modules/conversation/structuredCart.js";
import { canBotAutoReply } from "../src/modules/conversation/conversationHandoff.js";
import { ConversationStatus, OrderFlowStep } from "@pollos/shared";

function product(overrides: Partial<ProductDTO> & { id: string; categoryId: string; name: string; price: number }): ProductDTO {
  return {
    id: overrides.id,
    categoryId: overrides.categoryId,
    categoryName: overrides.categoryId,
    name: overrides.name,
    description: null,
    price: overrides.price,
    isAvailable: overrides.isAvailable ?? true,
    sortOrder: 0,
    isDefaultVariant: false,
    searchKeywords: null,
    unitCount: null,
    isCombo: false,
    comboItems: [],
    showInMenu: true,
    ...overrides,
  };
}

const pollo = product({ id: "pollo8", categoryId: "pollos", name: "Pollo de 8" });
const gaseosa = product({ id: "gaseosa15", categoryId: "bebidas", name: "Gaseosa 1.5L", price: 6000 });
const papas = product({ id: "papasGrandes", categoryId: "sides", name: "Papas Grandes", price: 8000 });
const alitas = product({ id: "alitas20", categoryId: "alitas", name: "Alitas x20", price: 40000 });
const agotado = product({ id: "postre", categoryId: "postres", name: "Postre", price: 5000, isAvailable: false });

const allProducts = [pollo, gaseosa, papas, alitas, agotado];

function rule(overrides: Partial<RecommendationRuleInput> & { recommendedProductId: string }): RecommendationRuleInput {
  return {
    id: `rule_${overrides.recommendedProductId}_${Math.random()}`,
    sourceProductId: null,
    sourceCategoryId: null,
    recommendationType: "CROSS_SELL",
    priority: 0,
    active: true,
    ...overrides,
  };
}

describe("selectCartRecommendation (seleccion pura, sin IA)", () => {
  it("1. producto en el carrito -> backend recomienda un producto valido emparejado", () => {
    const offer = selectCartRecommendation({
      cartProductIds: [pollo.id],
      rejectedProductIds: [],
      allProducts,
      rules: [rule({ sourceProductId: pollo.id, recommendedProductId: gaseosa.id, recommendationType: "CROSS_SELL" })],
      priceById: new Map([[gaseosa.id, 6000]]),
    });
    expect(offer).toEqual({ productId: gaseosa.id, name: "Gaseosa 1.5L", price: 6000, reason: "CROSS_SELL", ruleId: expect.any(String) });
  });

  it("2. producto recomendado agotado/no disponible -> no se ofrece", () => {
    const offer = selectCartRecommendation({
      cartProductIds: [pollo.id],
      rejectedProductIds: [],
      allProducts,
      rules: [rule({ sourceProductId: pollo.id, recommendedProductId: agotado.id })],
      priceById: new Map(),
    });
    expect(offer).toBeNull();
  });

  it("3. producto ya en el carrito -> nunca se ofrece como duplicado", () => {
    const offer = selectCartRecommendation({
      cartProductIds: [pollo.id, gaseosa.id],
      rejectedProductIds: [],
      allProducts,
      rules: [rule({ sourceProductId: pollo.id, recommendedProductId: gaseosa.id })],
      priceById: new Map(),
    });
    expect(offer).toBeNull();
  });

  it("6. despues de rechazado -> nunca se vuelve a ofrecer el mismo producto en el carrito", () => {
    const offer = selectCartRecommendation({
      cartProductIds: [pollo.id],
      rejectedProductIds: [gaseosa.id],
      allProducts,
      rules: [rule({ sourceProductId: pollo.id, recommendedProductId: gaseosa.id })],
      priceById: new Map(),
    });
    expect(offer).toBeNull();
  });

  it("7. dos candidatos -> respeta el orden de prioridad (producto-nivel primero, luego priority desc)", () => {
    const offer = selectCartRecommendation({
      cartProductIds: [alitas.id],
      rejectedProductIds: [],
      allProducts,
      rules: [
        rule({ sourceProductId: alitas.id, recommendedProductId: gaseosa.id, priority: 1 }),
        rule({ sourceProductId: alitas.id, recommendedProductId: papas.id, priority: 5 }),
      ],
      priceById: new Map([[papas.id, 8000]]),
    });
    expect(offer?.productId).toBe(papas.id);
  });

  it("regla de categoria aplica cuando no hay match de producto directo", () => {
    const offer = selectCartRecommendation({
      cartProductIds: [alitas.id],
      rejectedProductIds: [],
      allProducts,
      rules: [rule({ sourceCategoryId: "alitas", recommendedProductId: papas.id, priority: 2 })],
      priceById: new Map([[papas.id, 8000]]),
    });
    expect(offer?.productId).toBe(papas.id);
  });

  it("8. sin reglas validas -> resultado vacio (no fuerza fallback)", () => {
    const offer = selectCartRecommendation({
      cartProductIds: [pollo.id],
      rejectedProductIds: [],
      allProducts,
      rules: [],
      priceById: new Map(),
    });
    expect(offer).toBeNull();
  });

  it("9. usa el precio vigente (priceById), nunca el precio base guardado si cambio", () => {
    const offer = selectCartRecommendation({
      cartProductIds: [pollo.id],
      rejectedProductIds: [],
      allProducts,
      rules: [rule({ sourceProductId: pollo.id, recommendedProductId: gaseosa.id })],
      priceById: new Map([[gaseosa.id, 4500]]), // precio con promo del dia, distinto al base (6000)
    });
    expect(offer?.price).toBe(4500);
  });

  it("regla de producto tiene prioridad sobre regla de categoria aunque la de categoria tenga mayor priority", () => {
    const offer = selectCartRecommendation({
      cartProductIds: [alitas.id],
      rejectedProductIds: [],
      allProducts,
      rules: [
        rule({ sourceCategoryId: "alitas", recommendedProductId: papas.id, priority: 99 }),
        rule({ sourceProductId: alitas.id, recommendedProductId: gaseosa.id, priority: 0 }),
      ],
      priceById: new Map(),
    });
    expect(offer?.productId).toBe(gaseosa.id);
  });
});

describe("getCartRecommendations (wrapper conectado a prisma)", () => {
  it("carga reglas activas y devuelve a lo sumo una oferta", async () => {
    state.products = allProducts.map((p) => ({
      id: p.id,
      categoryId: p.categoryId,
      categoryName: p.categoryName,
      name: p.name,
      description: p.description,
      price: p.price,
      isAvailable: p.isAvailable,
      sortOrder: p.sortOrder,
      isDefaultVariant: p.isDefaultVariant,
      searchKeywords: p.searchKeywords,
      unitCount: p.unitCount,
      isCombo: p.isCombo,
      comboItems: p.comboItems,
      showInMenu: p.showInMenu,
    }));
    state.recommendationRules = [
      { id: "r1", sourceProductId: pollo.id, sourceCategoryId: null, recommendedProductId: gaseosa.id, recommendationType: "CROSS_SELL", priority: 1, active: true },
      { id: "r2", sourceProductId: null, sourceCategoryId: null, recommendedProductId: papas.id, recommendationType: "ADD_ON", priority: 1, active: false },
    ];
    const cart: StructuredCartState = {
      items: [{ id: "item1", productId: pollo.id, productName: pollo.name, categoryName: pollo.categoryName, unitPrice: pollo.price, components: [], notes: [] }],
      lastReferencedItemId: "item1",
    };
    const offers = await getCartRecommendations({ cart, rejectedProductIds: [] });
    expect(offers.length).toBeLessThanOrEqual(1);
    expect(offers[0]?.productId).toBe(gaseosa.id);
  });

  it("carrito vacio -> sin llamadas innecesarias, resultado vacio", async () => {
    const cart: StructuredCartState = { items: [], lastReferencedItemId: null };
    const offers = await getCartRecommendations({ cart, rejectedProductIds: [] });
    expect(offers).toEqual([]);
  });
});

describe("frases de aceptar/rechazar (estilo paisa, igual patron que cartRecoveryService)", () => {
  it("4. acepta con 'de una'", () => {
    expect(isUpsellAcceptMessage("de una")).toBe(true);
    expect(isUpsellAcceptMessage("hagale pues")).toBe(true);
    expect(isUpsellAcceptMessage("si")).toBe(true);
  });

  it("5. rechaza con 'dejelo asi'", () => {
    expect(isUpsellRejectMessage("dejelo asi")).toBe(true);
    expect(isUpsellRejectMessage("no gracias")).toBe(true);
    expect(isUpsellRejectMessage("no")).toBe(true);
  });

  it("'nada mas' rechaza Y suspende ofertas futuras del carrito", () => {
    expect(isUpsellRejectMessage("nada mas")).toBe(true);
    expect(isUpsellSuspendAllMessage("nada mas")).toBe(true);
  });

  it("frases de opt-out explicito fuera de una oferta pendiente", () => {
    expect(isUpsellOptOutMessage("sin adicionales por favor")).toBe(true);
    expect(isUpsellOptOutMessage("no me ofrezca mas cosas")).toBe(true);
    expect(isUpsellOptOutMessage("dos pollos de 8")).toBe(false);
  });

  it("accept y reject no se confunden entre si", () => {
    expect(isUpsellAcceptMessage("no gracias")).toBe(false);
    expect(isUpsellRejectMessage("de una")).toBe(false);
  });
});

describe("golden conversations - upsell (estilo GOLDEN de golden-conversations.antioquia.test.ts)", () => {
  it("GOLDEN UPSELL 1: 'Deme un pollo de 8' -> backend ofrece gaseosa -> 'de una' -> se agrega", () => {
    const offer = selectCartRecommendation({
      cartProductIds: [pollo.id],
      rejectedProductIds: [],
      allProducts,
      rules: [rule({ sourceProductId: pollo.id, recommendedProductId: gaseosa.id, recommendationType: "CROSS_SELL", priority: 1 })],
      priceById: new Map([[gaseosa.id, 6000]]),
    });
    expect(offer).not.toBeNull();
    expect(offer?.name).toBe("Gaseosa 1.5L");
    // El cliente responde "de una" -> se interpreta como aceptacion real, nunca inventada por la IA.
    expect(isUpsellAcceptMessage("de una")).toBe(true);
  });

  it("GOLDEN UPSELL 2: '20 alitas mitad BBQ mitad picantes' -> se ofrecen papas -> 'dejelo asi' rechaza y no se repite", () => {
    const rules: RecommendationRuleInput[] = [rule({ sourceProductId: alitas.id, recommendedProductId: papas.id, priority: 1 })];
    const firstOffer = selectCartRecommendation({
      cartProductIds: [alitas.id],
      rejectedProductIds: [],
      allProducts,
      rules,
      priceById: new Map([[papas.id, 8000]]),
    });
    expect(firstOffer?.productId).toBe(papas.id);
    expect(isUpsellRejectMessage("dejelo asi")).toBe(true);

    // Tras el rechazo, el mismo carrito ya no vuelve a recibir la misma oferta.
    const secondOffer = selectCartRecommendation({
      cartProductIds: [alitas.id],
      rejectedProductIds: [papas.id],
      allProducts,
      rules,
      priceById: new Map([[papas.id, 8000]]),
    });
    expect(secondOffer).toBeNull();
  });

  it("GOLDEN UPSELL 3: 'solo quiero el pollo, nada mas' suprime cualquier oferta de upsell este carrito", () => {
    expect(isUpsellOptOutMessage("solo quiero el pollo, nada mas")).toBe(true);
    // Aun si backend encontraria una oferta valida, el flag de suspension (ver conversationService.tryOfferUpsell)
    // evita que se llegue siquiera a llamar getCartRecommendations — se prueba aqui la deteccion de la frase.
  });
});

describe("shouldOfferUpsellThisTurn (punto seguro de oferta, no interfiere con checkout)", () => {
  it("13. cliente confirmando checkout (CONFIRMING) -> nunca dispara una oferta tardia", () => {
    expect(
      shouldOfferUpsellThisTurn({ stepBeforeTurn: OrderFlowStep.ASK_DRINKS, nextStep: OrderFlowStep.CONFIRMING, orderCreated: false }),
    ).toBe(false);
  });

  it("dispara justo al resolver acompanantes/bebidas (transicion a ASK_DELIVERY_TYPE)", () => {
    expect(
      shouldOfferUpsellThisTurn({ stepBeforeTurn: OrderFlowStep.ASK_DRINKS, nextStep: OrderFlowStep.ASK_DELIVERY_TYPE, orderCreated: false }),
    ).toBe(true);
  });

  it("no repite la oferta en turnos donde ya estaba en ASK_DELIVERY_TYPE (evita re-disparo)", () => {
    expect(
      shouldOfferUpsellThisTurn({ stepBeforeTurn: OrderFlowStep.ASK_DELIVERY_TYPE, nextStep: OrderFlowStep.ASK_DELIVERY_TYPE, orderCreated: false }),
    ).toBe(false);
  });

  it("nunca dispara si el pedido ya se creo en este turno", () => {
    expect(
      shouldOfferUpsellThisTurn({ stepBeforeTurn: OrderFlowStep.ASK_DRINKS, nextStep: OrderFlowStep.ASK_DELIVERY_TYPE, orderCreated: true }),
    ).toBe(false);
  });
});

describe("12. handoff humano bloquea el upsell (mismo guard que el resto del bot, ver conversationHandoff.ts)", () => {
  it("conversacion en HUMAN -> el bot no puede ofrecer nada automatico", () => {
    expect(canBotAutoReply({ status: ConversationStatus.HUMAN, isHandoff: true, assignedAdminUserId: "admin1" })).toBe(false);
  });

  it("conversacion en WAITING_HUMAN -> tampoco", () => {
    expect(canBotAutoReply({ status: ConversationStatus.WAITING_HUMAN, isHandoff: false, assignedAdminUserId: null })).toBe(false);
  });

  it("conversacion ACTIVE normal -> si puede", () => {
    expect(canBotAutoReply({ status: ConversationStatus.ACTIVE, isHandoff: false, assignedAdminUserId: null })).toBe(true);
  });
});

describe("createUpsellAuditEvent", () => {
  it("registra el evento con el eventType dado", async () => {
    await createUpsellAuditEvent("conv1", "UPSELL_OFFERED", "gaseosa15");
    expect(prisma.conversationAuditEvent.create).toHaveBeenCalledWith({
      data: { conversationId: "conv1", adminUserId: null, eventType: "UPSELL_OFFERED", reason: null, note: "gaseosa15" },
    });
  });
});
