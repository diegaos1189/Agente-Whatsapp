import { describe, expect, it } from "vitest";
import { Intent, OrderFlowStep } from "@pollos/shared";
import {
  decideOrderFlow,
  initialOrderFlowState,
  computeOrderTotal,
  isExplicitCancelRequest,
} from "../src/modules/conversation/orderFlow.js";
import type { ExtractedEntities } from "../src/modules/ai/entityExtractor.js";

const emptyEntities: ExtractedEntities = {
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

describe("decideOrderFlow", () => {
  it("arranca la toma de pedido cuando detecta intencion de compra con producto reconocido", () => {
    const decision = decideOrderFlow({
      state: initialOrderFlowState,
      intent: Intent.ORDER_PRODUCT,
      entities: emptyEntities,
      matchedProduct: { id: "p1", name: "Pollo Frito 8 piezas", price: 52000 },
      matchedSides: [],
      unmatchedSideTexts: [],
      businessDeliveryFee: 5000,
      currency: "COP",
    });

    expect(decision.nextState.step).toBe(OrderFlowStep.ASK_QUANTITY_OR_SIZE);
    expect(decision.nextState.pendingProduct?.id).toBe("p1");
    expect(decision.askNext).toContain("Pollo Frito 8 piezas");
  });

  it("pide aclarar el producto si no hay intencion de compra en IDLE", () => {
    const decision = decideOrderFlow({
      state: initialOrderFlowState,
      intent: Intent.VIEW_MENU,
      entities: emptyEntities,
      matchedProduct: null,
      matchedSides: [],
      unmatchedSideTexts: [],
      businessDeliveryFee: 5000,
      currency: "COP",
    });

    expect(decision.nextState.step).toBe(OrderFlowStep.IDLE);
    expect(decision.askNext).toBeNull();
  });

  it("agrega el producto al carrito con la cantidad indicada y pasa a preguntar acompanantes", () => {
    const stateWithPending = {
      ...initialOrderFlowState,
      step: OrderFlowStep.ASK_QUANTITY_OR_SIZE,
      pendingProduct: { id: "p1", name: "Pollo Frito 8 piezas", price: 52000 },
    };

    const decision = decideOrderFlow({
      state: stateWithPending,
      intent: Intent.PROVIDE_INFO,
      entities: { ...emptyEntities, quantity: 2 },
      matchedProduct: null,
      matchedSides: [],
      unmatchedSideTexts: [],
      businessDeliveryFee: 5000,
      currency: "COP",
    });

    expect(decision.nextState.step).toBe(OrderFlowStep.ASK_SIDES);
    expect(decision.nextState.cart).toHaveLength(1);
    expect(decision.nextState.cart[0]).toMatchObject({ productId: "p1", quantity: 2, unitPrice: 52000 });
  });

  it("al preguntar por acompanantes, ofrece los disponibles con precio (bug real: cliente respondia 'Si' sin especificar y el bot no listaba nada)", () => {
    const stateWithPending = {
      ...initialOrderFlowState,
      step: OrderFlowStep.ASK_QUANTITY_OR_SIZE,
      pendingProduct: { id: "p1", name: "Pollo Frito 8 piezas", price: 52000 },
    };

    const decision = decideOrderFlow({
      state: stateWithPending,
      intent: Intent.PROVIDE_INFO,
      entities: { ...emptyEntities, quantity: 2 },
      matchedProduct: null,
      matchedSides: [],
      unmatchedSideTexts: [],
      businessDeliveryFee: 5000,
      currency: "COP",
      availableSides: [{ id: "papas", name: "Papas Francesas", price: 9000, categoryName: "Acompanantes" }],
    });

    expect(decision.nextState.step).toBe(OrderFlowStep.ASK_SIDES);
    expect(decision.askNext).toContain("Papas Francesas");
    expect(decision.askNext).toContain("9,000");
  });

  it("despues de acompanantes pregunta por bebidas antes de domicilio, ofreciendo las disponibles", () => {
    const state = {
      ...initialOrderFlowState,
      step: OrderFlowStep.ASK_SIDES,
      cart: [{ productId: "p1", productName: "Pollo Frito 8 piezas", quantity: 1, unitPrice: 52000 }],
    };

    const decision = decideOrderFlow({
      state,
      intent: Intent.PROVIDE_INFO,
      entities: { ...emptyEntities, sides: ["papas"] },
      matchedProduct: null,
      matchedSides: [{ id: "papas", name: "Papas Francesas", price: 9000, categoryName: "Acompanantes" }],
      unmatchedSideTexts: [],
      businessDeliveryFee: 5000,
      currency: "COP",
      availableDrinks: [{ id: "gaseosa", name: "Gaseosa 1.5L", price: 9000, categoryName: "Bebidas" }],
    });

    expect(decision.nextState.step).toBe(OrderFlowStep.ASK_DRINKS);
    expect(decision.askNext).toContain("Gaseosa 1.5L");
  });

  it("si el cliente ya pidio una bebida junto con los acompanantes, salta directo a domicilio", () => {
    const state = {
      ...initialOrderFlowState,
      step: OrderFlowStep.ASK_SIDES,
      cart: [{ productId: "p1", productName: "Pollo Frito 8 piezas", quantity: 1, unitPrice: 52000 }],
    };

    const decision = decideOrderFlow({
      state,
      intent: Intent.PROVIDE_INFO,
      entities: { ...emptyEntities, sides: ["gaseosa"] },
      matchedProduct: null,
      matchedSides: [{ id: "gaseosa", name: "Gaseosa 1.5L", price: 9000, categoryName: "Bebidas" }],
      unmatchedSideTexts: [],
      businessDeliveryFee: 5000,
      currency: "COP",
    });

    expect(decision.nextState.step).toBe(OrderFlowStep.ASK_DELIVERY_TYPE);
  });

  it("responde en ASK_DRINKS con la bebida elegida y pasa a domicilio", () => {
    const state = {
      ...initialOrderFlowState,
      step: OrderFlowStep.ASK_DRINKS,
      cart: [{ productId: "p1", productName: "Pollo Frito 8 piezas", quantity: 1, unitPrice: 52000 }],
    };

    const decision = decideOrderFlow({
      state,
      intent: Intent.PROVIDE_INFO,
      entities: emptyEntities,
      matchedProduct: { id: "gaseosa", name: "Gaseosa 1.5L", price: 9000, categoryName: "Bebidas" },
      matchedSides: [],
      unmatchedSideTexts: [],
      businessDeliveryFee: 5000,
      currency: "COP",
    });

    expect(decision.nextState.step).toBe(OrderFlowStep.ASK_DELIVERY_TYPE);
    expect(decision.nextState.cart.some((i) => i.productId === "gaseosa")).toBe(true);
  });

  it("bug real: repetir un producto ya en el carrito en ASK_DRINKS (o cualquier paso) no lo duplica, aunque venga con cantidad explicita", () => {
    // Reproduce el bug de audios repetidos: el cliente vuelve a mencionar "Combo Familiar"
    // (ya en el carrito) mientras se le pregunta por bebidas — antes esto se agregaba de
    // nuevo sin validar que fuera una bebida, inflando el total (116,000 termino en 252,000).
    const state = {
      ...initialOrderFlowState,
      step: OrderFlowStep.ASK_DRINKS,
      cart: [
        { productId: "pollo", productName: "Pollo Asado Entero", quantity: 1, unitPrice: 48000 },
        { productId: "combo", productName: "Combo Familiar", quantity: 1, unitPrice: 68000 },
      ],
    };

    const decision = decideOrderFlow({
      state,
      intent: Intent.ORDER_PRODUCT,
      entities: { ...emptyEntities, quantity: 1 },
      matchedProduct: { id: "combo", name: "Combo Familiar", price: 68000, categoryName: "Combos" },
      matchedSides: [],
      unmatchedSideTexts: [],
      businessDeliveryFee: 5000,
      currency: "COP",
    });

    expect(decision.nextState.cart).toHaveLength(2);
    expect(decision.nextState.cart.filter((i) => i.productId === "combo")).toHaveLength(1);
    expect(decision.nextState.step).toBe(OrderFlowStep.ASK_DRINKS);
  });

  it("re-pregunta el tipo de entrega si no se pudo extraer", () => {
    const state = { ...initialOrderFlowState, step: OrderFlowStep.ASK_DELIVERY_TYPE };
    const decision = decideOrderFlow({
      state,
      intent: Intent.PROVIDE_INFO,
      entities: emptyEntities,
      matchedProduct: null,
      matchedSides: [],
      unmatchedSideTexts: [],
      businessDeliveryFee: 5000,
      currency: "COP",
    });

    expect(decision.nextState.step).toBe(OrderFlowStep.ASK_DELIVERY_TYPE);
    expect(decision.askNext).not.toBeNull();
  });

  it("agrega el nuevo producto al carrito existente si el cliente menciona otro a mitad de flujo, sin borrar lo que ya llevaba", () => {
    const state = {
      ...initialOrderFlowState,
      step: OrderFlowStep.ASK_DELIVERY_TYPE,
      cart: [{ productId: "old", productName: "Combo Pareja", quantity: 1, unitPrice: 42000 }],
    };

    const decision = decideOrderFlow({
      state,
      intent: Intent.ORDER_PRODUCT,
      entities: emptyEntities,
      matchedProduct: { id: "p1", name: "Pollo Frito 8 piezas", price: 52000 },
      matchedSides: [],
      unmatchedSideTexts: [],
      businessDeliveryFee: 5000,
      currency: "COP",
    });

    // No debe perder el item que ya llevaba (bug real: antes reiniciaba el carrito completo
    // a partir de un solo producto nuevo).
    expect(decision.nextState.cart).toHaveLength(2);
    expect(decision.nextState.cart.some((i) => i.productId === "old")).toBe(true);
    expect(decision.nextState.cart.some((i) => i.productId === "p1")).toBe(true);
    expect(decision.nextState.step).toBe(OrderFlowStep.ASK_DELIVERY_TYPE);
    expect(decision.facts.join(" ")).toContain("Agregue");
  });

  it("una correccion explicita reemplaza solo el ultimo item del carrito, no todo el pedido", () => {
    const state = {
      ...initialOrderFlowState,
      step: OrderFlowStep.ASK_DELIVERY_TYPE,
      cart: [
        { productId: "pollo", productName: "Pollo Asado Entero", quantity: 1, unitPrice: 48000 },
        { productId: "ensalada", productName: "Ensalada", quantity: 1, unitPrice: 6000 },
      ],
    };

    const decision = decideOrderFlow({
      state,
      intent: Intent.PROVIDE_INFO,
      entities: emptyEntities,
      matchedProduct: { id: "gaseosa", name: "Gaseosa 1.5L", price: 9000 },
      matchedSides: [],
      unmatchedSideTexts: [],
      businessDeliveryFee: 5000,
      currency: "COP",
      isCorrectionAttempt: true,
    });

    // "Ensalada no, pedi una gaseosa" — reemplaza la ensalada por la gaseosa, el pollo
    // (que no tiene nada que ver con la correccion) se queda intacto.
    expect(decision.nextState.cart).toHaveLength(2);
    expect(decision.nextState.cart.some((i) => i.productId === "pollo")).toBe(true);
    expect(decision.nextState.cart.some((i) => i.productId === "ensalada")).toBe(false);
    expect(decision.nextState.cart.some((i) => i.productId === "gaseosa")).toBe(true);
  });

  it("una correccion tardia conserva domicilio/direccion/metodo de pago ya dados y salta directo a confirmar", () => {
    const state = {
      ...initialOrderFlowState,
      step: OrderFlowStep.ASK_PAYMENT_METHOD,
      cart: [{ productId: "old", productName: "Combo Pareja", quantity: 1, unitPrice: 42000 }],
      deliveryType: "DELIVERY" as const,
      address: "Cr 37 # 47-258",
      neighborhood: "El Tablazo",
      paymentMethod: "TRANSFER" as const,
    };

    const decision = decideOrderFlow({
      state,
      intent: Intent.ORDER_PRODUCT,
      entities: { ...emptyEntities, quantity: 1 },
      matchedProduct: { id: "p1", name: "Pollo Asado Medio", price: 27000 },
      matchedSides: [],
      unmatchedSideTexts: [],
      businessDeliveryFee: 4000,
      currency: "COP",
    });

    // No debe perder domicilio, direccion ni metodo de pago ya dados antes de la
    // correccion (solo se pregunta de nuevo por acompanantes, que si aplica a lo nuevo).
    expect(decision.nextState.step).not.toBe(OrderFlowStep.ASK_DELIVERY_TYPE);
    expect(decision.nextState.step).not.toBe(OrderFlowStep.ASK_ADDRESS);
    expect(decision.nextState.address).toBe("Cr 37 # 47-258");
    expect(decision.nextState.deliveryType).toBe("DELIVERY");
    expect(decision.nextState.paymentMethod).toBe("TRANSFER");
    expect(decision.nextState.cart.some((i) => i.productId === "p1")).toBe(true);
  });

  it("pasa a confirmar con el resumen y total correcto al recibir metodo de pago", () => {
    const state = {
      ...initialOrderFlowState,
      step: OrderFlowStep.ASK_PAYMENT_METHOD,
      cart: [{ productId: "p1", productName: "Pollo Frito 8 piezas", quantity: 1, unitPrice: 52000 }],
      deliveryType: "DELIVERY" as const,
      address: "Calle 1 # 2-3",
    };

    const decision = decideOrderFlow({
      state,
      intent: Intent.PROVIDE_INFO,
      entities: { ...emptyEntities, paymentMethod: "CASH" },
      matchedProduct: null,
      matchedSides: [],
      unmatchedSideTexts: [],
      businessDeliveryFee: 5000,
      currency: "COP",
    });

    expect(decision.nextState.step).toBe(OrderFlowStep.CONFIRMING);
    expect(decision.facts.join(" ")).toContain("57,000");
  });

  it("crea la orden solo cuando el intent es CONFIRM en el paso CONFIRMING", () => {
    const state = {
      ...initialOrderFlowState,
      step: OrderFlowStep.CONFIRMING,
      cart: [{ productId: "p1", productName: "Pollo Frito 8 piezas", quantity: 1, unitPrice: 52000 }],
      deliveryType: "PICKUP" as const,
      paymentMethod: "CASH" as const,
    };

    const notConfirmed = decideOrderFlow({
      state,
      intent: Intent.UNKNOWN,
      entities: emptyEntities,
      matchedProduct: null,
      matchedSides: [],
      unmatchedSideTexts: [],
      businessDeliveryFee: 5000,
      currency: "COP",
    });
    expect(notConfirmed.readyToCreateOrder).toBe(false);

    const confirmed = decideOrderFlow({
      state,
      intent: Intent.CONFIRM,
      entities: emptyEntities,
      matchedProduct: null,
      matchedSides: [],
      unmatchedSideTexts: [],
      businessDeliveryFee: 5000,
      currency: "COP",
    });
    expect(confirmed.readyToCreateOrder).toBe(true);
    expect(confirmed.nextState.step).toBe(OrderFlowStep.DONE);
  });

  it("si el cliente cambia a recoger durante CONFIRMING, conserva carrito y vuelve a confirmar", () => {
    const state = {
      ...initialOrderFlowState,
      step: OrderFlowStep.CONFIRMING,
      cart: [{ productId: "p1", productName: "Pollo Frito 8 piezas", quantity: 1, unitPrice: 52000 }],
      deliveryType: "DELIVERY" as const,
      address: "Calle 1 # 2-3",
      neighborhood: "Centro",
      paymentMethod: "CASH" as const,
    };

    const decision = decideOrderFlow({
      state,
      intent: Intent.PROVIDE_INFO,
      entities: { ...emptyEntities, deliveryType: "PICKUP" },
      matchedProduct: null,
      matchedSides: [],
      unmatchedSideTexts: [],
      businessDeliveryFee: 5000,
      currency: "COP",
    });

    expect(decision.nextState.step).toBe(OrderFlowStep.CONFIRMING);
    expect(decision.nextState.deliveryType).toBe("PICKUP");
    expect(decision.nextState.address).toBeNull();
    expect(decision.askNext).toContain("Confirma");
  });

  it("si el cliente corrige direccion en CONFIRMING, actualiza el dato sin perder el pedido", () => {
    const state = {
      ...initialOrderFlowState,
      step: OrderFlowStep.CONFIRMING,
      cart: [{ productId: "p1", productName: "Pollo Frito 8 piezas", quantity: 1, unitPrice: 52000 }],
      deliveryType: "DELIVERY" as const,
      address: "Calle vieja",
      neighborhood: "Centro",
      paymentMethod: "CASH" as const,
    };

    const decision = decideOrderFlow({
      state,
      intent: Intent.PROVIDE_INFO,
      entities: { ...emptyEntities, address: "Cra 50 #20-30", neighborhood: "Laureles" },
      matchedProduct: null,
      matchedSides: [],
      unmatchedSideTexts: [],
      businessDeliveryFee: 5000,
      currency: "COP",
    });

    expect(decision.nextState.step).toBe(OrderFlowStep.CONFIRMING);
    expect(decision.nextState.address).toBe("Cra 50 #20-30");
    expect(decision.nextState.neighborhood).toBe("Laureles");
    expect(decision.nextState.cart).toHaveLength(1);
  });

  it("cancela el pedido y reinicia el estado desde cualquier paso intermedio", () => {
    const state = { ...initialOrderFlowState, step: OrderFlowStep.ASK_ADDRESS };
    const decision = decideOrderFlow({
      state,
      intent: Intent.CANCEL,
      entities: emptyEntities,
      matchedProduct: null,
      matchedSides: [],
      unmatchedSideTexts: [],
      businessDeliveryFee: 5000,
      currency: "COP",
    });

    expect(decision.cancelled).toBe(true);
    expect(decision.nextState.step).toBe(OrderFlowStep.IDLE);
    expect(decision.nextState.cart).toHaveLength(0);
  });
});

// Bug real: el bot se quedaba repitiendo "¿desea agregar algun acompanante?" sin importar que
// contestara el cliente, y un "No" pelado (que solo declinaba el acompanante) cancelaba el
// pedido completo. Causa: el clasificador de intencion no sabia que pregunta estaba pendiente,
// asi que "No" le salia CANCEL, y decideOrderFlow cancelaba en CUALQUIER paso.
describe("respuestas a preguntas opcionales (acompanantes / bebidas)", () => {
  const cartWithMainItem = [{ productId: "p1", productName: "Pollo Frito 8 piezas", quantity: 1, unitPrice: 52000 }];
  const papas = { id: "papas", name: "Papas Francesas", price: 9000, categoryName: "Acompanantes" };
  const ensalada = { id: "ensalada", name: "Ensalada", price: 7000, categoryName: "Acompanantes" };
  const gaseosa = { id: "gaseosa", name: "Gaseosa 1.5L", price: 9000, categoryName: "Bebidas" };

  function decide(overrides: Partial<Parameters<typeof decideOrderFlow>[0]>) {
    return decideOrderFlow({
      state: { ...initialOrderFlowState, step: OrderFlowStep.ASK_SIDES, cart: cartWithMainItem },
      intent: Intent.PROVIDE_INFO,
      entities: emptyEntities,
      matchedProduct: null,
      matchedSides: [],
      unmatchedSideTexts: [],
      businessDeliveryFee: 5000,
      currency: "COP",
      ...overrides,
    });
  }

  it("un acompanante suelto ('Ensalada') en ASK_SIDES se agrega al carrito y el flujo avanza sin re-preguntar", () => {
    const decision = decide({
      entities: { ...emptyEntities, sides: ["ensalada"] },
      matchedSides: [ensalada],
      availableSides: [papas, ensalada],
      availableDrinks: [gaseosa],
    });

    expect(decision.nextState.step).toBe(OrderFlowStep.ASK_DRINKS);
    expect(decision.nextState.sidesAsked).toBe(true);
    expect(decision.nextState.cart.some((i) => i.productId === "ensalada")).toBe(true);
    expect(decision.askNext).not.toContain("acompanante");
    expect(decision.cancelled).toBe(false);
  });

  it("un 'No' en ASK_SIDES declina el acompanante y avanza a bebidas, sin cancelar ni vaciar el carrito", () => {
    const decision = decide({ intent: Intent.CANCEL, availableDrinks: [gaseosa] });

    expect(decision.cancelled).toBe(false);
    expect(decision.nextState.step).toBe(OrderFlowStep.ASK_DRINKS);
    expect(decision.nextState.sidesAsked).toBe(true);
    expect(decision.nextState.cart).toEqual(cartWithMainItem);
    expect(decision.askNext).toContain("Gaseosa 1.5L");
  });

  it("un 'No' en ASK_DRINKS declina la bebida y avanza a domicilio, conservando el carrito", () => {
    const decision = decide({
      state: { ...initialOrderFlowState, step: OrderFlowStep.ASK_DRINKS, cart: cartWithMainItem, sidesAsked: true },
      intent: Intent.CANCEL,
    });

    expect(decision.cancelled).toBe(false);
    expect(decision.nextState.step).toBe(OrderFlowStep.ASK_DELIVERY_TYPE);
    expect(decision.nextState.drinksAsked).toBe(true);
    expect(decision.nextState.cart).toEqual(cartWithMainItem);
  });

  it("una cancelacion explicita ('cancelar mi pedido') en ASK_SIDES si cancela el pedido completo", () => {
    const decision = decide({ intent: Intent.CANCEL, isExplicitCancelRequest: true });

    expect(decision.cancelled).toBe(true);
    expect(decision.nextState.step).toBe(OrderFlowStep.IDLE);
    expect(decision.nextState.cart).toHaveLength(0);
  });

  it("cancelar en CONFIRMING sigue cancelando el pedido completo (no se degrada a 'declinar item')", () => {
    const decision = decide({
      state: {
        ...initialOrderFlowState,
        step: OrderFlowStep.CONFIRMING,
        cart: cartWithMainItem,
        deliveryType: "PICKUP",
        paymentMethod: "CASH",
      },
      intent: Intent.CANCEL,
    });

    expect(decision.cancelled).toBe(true);
    expect(decision.nextState.step).toBe(OrderFlowStep.IDLE);
    expect(decision.nextState.cart).toHaveLength(0);
  });
});

describe("isExplicitCancelRequest", () => {
  it("reconoce las cancelaciones inequivocas", () => {
    expect(isExplicitCancelRequest("cancelar mi pedido")).toBe(true);
    expect(isExplicitCancelRequest("no quiero nada, cancela todo")).toBe(true);
    expect(isExplicitCancelRequest("anuleme el pedido por favor")).toBe(true);
    expect(isExplicitCancelRequest("Cancélenlo")).toBe(true);
  });

  it("no toma por cancelacion un 'no' que solo declina un acompanante o una bebida", () => {
    expect(isExplicitCancelRequest("no")).toBe(false);
    expect(isExplicitCancelRequest("no gracias")).toBe(false);
    expect(isExplicitCancelRequest("asi esta bien")).toBe(false);
    expect(isExplicitCancelRequest("mejor no")).toBe(false);
    expect(isExplicitCancelRequest("nada mas")).toBe(false);
  });
});

describe("computeOrderTotal", () => {
  it("suma items mas costo de domicilio", () => {
    const total = computeOrderTotal(
      [
        { productId: "p1", productName: "A", quantity: 2, unitPrice: 10000 },
        { productId: "p2", productName: "B", quantity: 1, unitPrice: 5000 },
      ],
      5000,
    );
    expect(total).toBe(30000);
  });
});
