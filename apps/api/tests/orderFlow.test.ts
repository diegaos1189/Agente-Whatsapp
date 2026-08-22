import { describe, expect, it } from "vitest";
import { Intent, OrderFlowStep } from "@pollos/shared";
import { decideOrderFlow, initialOrderFlowState, computeOrderTotal } from "../src/modules/conversation/orderFlow.js";
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
