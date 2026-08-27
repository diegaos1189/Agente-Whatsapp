import { Intent, OrderFlowStep, type DeliveryType, type PaymentMethod } from "@pollos/shared";
import type { ExtractedEntities } from "../ai/entityExtractor.js";
import type { CartLine } from "../orders/orderService.js";
import { formatCurrency } from "../../utils/currency.js";

export interface MatchedProductRef {
  id: string;
  name: string;
  price: number;
  /** Nombre de la categoria del catalogo (ej: "Bebidas") — se usa para detectar si un item ya resuelto es una bebida, sin volver a consultar la base de datos. */
  categoryName?: string;
}

export interface OrderFlowState {
  step: OrderFlowStep;
  cart: CartLine[];
  pendingProduct: MatchedProductRef | null;
  sidesAsked: boolean;
  drinksAsked: boolean;
  deliveryType: DeliveryType | null;
  address: string | null;
  neighborhood: string | null;
  reference: string | null;
  /** Numero de contacto para el domiciliario, solo si el cliente dio uno explicito distinto al de WhatsApp. Null = usar el numero de WhatsApp. */
  contactPhone: string | null;
  paymentMethod: PaymentMethod | null;
}

export const initialOrderFlowState: OrderFlowState = {
  step: OrderFlowStep.IDLE,
  cart: [],
  pendingProduct: null,
  sidesAsked: false,
  drinksAsked: false,
  deliveryType: null,
  address: null,
  neighborhood: null,
  reference: null,
  contactPhone: null,
  paymentMethod: null,
};

const ORDER_INTAKE_INTENTS: string[] = [Intent.ORDER_PRODUCT];

export interface OrderFlowDecideInput {
  state: OrderFlowState;
  intent: string;
  entities: ExtractedEntities;
  /** Producto ya resuelto contra el catalogo (por productType/size del mensaje). Null si no hubo match. */
  matchedProduct: MatchedProductRef | null;
  /** Acompanantes ya resueltos contra el catalogo. Vacio si el cliente no pidio o no hubo match. */
  matchedSides: MatchedProductRef[];
  /** Texto de acompanantes/otros productos que el cliente menciono pero no matchearon ningun producto real. */
  unmatchedSideTexts: string[];
  /** Costo de domicilio del negocio (se aplica solo si deliveryType termina siendo DELIVERY). */
  businessDeliveryFee: number;
  /** Codigo de moneda del negocio (ej: COP, MXN, USD) para formatear los montos del resumen. */
  currency: string;
  /** Metodos de pago que el negocio acepta (Configuracion). Vacio = se asumen los 3 por defecto. */
  acceptedPaymentMethods?: PaymentMethod[];
  /** true si el mensaje suena a correccion ("no, es de 8 presas", "mejor el otro") — ver deteccion en conversationService. */
  isCorrectionAttempt?: boolean;
  /** Bebidas disponibles del catalogo, para ofrecerlas explicitamente en ASK_DRINKS. */
  availableDrinks?: MatchedProductRef[];
  /** Acompanantes disponibles del catalogo, para ofrecerlos explicitamente en ASK_SIDES. */
  availableSides?: MatchedProductRef[];
  /**
   * true si el cliente pidio cancelar con palabras inequivocas ("cancelar", "anule el pedido").
   * Un intent CANCEL sin esta marca puede ser solo un "no" contestando un slot opcional — ver
   * la deteccion en isExplicitCancelRequest y el manejo de CANCEL en decideOrderFlow.
   */
  isExplicitCancelRequest?: boolean;
}

export interface OrderFlowDecision {
  nextState: OrderFlowState;
  facts: string[];
  askNext: string | null;
  readyToCreateOrder: boolean;
  cancelled: boolean;
}

export function summarizeCart(state: OrderFlowState, deliveryFee: number, currency: string): string[] {
  const lines = state.cart.map(
    (item) => `${item.quantity}x ${item.productName} - ${formatCurrency(item.quantity * item.unitPrice, currency)}`,
  );
  const itemsTotal = state.cart.reduce((acc, i) => acc + i.quantity * i.unitPrice, 0);
  const total = itemsTotal + deliveryFee;

  if (state.deliveryType === "DELIVERY") {
    lines.push(
      `Domicilio a ${state.address ?? "-"}${state.neighborhood ? `, ${state.neighborhood}` : ""} - ${formatCurrency(deliveryFee, currency)}`,
    );
    if (state.contactPhone) {
      lines.push(`Numero de contacto para el domiciliario: ${state.contactPhone}`);
    }
  } else {
    lines.push("Recoge su pedido en el local.");
  }

  lines.push(`Metodo de pago: ${paymentMethodLabel(state.paymentMethod)}`);
  lines.push(`Total: ${formatCurrency(total, currency)}`);
  return lines;
}

function paymentMethodLabel(method: PaymentMethod | null): string {
  switch (method) {
    case "CASH":
      return "efectivo";
    case "TRANSFER":
      return "transferencia";
    case "CARD_ON_DELIVERY":
      return "tarjeta contraentrega";
    default:
      return "por definir";
  }
}

const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = ["CASH", "TRANSFER", "CARD_ON_DELIVERY"];

/** Pregunta de metodo de pago armada solo con los metodos que el negocio acepta (Configuracion). */
function buildPaymentMethodAskNext(acceptedPaymentMethods: PaymentMethod[]): string {
  const methods = acceptedPaymentMethods.length > 0 ? acceptedPaymentMethods : DEFAULT_PAYMENT_METHODS;
  const labels = methods.map(paymentMethodLabel);
  const list = labels.length > 1 ? `${labels.slice(0, -1).join(", ")} o ${labels[labels.length - 1]}` : labels[0];
  return `¿Como va a pagar: ${list}?`;
}

// Exige al menos 2 palabras en comun (no 1) para considerar "el mismo producto" — con 1 sola
// palabra, "Pollo Asado Entero" y "Pollo Frito 8 presas" (productos distintos que comparten
// solo "pollo") se confundian como si fueran el mismo item ya en el carrito, bloqueando que
// el cliente agregara el segundo producto.
function namesOverlap(a: string, b: string): boolean {
  const tokensOf = (s: string) => new Set(s.toLowerCase().split(/\s+/).filter((t) => t.length >= 3));
  const ta = tokensOf(a);
  const tb = tokensOf(b);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared >= 2;
}

function unmatchedSideNote(unmatchedSideTexts: string[]): string[] {
  if (unmatchedSideTexts.length === 0) return [];
  return [`No encontre "${unmatchedSideTexts.join(", ")}" en el menu, digame el nombre exacto si lo quiere agregar.`];
}

function isDrinkCategory(categoryName: string | undefined): boolean {
  return (categoryName ?? "").toLowerCase().includes("bebida");
}

function hasDrink(items: MatchedProductRef[]): boolean {
  return items.some((i) => isDrinkCategory(i.categoryName));
}

/** Pregunta de acompanantes ofreciendo explicitamente los disponibles del catalogo (categoria "Acompanantes"). */
function buildSidesAskNext(availableSides: MatchedProductRef[] | undefined, currency: string): string {
  if (!availableSides || availableSides.length === 0) return "¿Desea agregar algun acompanante?";
  const list = availableSides.map((s) => `${s.name} (${formatCurrency(s.price, currency)})`).join(", ");
  return `¿Desea agregar algun acompanante? Tenemos: ${list}.`;
}

/** Pregunta de bebidas ofreciendo explicitamente las disponibles del catalogo (categoria "Bebidas"). */
function buildDrinksAskNext(availableDrinks: MatchedProductRef[] | undefined, currency: string): string {
  if (!availableDrinks || availableDrinks.length === 0) return "¿Desea agregar alguna bebida?";
  const list = availableDrinks.map((d) => `${d.name} (${formatCurrency(d.price, currency)})`).join(", ");
  return `¿Que desea tomar? Tenemos: ${list}.`;
}

/** Determina el siguiente paso despues de agregar el producto principal: primero acompanantes, luego bebidas, luego domicilio — saltando los que ya vinieron resueltos en el mismo mensaje. */
function nextStepAfterMainItem(sidesAlreadyHandled: boolean, drinksAlreadyHandled: boolean): OrderFlowStep {
  if (!sidesAlreadyHandled) return OrderFlowStep.ASK_SIDES;
  if (!drinksAlreadyHandled) return OrderFlowStep.ASK_DRINKS;
  return OrderFlowStep.ASK_DELIVERY_TYPE;
}

/**
 * Pasos donde la pregunta pendiente es OPCIONAL: el cliente puede decir que no sin que eso
 * signifique cancelar el pedido. Un "no" pelado en estos pasos llega clasificado como CANCEL
 * (el clasificador no sabe que pregunta esta contestando), y cancelar el pedido entero por eso
 * borraba el carrito — ver el manejo de CANCEL en decideOrderFlow.
 */
const OPTIONAL_ITEM_STEPS: OrderFlowStep[] = [OrderFlowStep.ASK_SIDES, OrderFlowStep.ASK_DRINKS];

// Solo palabras que NUNCA significan otra cosa. "no", "mejor no", "ya no", "nada mas" quedan
// deliberadamente fuera: contestando "¿desea algun acompanante?" significan "ese item no",
// no "cancele mi pedido".
const EXPLICIT_CANCEL_PATTERN = /\b(cancel\w*|anul\w*)\b/u;

/**
 * true solo si el cliente pidio cancelar con palabras inequivocas ("cancelar mi pedido",
 * "anuleme eso"). Sirve para distinguir una cancelacion real de un "no" que el clasificador
 * manda como CANCEL cuando en realidad esta declinando un acompanante o una bebida.
 */
export function isExplicitCancelRequest(text: string): boolean {
  const normalized = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  return EXPLICIT_CANCEL_PATTERN.test(normalized);
}

function askNextForStep(
  step: OrderFlowStep,
  availableSides: MatchedProductRef[] | undefined,
  availableDrinks: MatchedProductRef[] | undefined,
  currency: string,
): string {
  switch (step) {
    case OrderFlowStep.ASK_SIDES:
      return buildSidesAskNext(availableSides, currency);
    case OrderFlowStep.ASK_DRINKS:
      return buildDrinksAskNext(availableDrinks, currency);
    default:
      return "¿Es para domicilio o para recoger en el local?";
  }
}

export function decideOrderFlow(input: OrderFlowDecideInput): OrderFlowDecision {
  const {
    state,
    intent,
    entities,
    matchedProduct,
    matchedSides,
    unmatchedSideTexts,
    businessDeliveryFee,
    currency,
    isCorrectionAttempt = false,
    acceptedPaymentMethods = DEFAULT_PAYMENT_METHODS,
    availableDrinks,
    availableSides,
    isExplicitCancelRequest: explicitCancel = false,
  } = input;

  if (intent === Intent.CANCEL && state.step !== OrderFlowStep.IDLE) {
    // Bug real: contestar "No" a "¿desea agregar algun acompanante?" borraba TODO el pedido.
    // El clasificador no ve que pregunta esta pendiente, asi que un "no" pelado le sale como
    // CANCEL. En los pasos opcionales (acompanantes/bebidas) un CANCEL que no venga con
    // palabras explicitas de cancelacion se trata como "no quiero ese item" y el flujo avanza,
    // conservando el carrito. En CONFIRMING y demas pasos, CANCEL sigue cancelando el pedido.
    const decliningOptionalItem = OPTIONAL_ITEM_STEPS.includes(state.step) && !explicitCancel;
    if (!decliningOptionalItem) {
      return {
        nextState: { ...initialOrderFlowState },
        facts: ["Su pedido fue cancelado, no se genero ningun cobro."],
        askNext: null,
        readyToCreateOrder: false,
        cancelled: true,
      };
    }

    const decliningDrinks = state.step === OrderFlowStep.ASK_DRINKS;
    const drinksHandled = decliningDrinks || state.drinksAsked;
    // Al llegar a cualquiera de estos dos pasos los acompanantes ya se preguntaron o se
    // resolvieron en el mismo mensaje, por eso sidesAlreadyHandled va en true.
    const nextStep = nextStepAfterMainItem(true, drinksHandled);
    return {
      nextState: { ...state, sidesAsked: true, drinksAsked: drinksHandled, step: nextStep },
      facts: [decliningDrinks ? "Listo, sin bebidas." : "Listo, sin acompanantes."],
      askNext: askNextForStep(nextStep, availableSides, availableDrinks, currency),
      readyToCreateOrder: false,
      cancelled: false,
    };
  }

  if (state.step === OrderFlowStep.CONFIRMING) {
    const hasCheckoutFieldUpdate = Boolean(
      entities.deliveryType || entities.address || entities.neighborhood || entities.reference || entities.contactPhone || entities.paymentMethod,
    );

    if (hasCheckoutFieldUpdate) {
      const nextDeliveryType = entities.deliveryType ?? state.deliveryType;
      const nextPaymentMethod =
        entities.paymentMethod && acceptedPaymentMethods.includes(entities.paymentMethod) ? entities.paymentMethod : state.paymentMethod;
      const nextStateBase: OrderFlowState = {
        ...state,
        deliveryType: nextDeliveryType,
        paymentMethod: nextPaymentMethod,
        address: nextDeliveryType === "PICKUP" ? null : entities.address ?? state.address,
        neighborhood: nextDeliveryType === "PICKUP" ? null : entities.neighborhood ?? state.neighborhood,
        reference: nextDeliveryType === "PICKUP" ? null : entities.reference ?? state.reference,
        contactPhone: nextDeliveryType === "PICKUP" ? null : entities.contactPhone ?? state.contactPhone,
      };

      if (nextDeliveryType === "DELIVERY" && !nextStateBase.address) {
        return {
          nextState: { ...nextStateBase, step: OrderFlowStep.ASK_ADDRESS },
          facts: ["Listo, cambio su pedido a domicilio."],
          askNext:
            "Perfecto, ¿cual es su direccion completa, barrio y un punto de referencia? Si el domiciliario debe llamar a un numero distinto a este de WhatsApp, compartalo tambien.",
          readyToCreateOrder: false,
          cancelled: false,
        };
      }

      if (!nextStateBase.paymentMethod) {
        return {
          nextState: { ...nextStateBase, step: OrderFlowStep.ASK_PAYMENT_METHOD },
          facts:
            nextDeliveryType === "PICKUP"
              ? ["Listo, cambio su pedido para recoger en el local."]
              : ["Actualice los datos de entrega de su pedido."],
          askNext: buildPaymentMethodAskNext(acceptedPaymentMethods),
          readyToCreateOrder: false,
          cancelled: false,
        };
      }

      const deliveryFee = nextStateBase.deliveryType === "DELIVERY" ? businessDeliveryFee : 0;
      return {
        nextState: { ...nextStateBase, step: OrderFlowStep.CONFIRMING },
        facts: summarizeCart(nextStateBase, deliveryFee, currency),
        askNext: "¿Confirma su pedido asi?",
        readyToCreateOrder: false,
        cancelled: false,
      };
    }
  }

  // El cliente esta mas alla de "eligiendo el primer producto" (ya se le pregunto
  // domicilio/direccion/pago/confirmacion) pero manda un mensaje que claramente es
  // OTRO pedido (matchea un producto del menu). En vez de trabarse re-preguntando
  // el slot pendiente (que el cliente esta ignorando), reiniciamos el carrito con
  // el nuevo pedido — el flujo normal desde IDLE ya sabe pedir cantidad, sides, etc.
  const earlyFlowSteps: OrderFlowStep[] = [
    OrderFlowStep.IDLE,
    OrderFlowStep.COLLECTING_ITEMS,
    OrderFlowStep.ASK_QUANTITY_OR_SIZE,
    OrderFlowStep.ASK_SIDES,
    OrderFlowStep.ASK_DRINKS,
  ];
  const isMidOrLateFlow = !earlyFlowSteps.includes(state.step);

  // Si el mensaje menciona un producto que YA esta en el carrito (mismo id o nombre con
  // palabras en comun, ej: "pollo" matchea "Pollo Asado Entero" ya pedido), lo mas probable
  // es que el cliente este preguntando/confirmando/repitiendo algo sobre ese item (comun con
  // audios: el cliente repite su pedido completo en cada nota de voz), no pidiendo agregarlo
  // de nuevo. Aplica en CUALQUIER paso salvo IDLE (ahi el carrito siempre esta vacio, no hay
  // nada que duplicar) e ignora si trae cantidad — bug real: un audio repitiendo "quiero un
  // pollo... el combo familiar" con cantidad=1 explicita esquivaba este guard y duplicaba el
  // item en el carrito cada vez, inflando el total (ej: 116,000 termino en 252,000).
  if (matchedProduct && state.step !== OrderFlowStep.IDLE) {
    const existingCartItem = state.cart.find(
      (item) => item.productId === matchedProduct.id || namesOverlap(item.productName, matchedProduct.name),
    );
    if (existingCartItem) {
      return {
        nextState: state,
        facts: [`Ya tiene en su pedido: ${existingCartItem.quantity}x ${existingCartItem.productName}.`],
        askNext: getPendingOrderQuestion(state, acceptedPaymentMethods),
        readyToCreateOrder: false,
        cancelled: false,
      };
    }
  }

  // Correccion explicita ("no, es de 8 presas", "mejor el otro") REEMPLAZA el ultimo item
  // agregado, no todo el carrito — antes esto reiniciaba el pedido completo a partir de un
  // solo producto, perdiendo cualquier otro item ya confirmado (ej: si ya llevaba pollo +
  // ensalada y corregia la ensalada por gaseosa, se perdia el pollo tambien).
  const isCorrectionRestart = isCorrectionAttempt && matchedProduct && isMidOrLateFlow;
  if (isCorrectionRestart && matchedProduct) {
    const lastItem = state.cart[state.cart.length - 1];
    const correctedItem: CartLine = {
      productId: matchedProduct.id,
      productName: matchedProduct.name,
      quantity: entities.quantity ?? lastItem?.quantity ?? 1,
      unitPrice: matchedProduct.price,
    };
    const cartWithoutLast = state.cart.slice(0, -1);
    const additions: CartLine[] = matchedSides.map((s) => ({ productId: s.id, productName: s.name, quantity: 1, unitPrice: s.price }));
    const nextState: OrderFlowState = { ...state, cart: [...cartWithoutLast, correctedItem, ...additions] };
    const deliveryFee = nextState.deliveryType === "DELIVERY" ? businessDeliveryFee : 0;
    return {
      nextState,
      facts: [
        `Entendido, actualice su pedido con lo que me acaba de decir.`,
        ...unmatchedSideNote(unmatchedSideTexts),
        ...summarizeCart(nextState, deliveryFee, currency),
      ],
      askNext: state.step === OrderFlowStep.CONFIRMING ? "¿Confirma su pedido asi?" : getPendingOrderQuestion(nextState, acceptedPaymentMethods),
      readyToCreateOrder: false,
      cancelled: false,
    };
  }

  // Mensaje de pedido normal (no correccion) mencionando OTRO producto a mitad/tarde del
  // flujo (ej: "ah y tambien una arepa" despues de ya haber dado direccion) — se AGREGA al
  // carrito existente, nunca lo reemplaza. Sigue preguntando lo que faltaba (direccion/pago)
  // si aun no se habia contestado, o vuelve a confirmar si ya estaba todo listo.
  if (intent === Intent.ORDER_PRODUCT && matchedProduct && isMidOrLateFlow) {
    const quantity = entities.quantity ?? 1;
    const additions: CartLine[] = [
      { productId: matchedProduct.id, productName: matchedProduct.name, quantity, unitPrice: matchedProduct.price },
      ...matchedSides.map((s) => ({ productId: s.id, productName: s.name, quantity: 1, unitPrice: s.price })),
    ];
    const nextState: OrderFlowState = { ...state, cart: [...state.cart, ...additions] };
    const deliveryFee = nextState.deliveryType === "DELIVERY" ? businessDeliveryFee : 0;
    return {
      nextState,
      facts: [
        `Agregue ${quantity}x ${matchedProduct.name} a su pedido.`,
        ...(matchedSides.length > 0 ? [`Tambien agregue ${matchedSides.map((s) => s.name).join(", ")}.`] : []),
        ...unmatchedSideNote(unmatchedSideTexts),
        ...summarizeCart(nextState, deliveryFee, currency),
      ],
      askNext: state.step === OrderFlowStep.CONFIRMING ? "¿Confirma su pedido asi?" : getPendingOrderQuestion(nextState, acceptedPaymentMethods),
      readyToCreateOrder: false,
      cancelled: false,
    };
  }

  switch (state.step) {
    case OrderFlowStep.IDLE: {
      if (!ORDER_INTAKE_INTENTS.includes(intent)) {
        return noOp(state);
      }
      if (matchedProduct) {
        const cartWithSides: CartLine[] = matchedSides.map((s) => ({
          productId: s.id,
          productName: s.name,
          quantity: 1,
          unitPrice: s.price,
        }));
        const sidesAlreadyHandled = matchedSides.length > 0 || unmatchedSideTexts.length > 0;
        // Si el cliente ya dijo la cantidad en el mismo mensaje (ej: "un pollo frito", "2
        // hamburguesas"), no volvemos a preguntar — sobre todo importante cuando el nombre
        // del producto ya trae un numero (ej: "Pollo Frito 8 presas"), donde re-preguntar
        // "cuantas unidades" facilmente se confunde con el numero de presas del producto.
        if (entities.quantity != null) {
          const cartWithProduct: CartLine[] = [
            ...state.cart,
            ...cartWithSides,
            { productId: matchedProduct.id, productName: matchedProduct.name, quantity: entities.quantity, unitPrice: matchedProduct.price },
          ];
          const drinksAlreadyHandled = hasDrink(matchedSides);
          const nextStep = nextStepAfterMainItem(sidesAlreadyHandled, drinksAlreadyHandled);
          return {
            nextState: {
              ...state,
              cart: cartWithProduct,
              sidesAsked: sidesAlreadyHandled,
              drinksAsked: drinksAlreadyHandled,
              step: nextStep,
              pendingProduct: null,
            },
            facts: [
              `Agregue ${entities.quantity}x ${matchedProduct.name}.`,
              ...(matchedSides.length > 0 ? [`Tambien agregue ${matchedSides.map((s) => s.name).join(", ")}.`] : []),
              ...unmatchedSideNote(unmatchedSideTexts),
            ],
            askNext: askNextForStep(nextStep, availableSides, availableDrinks, currency),
            readyToCreateOrder: false,
            cancelled: false,
          };
        }
        return {
          nextState: {
            ...state,
            cart: [...state.cart, ...cartWithSides],
            sidesAsked: sidesAlreadyHandled,
            step: OrderFlowStep.ASK_QUANTITY_OR_SIZE,
            pendingProduct: matchedProduct,
          },
          facts: [
            ...(matchedSides.length > 0 ? [`Agregue ${matchedSides.map((s) => s.name).join(", ")}.`] : []),
            ...unmatchedSideNote(unmatchedSideTexts),
          ],
          askNext: `¿Cuantas unidades de ${matchedProduct.name} desea?`,
          readyToCreateOrder: false,
          cancelled: false,
        };
      }
      return {
        nextState: { ...state, step: OrderFlowStep.COLLECTING_ITEMS },
        facts: [],
        askNext: "Claro que si, ¿que le gustaria pedir del menu?",
        readyToCreateOrder: false,
        cancelled: false,
      };
    }

    case OrderFlowStep.COLLECTING_ITEMS: {
      if (matchedProduct) {
        return {
          nextState: { ...state, step: OrderFlowStep.ASK_QUANTITY_OR_SIZE, pendingProduct: matchedProduct },
          facts: [],
          askNext: `¿Cuantas unidades de ${matchedProduct.name} desea?`,
          readyToCreateOrder: false,
          cancelled: false,
        };
      }
      return {
        nextState: state,
        facts: [],
        askNext: "¿Me confirma el nombre exacto del producto del menu que desea pedir?",
        readyToCreateOrder: false,
        cancelled: false,
      };
    }

    case OrderFlowStep.ASK_QUANTITY_OR_SIZE: {
      if (!state.pendingProduct) {
        return { ...noOp(state), nextState: { ...state, step: OrderFlowStep.COLLECTING_ITEMS } };
      }
      const quantity = entities.quantity ?? 1;
      const newCart: CartLine[] = [
        ...state.cart,
        {
          productId: state.pendingProduct.id,
          productName: state.pendingProduct.name,
          quantity,
          unitPrice: state.pendingProduct.price,
        },
        ...matchedSides.map((s) => ({ productId: s.id, productName: s.name, quantity: 1, unitPrice: s.price })),
      ];
      const sidesAlreadyHandled = state.sidesAsked || matchedSides.length > 0 || unmatchedSideTexts.length > 0;
      const drinksAlreadyHandled = hasDrink(matchedSides);
      const nextStep = nextStepAfterMainItem(sidesAlreadyHandled, drinksAlreadyHandled);
      const facts = [
        `Agregue ${quantity}x ${state.pendingProduct.name} a su pedido.`,
        ...(matchedSides.length > 0 ? [`Tambien agregue ${matchedSides.map((s) => s.name).join(", ")}.`] : []),
        ...unmatchedSideNote(unmatchedSideTexts),
      ];
      return {
        nextState: { ...state, cart: newCart, pendingProduct: null, sidesAsked: sidesAlreadyHandled, drinksAsked: drinksAlreadyHandled, step: nextStep },
        facts,
        askNext: askNextForStep(nextStep, availableSides, availableDrinks, currency),
        readyToCreateOrder: false,
        cancelled: false,
      };
    }

    case OrderFlowStep.ASK_SIDES: {
      const cartWithSides: CartLine[] = [
        ...state.cart,
        ...matchedSides.map((s) => ({ productId: s.id, productName: s.name, quantity: 1, unitPrice: s.price })),
      ];
      const drinksAlreadyHandled = hasDrink(matchedSides);
      const nextStep = drinksAlreadyHandled ? OrderFlowStep.ASK_DELIVERY_TYPE : OrderFlowStep.ASK_DRINKS;
      return {
        nextState: { ...state, cart: cartWithSides, sidesAsked: true, drinksAsked: drinksAlreadyHandled, step: nextStep },
        facts: [
          ...(matchedSides.length > 0 ? [`Agregue ${matchedSides.map((s) => s.name).join(", ")}.`] : []),
          ...unmatchedSideNote(unmatchedSideTexts),
        ],
        askNext: askNextForStep(nextStep, availableSides, availableDrinks, currency),
        readyToCreateOrder: false,
        cancelled: false,
      };
    }

    case OrderFlowStep.ASK_DRINKS: {
      const drinkItems: CartLine[] = [
        ...(matchedProduct ? [{ productId: matchedProduct.id, productName: matchedProduct.name, quantity: entities.quantity ?? 1, unitPrice: matchedProduct.price }] : []),
        ...matchedSides.map((s) => ({ productId: s.id, productName: s.name, quantity: 1, unitPrice: s.price })),
      ];
      return {
        nextState: { ...state, cart: [...state.cart, ...drinkItems], drinksAsked: true, step: OrderFlowStep.ASK_DELIVERY_TYPE },
        facts: [
          ...(drinkItems.length > 0 ? [`Agregue ${drinkItems.map((i) => i.productName).join(", ")}.`] : []),
          ...unmatchedSideNote(unmatchedSideTexts),
        ],
        askNext: "¿Es para domicilio o para recoger en el local?",
        readyToCreateOrder: false,
        cancelled: false,
      };
    }

    case OrderFlowStep.ASK_DELIVERY_TYPE: {
      if (!entities.deliveryType) {
        return {
          nextState: state,
          facts: [],
          askNext: "Cuenteme, ¿el pedido es para domicilio o para recoger en el local?",
          readyToCreateOrder: false,
          cancelled: false,
        };
      }
      if (entities.deliveryType === "DELIVERY") {
        return {
          nextState: { ...state, deliveryType: "DELIVERY", step: OrderFlowStep.ASK_ADDRESS },
          facts: [],
          askNext:
            "Perfecto, ¿cual es su direccion completa, barrio y un punto de referencia? Si el domiciliario debe llamar a un numero distinto a este de WhatsApp, compartalo tambien.",
          readyToCreateOrder: false,
          cancelled: false,
        };
      }
      return {
        nextState: { ...state, deliveryType: "PICKUP", step: OrderFlowStep.ASK_PAYMENT_METHOD },
        facts: ["Listo, su pedido lo recoge en el local."],
        askNext: buildPaymentMethodAskNext(acceptedPaymentMethods),
        readyToCreateOrder: false,
        cancelled: false,
      };
    }

    case OrderFlowStep.ASK_ADDRESS: {
      if (!entities.address) {
        return {
          nextState: state,
          facts: [],
          askNext:
            "¿Me comparte la direccion completa (calle, barrio y una referencia) para el domicilio, y un numero de contacto para el domiciliario si es distinto a este de WhatsApp?",
          readyToCreateOrder: false,
          cancelled: false,
        };
      }
      return {
        nextState: {
          ...state,
          address: entities.address,
          neighborhood: entities.neighborhood ?? state.neighborhood,
          reference: entities.reference ?? state.reference,
          contactPhone: entities.contactPhone ?? state.contactPhone,
          step: OrderFlowStep.ASK_PAYMENT_METHOD,
        },
        // Sin este hecho, la IA se queda sin nada que confirmar y rellena con frases
        // genericas incoherentes (ej: "¿que te gustaria pedir hoy?" en medio del pedido).
        facts: ["Su direccion y datos de contacto para el domicilio quedaron registrados."],
        askNext: buildPaymentMethodAskNext(acceptedPaymentMethods),
        readyToCreateOrder: false,
        cancelled: false,
      };
    }

    case OrderFlowStep.ASK_PAYMENT_METHOD: {
      const methodAccepted = entities.paymentMethod && acceptedPaymentMethods.includes(entities.paymentMethod);
      if (!methodAccepted) {
        return {
          nextState: state,
          facts: entities.paymentMethod
            ? [`No manejamos ese metodo de pago.`]
            : [],
          askNext: buildPaymentMethodAskNext(acceptedPaymentMethods),
          readyToCreateOrder: false,
          cancelled: false,
        };
      }
      const nextState: OrderFlowState = {
        ...state,
        paymentMethod: entities.paymentMethod,
        step: OrderFlowStep.CONFIRMING,
      };
      const deliveryFee = nextState.deliveryType === "DELIVERY" ? businessDeliveryFee : 0;
      return {
        nextState,
        facts: summarizeCart(nextState, deliveryFee, currency),
        askNext: "¿Confirma su pedido asi?",
        readyToCreateOrder: false,
        cancelled: false,
      };
    }

    case OrderFlowStep.CONFIRMING: {
      if (intent === Intent.CONFIRM) {
        return {
          nextState: { ...state, step: OrderFlowStep.DONE },
          facts: [],
          askNext: null,
          readyToCreateOrder: true,
          cancelled: false,
        };
      }
      const deliveryFee = state.deliveryType === "DELIVERY" ? businessDeliveryFee : 0;
      return {
        nextState: state,
        facts: summarizeCart(state, deliveryFee, currency),
        askNext: "¿Confirma su pedido asi?",
        readyToCreateOrder: false,
        cancelled: false,
      };
    }

    case OrderFlowStep.DONE:
    default:
      return noOp({ ...initialOrderFlowState });
  }
}

function noOp(state: OrderFlowState): OrderFlowDecision {
  return { nextState: state, facts: [], askNext: null, readyToCreateOrder: false, cancelled: false };
}

/**
 * Pregunta pendiente segun el paso actual del pedido. Se usa para recordarsela al
 * cliente cuando contesta otra cosa a mitad de flujo (ej: pide el menu mientras se le
 * pregunta la direccion) — asi no se pierde el hilo del pedido en curso.
 */
export function getPendingOrderQuestion(
  state: OrderFlowState,
  acceptedPaymentMethods: PaymentMethod[] = DEFAULT_PAYMENT_METHODS,
): string | null {
  switch (state.step) {
    case OrderFlowStep.COLLECTING_ITEMS:
      return "¿que le gustaria pedir del menu?";
    case OrderFlowStep.ASK_QUANTITY_OR_SIZE:
      return state.pendingProduct
        ? `¿cuantas unidades de ${state.pendingProduct.name} desea?`
        : "¿que le gustaria pedir?";
    case OrderFlowStep.ASK_SIDES:
      // Sin ejemplos de comida concretos: este texto tambien viaja en el prompt de la IA y el
      // catalogo real lo pone buildSidesAskNext (el tipo de producto depende del negocio).
      return "¿desea agregar algun acompanante?";
    case OrderFlowStep.ASK_DRINKS:
      return "¿que desea tomar?";
    case OrderFlowStep.ASK_DELIVERY_TYPE:
      return "¿su pedido es para domicilio o para recoger en el local?";
    case OrderFlowStep.ASK_ADDRESS:
      return "¿cual es su direccion completa, barrio, un punto de referencia y (si aplica) un numero de contacto distinto para el domiciliario?";
    case OrderFlowStep.ASK_PAYMENT_METHOD:
      return buildPaymentMethodAskNext(acceptedPaymentMethods).toLowerCase();
    case OrderFlowStep.CONFIRMING:
      return "¿confirma su pedido asi? responda *si* para confirmar o *cancelar* para anular.";
    default:
      return null;
  }
}

export function computeOrderTotal(cart: CartLine[], deliveryFee: number): number {
  return cart.reduce((acc, i) => acc + i.quantity * i.unitPrice, 0) + deliveryFee;
}
