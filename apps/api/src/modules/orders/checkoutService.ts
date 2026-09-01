import { createHash, randomUUID } from "node:crypto";
import type { BusinessSettingsDTO, DeliveryType, PaymentMethod } from "@pollos/shared";
import { checkIsOpen } from "../business/businessHoursService.js";
import type { StructuredCartState } from "../conversation/structuredCart.js";
import type { OrderFlowState } from "../conversation/orderFlow.js";
import { calculateCartPricing, type CartPricingResult, type PricingValidationIssue } from "./pricingService.js";

export type CheckoutStatus = "BUILDING_CART" | "AWAITING_CONFIRMATION" | "ORDER_CREATED" | "CANCELLED";

export interface CheckoutValidationError {
  code:
    | "EMPTY_CART"
    | "STORE_CLOSED"
    | "DELIVERY_TYPE_REQUIRED"
    | "DELIVERY_DISABLED"
    | "PICKUP_DISABLED"
    | "ADDRESS_REQUIRED"
    | "ADDRESS_INCOMPLETE"
    | "NEIGHBORHOOD_REQUIRED"
    | "DELIVERY_OUT_OF_COVERAGE"
    | "DELIVERY_MINIMUM_NOT_MET"
    | "CONTACT_PHONE_INVALID"
    | "PAYMENT_METHOD_REQUIRED"
    | "PAYMENT_METHOD_INVALID"
    | "PRODUCT_NOT_FOUND"
    | "PRODUCT_UNAVAILABLE"
    | "COMPONENT_NOT_FOUND"
    | "COMPONENT_UNAVAILABLE"
    | "COMPONENT_INCOMPATIBLE";
  itemId?: string;
  message: string;
}

export interface CheckoutSummary {
  version: number;
  confirmationId: string;
  cartFingerprint: string;
  items: CartPricingResult["items"];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  tax: number;
  total: number;
  currency: string;
  deliveryType: DeliveryType | null;
  deliveryAddress: string | null;
  neighborhood: string | null;
  paymentMethod: PaymentMethod | null;
}

export interface CheckoutStateSnapshot {
  status: CheckoutStatus;
  version: number;
  confirmationId: string | null;
  cartFingerprint: string | null;
  summary: CheckoutSummary | null;
  orderId?: string | null;
  lastValidationErrors?: CheckoutValidationError[];
}

export interface CheckoutValidationResult {
  valid: boolean;
  errors: CheckoutValidationError[];
  warnings: string[];
  pricing: CartPricingResult | null;
}

export interface CheckoutRecoveryPrompt {
  facts: string[];
  askNext: string;
}

function mapPricingIssue(issue: PricingValidationIssue): CheckoutValidationError {
  return {
    code: issue.code,
    message: issue.message,
  };
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function addressMatchesCoverage(
  address: string | null,
  neighborhood: string | null,
  coverageKeywords: string[],
): boolean {
  if (coverageKeywords.length === 0) return true;
  const haystack = normalize(`${address ?? ""} ${neighborhood ?? ""}`);
  return coverageKeywords.some((keyword) => haystack.includes(normalize(keyword)));
}

function addressLooksComplete(address: string | null): boolean {
  if (!address) return false;
  const trimmed = address.trim();
  if (trimmed.length < 10) return false;
  if (!/\d/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.length >= 3;
}

function hasNeighborhood(neighborhood: string | null): boolean {
  return Boolean(neighborhood?.trim());
}

function isValidContactPhone(contactPhone: string | null): boolean {
  if (!contactPhone) return true;
  const digits = contactPhone.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

export function buildCheckoutRecoveryPrompt(params: {
  errors: CheckoutValidationError[];
  state: OrderFlowState;
  acceptsPickup: boolean;
}): CheckoutRecoveryPrompt {
  const { errors, state, acceptsPickup } = params;
  const codes = new Set(errors.map((error) => error.code));

  if (codes.has("ADDRESS_REQUIRED") || codes.has("ADDRESS_INCOMPLETE")) {
    return {
      facts: errors.map((error) => error.message),
      askNext: "Comparta la direccion completa con calle, numero, barrio y una referencia para continuar.",
    };
  }

  if (codes.has("NEIGHBORHOOD_REQUIRED")) {
    return {
      facts: errors.map((error) => error.message),
      askNext: "¿Me comparte el barrio del domicilio para validar la cobertura?",
    };
  }

  if (codes.has("CONTACT_PHONE_INVALID")) {
    return {
      facts: errors.map((error) => error.message),
      askNext: "¿Me confirma el numero de contacto del domiciliario? Puede escribirlo solo con numeros.",
    };
  }

  if (codes.has("DELIVERY_OUT_OF_COVERAGE")) {
    return {
      facts: errors.map((error) => error.message),
      askNext: acceptsPickup
        ? "Si quiere, puede enviarme otra direccion con barrio o decirme que prefiere recoger en el local."
        : "Si quiere, puede enviarme otra direccion con barrio para revisar una alternativa cercana.",
    };
  }

  if (codes.has("DELIVERY_MINIMUM_NOT_MET")) {
    return {
      facts: errors.map((error) => error.message),
      askNext: acceptsPickup
        ? "Puede agregar algo mas al pedido o decirme si prefiere recoger en el local."
        : "Puede agregar algo mas al pedido para llegar al minimo de domicilio.",
    };
  }

  if (codes.has("PAYMENT_METHOD_REQUIRED") || codes.has("PAYMENT_METHOD_INVALID")) {
    return {
      facts: errors.map((error) => error.message),
      askNext: "¿Me confirma como va a pagar para poder cerrar el pedido?",
    };
  }

  if (codes.has("DELIVERY_TYPE_REQUIRED")) {
    return {
      facts: errors.map((error) => error.message),
      askNext: "¿Su pedido es para domicilio o para recoger en el local?",
    };
  }

  return {
    facts: errors.map((error) => error.message),
    askNext:
      state.step === "CONFIRMING" ? "¿Desea corregir el pedido para continuar?" : "Comparta el dato faltante para continuar con el pedido.",
  };
}

export function computeCheckoutFingerprint(state: OrderFlowState, activeCart: StructuredCartState | null): string {
  const payload = {
    cart: state.cart,
    activeCart,
    deliveryType: state.deliveryType,
    address: state.address,
    neighborhood: state.neighborhood,
    reference: state.reference,
    contactPhone: state.contactPhone,
    paymentMethod: state.paymentMethod,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function buildEmptyCheckoutState(previousVersion = 0): CheckoutStateSnapshot {
  return {
    status: "BUILDING_CART",
    version: previousVersion,
    confirmationId: null,
    cartFingerprint: null,
    summary: null,
    orderId: null,
    lastValidationErrors: [],
  };
}

export function invalidateCheckoutState(previous: CheckoutStateSnapshot | null | undefined): CheckoutStateSnapshot {
  return buildEmptyCheckoutState((previous?.version ?? 0) + 1);
}

export function isCheckoutSummaryStale(
  checkout: CheckoutStateSnapshot | null | undefined,
  state: OrderFlowState,
  activeCart: StructuredCartState | null,
): boolean {
  if (!checkout?.summary || !checkout.cartFingerprint) return true;
  return checkout.cartFingerprint !== computeCheckoutFingerprint(state, activeCart);
}

export async function validateCheckout(params: {
  state: OrderFlowState;
  activeCart: StructuredCartState | null;
  settings: BusinessSettingsDTO;
  at?: Date;
}): Promise<CheckoutValidationResult> {
  const { state, activeCart, settings, at } = params;
  const errors: CheckoutValidationError[] = [];

  if (state.cart.length === 0) {
    errors.push({ code: "EMPTY_CART", message: "El pedido no tiene productos." });
  }

  const openStatus = checkIsOpen(settings, at);
  if (!openStatus.isOpen && !settings.acceptsScheduledOrders) {
    errors.push({ code: "STORE_CLOSED", message: settings.outOfHoursMessage });
  }

  if (!state.deliveryType) {
    errors.push({ code: "DELIVERY_TYPE_REQUIRED", message: "Debe definir si el pedido es para domicilio o para recoger." });
  } else if (state.deliveryType === "DELIVERY" && !settings.acceptsDelivery) {
    errors.push({ code: "DELIVERY_DISABLED", message: "En este momento no estamos recibiendo pedidos a domicilio." });
  } else if (state.deliveryType === "PICKUP" && !settings.acceptsPickup) {
    errors.push({ code: "PICKUP_DISABLED", message: "En este momento no estamos recibiendo pedidos para recoger." });
  }

  if (state.deliveryType === "DELIVERY") {
    if (!state.address) {
      errors.push({ code: "ADDRESS_REQUIRED", message: "Necesito la direccion completa para el domicilio." });
    } else if (!addressLooksComplete(state.address)) {
      errors.push({
        code: "ADDRESS_INCOMPLETE",
        message: "La direccion parece incompleta. Comparta calle, numero y un dato claro para ubicar el domicilio.",
      });
    }

    if (!hasNeighborhood(state.neighborhood)) {
      errors.push({
        code: "NEIGHBORHOOD_REQUIRED",
        message: "Tambien necesito el barrio para validar la cobertura del domicilio.",
      });
    } else if (!addressMatchesCoverage(state.address, state.neighborhood, settings.deliveryCoverageKeywords)) {
      errors.push({
        code: "DELIVERY_OUT_OF_COVERAGE",
        message: "La direccion indicada esta fuera de nuestra cobertura actual.",
      });
    }
  }

  if (!isValidContactPhone(state.contactPhone)) {
    errors.push({
      code: "CONTACT_PHONE_INVALID",
      message: "El numero de contacto para el domiciliario no parece valido.",
    });
  }

  if (!state.paymentMethod) {
    errors.push({ code: "PAYMENT_METHOD_REQUIRED", message: "Debe elegir un metodo de pago antes de confirmar." });
  } else if (!settings.acceptedPaymentMethods.includes(state.paymentMethod)) {
    errors.push({ code: "PAYMENT_METHOD_INVALID", message: "Ese metodo de pago no esta habilitado actualmente." });
  }

  const pricing = await calculateCartPricing({
    cart: state.cart,
    activeCart,
    deliveryType: state.deliveryType,
    currency: settings.currency,
    businessDeliveryFee: settings.deliveryFee,
  });

  if (!pricing.valid) {
    errors.push(...pricing.issues.map(mapPricingIssue));
  }

  if (state.deliveryType === "DELIVERY" && settings.minimumDeliveryOrder > 0 && pricing.total < settings.minimumDeliveryOrder) {
    errors.push({
      code: "DELIVERY_MINIMUM_NOT_MET",
      message: `El pedido minimo para domicilio es ${settings.minimumDeliveryOrder.toLocaleString("es-CO")} ${settings.currency}.`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
    pricing,
  };
}

export async function prepareCheckoutSummary(params: {
  state: OrderFlowState;
  activeCart: StructuredCartState | null;
  settings: BusinessSettingsDTO;
  previousCheckout: CheckoutStateSnapshot | null | undefined;
  at?: Date;
}): Promise<{ validation: CheckoutValidationResult; checkout: CheckoutStateSnapshot }> {
  const validation = await validateCheckout({
    state: params.state,
    activeCart: params.activeCart,
    settings: params.settings,
    at: params.at,
  });

  if (!validation.valid || !validation.pricing) {
    return {
      validation,
      checkout: {
        ...invalidateCheckoutState(params.previousCheckout),
        lastValidationErrors: validation.errors,
      },
    };
  }

  const normalizedState: OrderFlowState = {
    ...params.state,
    cart: validation.pricing.repricedCartLines,
  };
  const normalizedActiveCart = validation.pricing.repricedActiveCart ?? params.activeCart;
  const staleByFingerprint = isCheckoutSummaryStale(params.previousCheckout, normalizedState, normalizedActiveCart);
  const previousSummary = params.previousCheckout?.summary ?? null;
  const staleByPricing =
    Boolean(previousSummary) &&
    (previousSummary!.subtotal !== validation.pricing.subtotal ||
      previousSummary!.discount !== validation.pricing.discount ||
      previousSummary!.deliveryFee !== validation.pricing.deliveryFee ||
      previousSummary!.tax !== validation.pricing.tax ||
      previousSummary!.total !== validation.pricing.total);
  const mustRotateConfirmation = staleByFingerprint || staleByPricing;
  const nextVersion = mustRotateConfirmation
    ? (params.previousCheckout?.version ?? 0) + 1
    : params.previousCheckout?.version ?? 1;
  const cartFingerprint = computeCheckoutFingerprint(normalizedState, normalizedActiveCart);
  const summary: CheckoutSummary = {
    version: nextVersion,
    confirmationId: mustRotateConfirmation ? randomUUID() : params.previousCheckout?.summary?.confirmationId ?? randomUUID(),
    cartFingerprint,
    items: validation.pricing.items,
    subtotal: validation.pricing.subtotal,
    discount: validation.pricing.discount,
    deliveryFee: validation.pricing.deliveryFee,
    tax: validation.pricing.tax,
    total: validation.pricing.total,
    currency: validation.pricing.currency,
    deliveryType: normalizedState.deliveryType,
    deliveryAddress: normalizedState.address,
    neighborhood: normalizedState.neighborhood,
    paymentMethod: normalizedState.paymentMethod,
  };

  return {
    validation,
    checkout: {
      status: "AWAITING_CONFIRMATION",
      version: nextVersion,
      confirmationId: summary.confirmationId,
      cartFingerprint,
      summary,
      orderId: null,
      lastValidationErrors: [],
    },
  };
}
