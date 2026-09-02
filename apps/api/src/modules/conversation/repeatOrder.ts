import type { DeliveryType, PaymentMethod, ProductDTO } from "@pollos/shared";
import {
  applyStructuredCartInstruction,
  createStructuredCartFromLegacyLines,
  exportStructuredCartLines,
  parseStructuredCartInstruction,
  summarizeStructuredCart,
  type StructuredCartState,
} from "./structuredCart.js";
import { initialOrderFlowState, type OrderFlowState } from "./orderFlow.js";
import {
  getLatestOrderForContact,
  getOrderByCodeForContact,
  getRecentOrdersForContact,
  type CartLine,
  type OrderWithItems,
} from "../orders/orderService.js";
import { getEffectivePrice, listAllProductsForResolution } from "../products/productService.js";
import { normalizeLocalizedText } from "../localization/localeService.js";

export interface RepeatPreparationIssue {
  itemName: string;
  reason:
    | "ORDER_NOT_FOUND"
    | "ORDER_AMBIGUOUS"
    | "PRODUCT_NOT_FOUND"
    | "PRODUCT_UNAVAILABLE"
    | "MODIFIER_INVALID";
  message: string;
}

export interface RepeatPreparationResult {
  status: "READY" | "PARTIAL" | "EMPTY" | "AMBIGUOUS" | "NOT_FOUND";
  sourceOrder: OrderWithItems | null;
  recentOrders: OrderWithItems[];
  activeCart: StructuredCartState | null;
  nextState: OrderFlowState | null;
  issues: RepeatPreparationIssue[];
}

const REPEAT_PATTERNS = [
  /\blo mismo\b/i,
  /\blo de siempre\b/i,
  /\brepit(?:a|ame|ame?l[oa]?|elo?)\b/i,
  /\bpedido anterior\b/i,
  /\bultimo pedido\b/i,
  /\bel mismo\b/i,
  /\bigual al anterior\b/i,
  /\bde la vez pasada\b/i,
  /\bde la otra vez\b/i,
];

function normalize(text: string): string {
  return normalizeLocalizedText(text)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function splitInstructionClauses(text: string): string[] {
  return text
    .split(/\s+pero\s+|,\s*|\.\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildOrderSignature(order: OrderWithItems): string {
  return order.items
    .map((item) => `${item.productId ?? item.productName ?? "?"}:${item.quantity}:${item.notes ?? ""}`)
    .sort()
    .join("|");
}

function cloneStateWithDeliveryCandidate(
  sourceOrder: OrderWithItems,
  paymentMethod: PaymentMethod | null,
  text: string,
): OrderFlowState {
  const explicitPickup = /\brecoj[oa]\b|\bpaso por\b|\bpara recoger\b/i.test(text);
  const explicitDelivery =
    /\bdomicilio\b|\bmandel[oa]\b|\bmandemelo\b|\benvi[ae]l[oa]?\b|\btraigamelo\b|\bpa la casa\b|\bpara la casa\b/i.test(
      text,
    );
  let deliveryType: DeliveryType | null = (sourceOrder.deliveryType as DeliveryType | null) ?? null;

  if (explicitPickup) deliveryType = "PICKUP";
  if (explicitDelivery) deliveryType = "DELIVERY";

  const shouldReuseHistoricalAddress =
    deliveryType === "DELIVERY" &&
    (/\bla misma direccion\b/i.test(text) || /\blo mismo\b/i.test(text) || /\blo de siempre\b/i.test(text) || explicitDelivery);

  return {
    ...initialOrderFlowState,
    step: "CONFIRMING",
    cart: [],
    deliveryType,
    address: shouldReuseHistoricalAddress ? sourceOrder.address : null,
    neighborhood: shouldReuseHistoricalAddress ? sourceOrder.neighborhood : null,
    reference: shouldReuseHistoricalAddress ? sourceOrder.reference : null,
    contactPhone: shouldReuseHistoricalAddress ? sourceOrder.contactPhone : null,
    paymentMethod,
  };
}

function extractRequestedOrderCode(text: string): string | null {
  const hashMatch = text.match(/#([A-Za-z0-9-]+)/);
  if (hashMatch?.[1]) return hashMatch[1].trim();

  const codeMatch = text.match(/\b(POL-[A-Za-z0-9-]+)\b/i);
  if (codeMatch?.[1]) return codeMatch[1].trim();

  return null;
}

function looksAmbiguousLoDeSiempre(text: string): boolean {
  return /\blo de siempre\b/i.test(text);
}

function findCurrentProduct(orderItem: OrderWithItems["items"][number], allProducts: ProductDTO[]): ProductDTO | null {
  if (orderItem.productId) {
    const byId = allProducts.find((product) => product.id === orderItem.productId);
    if (byId) return byId;
  }

  if (!orderItem.productName) return null;
  const normalizedName = normalize(orderItem.productName);
  return (
    allProducts.find((product) => normalize(product.name) === normalizedName) ??
    allProducts.find((product) => normalize(`${product.name} ${product.searchKeywords ?? ""}`).includes(normalizedName)) ??
    null
  );
}

async function buildCurrentPriceMap(restaurantId: string, products: ProductDTO[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const product of products) {
    map.set(product.id, await getEffectivePrice(restaurantId, product.id, product.price));
  }
  return map;
}

function attachFreshItems(
  cart: StructuredCartState,
  line: CartLine,
  allProducts: ProductDTO[],
  priceById: Map<string, number>,
): { cart: StructuredCartState; createdItemIds: string[] } {
  const added = createStructuredCartFromLegacyLines([line], allProducts, priceById);
  return {
    cart: {
      items: [...cart.items, ...added.items],
      lastReferencedItemId: added.lastReferencedItemId ?? cart.lastReferencedItemId,
    },
    createdItemIds: added.items.map((item) => item.id),
  };
}

function applyNoteClauses(params: {
  cart: StructuredCartState;
  clauses: string[];
  itemId: string;
  allProducts: ProductDTO[];
  priceById: Map<string, number>;
  issues: RepeatPreparationIssue[];
  itemName: string;
}): StructuredCartState {
  let currentCart = params.cart;

  for (const clause of params.clauses) {
    const instruction = parseStructuredCartInstruction(clause);
    if (!instruction) continue;
    const result = applyStructuredCartInstruction(
      currentCart,
      { ...instruction, target: { kind: "ITEM_ID", itemId: params.itemId } },
      params.allProducts,
      params.priceById,
    );
    currentCart = result.updatedCart;
    if (!result.ok) {
      params.issues.push({
        itemName: params.itemName,
        reason: "MODIFIER_INVALID",
        message: result.message,
      });
    }
  }

  return currentCart;
}

export function isRepeatOrderRequest(text: string): boolean {
  return REPEAT_PATTERNS.some((pattern) => pattern.test(text));
}

export function formatRecentOrderChoices(orders: OrderWithItems[]): string[] {
  return orders.map((order) => {
    const summary = order.items
      .slice(0, 2)
      .map((item) => `${item.quantity}x ${item.productName ?? "Producto"}`)
      .join(", ");
    return `${order.code} - ${summary || "sin items visibles"}`;
  });
}

export async function prepareRepeatOrder(params: {
  restaurantId: string;
  contactId: string;
  text: string;
  acceptedPaymentMethods: PaymentMethod[];
}): Promise<RepeatPreparationResult> {
  const requestedCode = extractRequestedOrderCode(params.text);
  const recentOrders = await getRecentOrdersForContact(params.contactId, 3);

  let sourceOrder: OrderWithItems | null;
  if (requestedCode) {
    sourceOrder = await getOrderByCodeForContact(params.contactId, requestedCode);
    if (!sourceOrder) {
      return {
        status: "NOT_FOUND",
        sourceOrder: null,
        recentOrders,
        activeCart: null,
        nextState: null,
        issues: [
          {
            itemName: requestedCode,
            reason: "ORDER_NOT_FOUND",
            message: `No encontre un pedido ${requestedCode} asociado a este cliente.`,
          },
        ],
      };
    }
  } else {
    sourceOrder = await getLatestOrderForContact(params.contactId);
  }

  if (!sourceOrder) {
    return {
      status: "NOT_FOUND",
      sourceOrder: null,
      recentOrders,
      activeCart: null,
      nextState: null,
      issues: [
        {
          itemName: "ultimo pedido",
          reason: "ORDER_NOT_FOUND",
          message: "No encontre pedidos previos asociados a este cliente.",
        },
      ],
    };
  }

  if (looksAmbiguousLoDeSiempre(params.text) && recentOrders.length >= 2) {
    const firstSignature = buildOrderSignature(recentOrders[0]!);
    const secondSignature = buildOrderSignature(recentOrders[1]!);
    if (firstSignature !== secondSignature) {
      return {
        status: "AMBIGUOUS",
        sourceOrder: null,
        recentOrders,
        activeCart: null,
        nextState: null,
        issues: [
          {
            itemName: "lo de siempre",
            reason: "ORDER_AMBIGUOUS",
            message: "No es claro si 'lo de siempre' se refiere a tu ultimo pedido o a otro reciente.",
          },
        ],
      };
    }
  }

  const allProducts = await listAllProductsForResolution(params.restaurantId);
  const priceById = await buildCurrentPriceMap(params.restaurantId, allProducts);
  const acceptedMethods = new Set(params.acceptedPaymentMethods);
  const paymentMethod =
    sourceOrder.paymentMethod && acceptedMethods.has(sourceOrder.paymentMethod as PaymentMethod)
      ? (sourceOrder.paymentMethod as PaymentMethod)
      : null;

  let activeCart: StructuredCartState = { items: [], lastReferencedItemId: null };
  const issues: RepeatPreparationIssue[] = [];

  for (const orderItem of sourceOrder.items) {
    const currentProduct = findCurrentProduct(orderItem, allProducts);
    const itemName = orderItem.productName ?? "Producto eliminado";

    if (!currentProduct) {
      issues.push({
        itemName,
        reason: "PRODUCT_NOT_FOUND",
        message: `${itemName} ya no existe en el catalogo actual.`,
      });
      continue;
    }

    if (!currentProduct.isAvailable) {
      issues.push({
        itemName,
        reason: "PRODUCT_UNAVAILABLE",
        message: `${currentProduct.name} no esta disponible ahora mismo.`,
      });
      continue;
    }

    const currentPrice = priceById.get(currentProduct.id) ?? currentProduct.price;
    const { cart, createdItemIds } = attachFreshItems(
      activeCart,
      {
        productId: currentProduct.id,
        productName: currentProduct.name,
        quantity: Math.max(1, orderItem.quantity),
        unitPrice: currentPrice,
      },
      allProducts,
      priceById,
    );
    activeCart = cart;

    const noteClauses = orderItem.notes ? splitInstructionClauses(orderItem.notes) : [];
    for (const itemId of createdItemIds) {
      activeCart = applyNoteClauses({
        cart: activeCart,
        clauses: noteClauses,
        itemId,
        allProducts,
        priceById,
        issues,
        itemName: currentProduct.name,
      });
    }
  }

  const inlineClauses = splitInstructionClauses(params.text).filter((clause) => !isRepeatOrderRequest(clause));
  const repeatTargetId = activeCart.items.at(-1)?.id ?? null;
  for (const clause of inlineClauses) {
    const instruction = parseStructuredCartInstruction(clause);
    if (!instruction || !repeatTargetId) continue;
    const result = applyStructuredCartInstruction(
      activeCart,
      { ...instruction, target: instruction.target.kind === "UNSPECIFIED" ? { kind: "LAST_ITEM" } : instruction.target },
      allProducts,
      priceById,
    );
    activeCart = result.updatedCart;
    if (!result.ok) {
      issues.push({
        itemName: sourceOrder.code,
        reason: "MODIFIER_INVALID",
        message: result.message,
      });
    }
  }

  if (activeCart.items.length === 0) {
    return {
      status: "EMPTY",
      sourceOrder,
      recentOrders,
      activeCart: null,
      nextState: null,
      issues,
    };
  }

  const nextState = cloneStateWithDeliveryCandidate(sourceOrder, paymentMethod, params.text);
  nextState.cart = exportStructuredCartLines(activeCart);

  return {
    status: issues.length > 0 ? "PARTIAL" : "READY",
    sourceOrder,
    recentOrders,
    activeCart,
    nextState,
    issues,
  };
}

export function summarizeRepeatPreparation(result: RepeatPreparationResult): string[] {
  if (!result.sourceOrder || !result.activeCart || !result.nextState) {
    return result.issues.map((issue) => issue.message);
  }

  return [
    `Tome como referencia el pedido ${result.sourceOrder.code}.`,
    ...result.issues.map((issue) => issue.message),
    ...summarizeStructuredCart(result.activeCart),
  ];
}
