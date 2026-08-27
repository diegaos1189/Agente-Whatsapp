import { describe, expect, it } from "vitest";
import { Intent, OrderFlowStep } from "@pollos/shared";
import { isGenericOrderConfirmation, isPlainAffirmativeReply } from "../src/modules/localization/localeService.js";
import { decideOrderFlow, initialOrderFlowState, type MatchedProductRef } from "../src/modules/conversation/orderFlow.js";

describe("isGenericOrderConfirmation", () => {
  // Mensajes reales de un cliente que el clasificador de IA no reconocia como CONFIRM,
  // dejando al bot re-preguntando "¿Confirma su pedido asi?" en bucle.
  it.each([
    "SI confirmo el pedido asi",
    "Confirmado",
    "SI es correcto mi pedido y lo confirmo asi",
    "Esta correcto mi pedido y lo confirmo",
    "Es correcto mi pedido y lo confirmo asi",
    "si",
    "Sí",
    "Sí, confirmo.",
    "listo, confirmado",
    "ok perfecto",
    "de acuerdo",
    "dale pues",
  ])("reconoce %j como confirmacion", (text) => {
    expect(isGenericOrderConfirmation(text)).toBe(true);
  });

  it.each([
    "no es correcto",
    "no",
    "si pero cambia la gaseosa",
    "confirmo sin la arepa",
    "mejor quita las papitas",
    "si, y agrega una gaseosa",
    "quiero una carne de res",
    "cuanto es el total",
    "espera todavia no",
    "correcto pero falta la ensalada",
    "",
  ])("NO trata %j como confirmacion", (text) => {
    expect(isGenericOrderConfirmation(text)).toBe(false);
  });

  it("rechaza frases largas aunque contengan palabras de confirmacion", () => {
    expect(
      isGenericOrderConfirmation("si mira lo que pasa es que yo habia pedido otra cosa distinta ayer por la tarde y quede confundido"),
    ).toBe(false);
  });
});

describe("isPlainAffirmativeReply", () => {
  it.each(["Si", "sí", "SI", "si claro", "Sí, por favor", "claro que si", "de una"])("reconoce %j", (text) => {
    expect(isPlainAffirmativeReply(text)).toBe(true);
  });

  it.each(["listo", "ok", "no", "si una gaseosa", "gaseosa", "dale"])("NO reconoce %j (ambiguo o nombra producto)", (text) => {
    expect(isPlainAffirmativeReply(text)).toBe(false);
  });
});

describe("'si' pelado en pasos opcionales (acompanantes/bebidas)", () => {
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
  const gaseosa: MatchedProductRef = { id: "d1", name: "Gaseosa", price: 5000, categoryName: "Bebidas" };
  const arepa: MatchedProductRef = { id: "s1", name: "Arepa", price: 3000, categoryName: "Acompanantes" };

  function decideAffirmative(step: OrderFlowStep) {
    return decideOrderFlow({
      state: {
        ...initialOrderFlowState,
        step,
        cart: [{ productId: "p1", productName: "Picada para 2", quantity: 1, unitPrice: 32000 }],
      },
      intent: Intent.CONFIRM,
      entities: emptyEntities,
      matchedProduct: null,
      matchedSides: [],
      unmatchedSideTexts: [],
      businessDeliveryFee: 4000,
      currency: "COP",
      isPlainAffirmative: true,
      availableDrinks: [gaseosa],
      availableSides: [arepa],
    });
  }

  it("ASK_DRINKS + 'si' pregunta CUAL bebida en vez de saltar a domicilio", () => {
    const decision = decideAffirmative(OrderFlowStep.ASK_DRINKS);
    expect(decision.nextState.step).toBe(OrderFlowStep.ASK_DRINKS);
    expect(decision.askNext).toContain("Gaseosa");
    expect(decision.readyToCreateOrder).toBe(false);
  });

  it("ASK_SIDES + 'si' pregunta CUAL acompanante en vez de avanzar", () => {
    const decision = decideAffirmative(OrderFlowStep.ASK_SIDES);
    expect(decision.nextState.step).toBe(OrderFlowStep.ASK_SIDES);
    expect(decision.askNext).toContain("Arepa");
    expect(decision.readyToCreateOrder).toBe(false);
  });

  it("ASK_DRINKS + 'si' nombrando la bebida SI la agrega y avanza", () => {
    const decision = decideOrderFlow({
      state: {
        ...initialOrderFlowState,
        step: OrderFlowStep.ASK_DRINKS,
        cart: [{ productId: "p1", productName: "Picada para 2", quantity: 1, unitPrice: 32000 }],
      },
      intent: Intent.ORDER_PRODUCT,
      entities: emptyEntities,
      matchedProduct: gaseosa,
      matchedSides: [],
      unmatchedSideTexts: [],
      businessDeliveryFee: 4000,
      currency: "COP",
      isPlainAffirmative: false,
      availableDrinks: [gaseosa],
      availableSides: [arepa],
    });
    expect(decision.nextState.step).toBe(OrderFlowStep.ASK_DELIVERY_TYPE);
    expect(decision.nextState.cart.some((line) => line.productName === "Gaseosa")).toBe(true);
  });
});
