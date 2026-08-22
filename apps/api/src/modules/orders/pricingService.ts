import type { DeliveryType, ProductDTO } from "@pollos/shared";
import { listCatalog, getEffectivePrice } from "../products/productService.js";
import type { StructuredCartComponent, StructuredCartItem, StructuredCartState } from "../conversation/structuredCart.js";
import type { CartLine } from "./orderService.js";

export interface PricingModifierBreakdown {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface PricingItemBreakdown {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  modifiers: PricingModifierBreakdown[];
  notes: string | null;
  subtotal: number;
}

export interface PricingValidationIssue {
  code:
    | "PRODUCT_NOT_FOUND"
    | "PRODUCT_UNAVAILABLE"
    | "COMPONENT_NOT_FOUND"
    | "COMPONENT_UNAVAILABLE"
    | "COMPONENT_INCOMPATIBLE";
  message: string;
}

export interface CartPricingResult {
  items: PricingItemBreakdown[];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  tax: number;
  total: number;
  currency: string;
  valid: boolean;
  issues: PricingValidationIssue[];
  priceChanged: boolean;
  changedMessages: string[];
  repricedCartLines: CartLine[];
  repricedActiveCart: StructuredCartState | null;
}

function cloneComponent(component: StructuredCartComponent): StructuredCartComponent {
  return { ...component };
}

function cloneItem(item: StructuredCartItem): StructuredCartItem {
  return {
    ...item,
    components: item.components.map(cloneComponent),
    notes: [...item.notes],
  };
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function summarizeItemNotes(item: StructuredCartItem): string | null {
  const removed = item.components
    .filter((component) => component.status === "REMOVED")
    .map((component) => `sin ${component.productName}`);
  const added = item.components
    .filter((component) => component.status === "ACTIVE" && component.source === "ADDED")
    .map((component) => `${component.quantity > 1 ? `${component.quantity}x ` : ""}${component.productName}`);
  const notes = [...removed, ...added, ...item.notes];
  return notes.length > 0 ? notes.join(", ") : null;
}

function toCartLine(item: StructuredCartItem): CartLine {
  return {
    productId: item.productId,
    productName: item.productName,
    quantity: 1,
    unitPrice: item.unitPrice,
    notes: summarizeItemNotes(item),
  };
}

function canAttachComponent(item: StructuredCartItem, component: ProductDTO): boolean {
  const category = normalize(component.categoryName);
  if (category.includes("salsa")) return true;
  if (
    item.components.some(
      (candidate) =>
        candidate.productId !== component.id &&
        normalize(candidate.categoryName ?? "") === category,
    )
  ) {
    return true;
  }
  return false;
}

async function buildCatalogMaps() {
  const categories = await listCatalog();
  const allProducts = categories.flatMap((category) => category.products);
  const byId = new Map(allProducts.map((product) => [product.id, product]));
  const currentPriceById = new Map<string, number>();
  for (const product of allProducts) {
    currentPriceById.set(product.id, await getEffectivePrice(product.id, product.price));
  }
  return { allProducts, byId, currentPriceById };
}

function toStructuredCartFromLegacy(cart: CartLine[]): StructuredCartState {
  return {
    items: cart.flatMap((line) =>
      Array.from({ length: Math.max(1, line.quantity) }, () => ({
        id: `legacy_${Math.random().toString(36).slice(2, 10)}`,
        productId: line.productId,
        productName: line.productName,
        categoryName: null,
        unitPrice: line.unitPrice,
        components: [],
        notes: line.notes ? [line.notes] : [],
      })),
    ),
    lastReferencedItemId: null,
  };
}

function pairReplacementComponent(item: StructuredCartItem, component: StructuredCartComponent): StructuredCartComponent | null {
  if (component.source !== "ADDED" || component.status !== "ACTIVE") return null;
  return (
    item.components.find(
      (candidate) =>
        candidate.status === "REMOVED" &&
        candidate.source === "INCLUDED" &&
        normalize(candidate.categoryName ?? "") === normalize(component.categoryName ?? ""),
    ) ?? null
  );
}

export async function calculateCartPricing(params: {
  cart: CartLine[];
  activeCart?: StructuredCartState | null;
  deliveryType: DeliveryType | null;
  currency: string;
  businessDeliveryFee: number;
}): Promise<CartPricingResult> {
  const { byId, currentPriceById } = await buildCatalogMaps();
  const sourceCart = params.activeCart ? { items: params.activeCart.items.map(cloneItem), lastReferencedItemId: params.activeCart.lastReferencedItemId } : toStructuredCartFromLegacy(params.cart);
  const issues: PricingValidationIssue[] = [];
  const changedMessages: string[] = [];
  const repricedItems: StructuredCartItem[] = [];
  const items: PricingItemBreakdown[] = [];
  let subtotal = 0;
  let discount = 0;
  let priceChanged = false;

  for (const sourceItem of sourceCart.items) {
    const product = byId.get(sourceItem.productId);
    if (!product) {
      issues.push({ code: "PRODUCT_NOT_FOUND", message: `El producto ${sourceItem.productName} ya no existe.` });
      continue;
    }
    if (!product.isAvailable) {
      issues.push({ code: "PRODUCT_UNAVAILABLE", message: `${product.name} no esta disponible ahora mismo.` });
      continue;
    }

    const currentBasePrice = currentPriceById.get(product.id) ?? product.price;
    if (sourceItem.unitPrice !== currentBasePrice) {
      priceChanged = true;
      changedMessages.push(`El precio de ${product.name} cambio de ${sourceItem.unitPrice} a ${currentBasePrice}.`);
    }

    const repricedItem: StructuredCartItem = {
      ...sourceItem,
      productName: product.name,
      categoryName: product.categoryName,
      unitPrice: currentBasePrice,
      components: sourceItem.components.map(cloneComponent),
      notes: [...sourceItem.notes],
    };

    const modifiers: PricingModifierBreakdown[] = [];
    let lineSubtotal = currentBasePrice;
    discount += Math.max(0, product.price - currentBasePrice);

    for (const component of repricedItem.components) {
      if (!component.productId) continue;
      const componentProduct = byId.get(component.productId);
      if (!componentProduct) {
        issues.push({ code: "COMPONENT_NOT_FOUND", message: `El componente ${component.productName} ya no existe.` });
        continue;
      }
      if (!componentProduct.isAvailable) {
        issues.push({ code: "COMPONENT_UNAVAILABLE", message: `${componentProduct.name} no esta disponible ahora mismo.` });
        continue;
      }
      if (component.source === "ADDED" && !canAttachComponent(repricedItem, componentProduct)) {
        issues.push({
          code: "COMPONENT_INCOMPATIBLE",
          message: `${componentProduct.name} no es compatible con ${product.name}.`,
        });
        continue;
      }

      const currentComponentPrice = currentPriceById.get(componentProduct.id) ?? componentProduct.price;
      if (component.unitPrice !== currentComponentPrice) {
        priceChanged = true;
        changedMessages.push(`El precio de ${componentProduct.name} cambio de ${component.unitPrice} a ${currentComponentPrice}.`);
      }
      component.productName = componentProduct.name;
      component.categoryName = componentProduct.categoryName;
      component.unitPrice = currentComponentPrice;

      if (component.status === "REMOVED") {
        modifiers.push({ name: `Sin ${component.productName}`, quantity: component.quantity, unitPrice: 0, total: 0 });
        continue;
      }

      if (component.source === "ADDED") {
        const replaced = pairReplacementComponent(repricedItem, component);
        const replacementDelta = replaced ? currentComponentPrice - replaced.unitPrice : currentComponentPrice;
        const total = replacementDelta * component.quantity;
        modifiers.push({
          name: replaced ? `Cambio ${replaced.productName} por ${component.productName}` : component.productName,
          quantity: component.quantity,
          unitPrice: replacementDelta,
          total,
        });
        lineSubtotal += total;
      }
    }

    repricedItems.push(repricedItem);
    subtotal += lineSubtotal;
    items.push({
      productId: product.id,
      productName: product.name,
      quantity: 1,
      unitPrice: currentBasePrice,
      modifiers,
      notes: summarizeItemNotes(repricedItem),
      subtotal: lineSubtotal,
    });
  }

  const deliveryFee = params.deliveryType === "DELIVERY" ? params.businessDeliveryFee : 0;
  const tax = 0;
  const total = subtotal + deliveryFee + tax;

  return {
    items,
    subtotal,
    discount,
    deliveryFee,
    tax,
    total,
    currency: params.currency,
    valid: issues.length === 0,
    issues,
    priceChanged,
    changedMessages,
    repricedCartLines: repricedItems.map(toCartLine),
    repricedActiveCart: params.activeCart
      ? { items: repricedItems, lastReferencedItemId: sourceCart.lastReferencedItemId }
      : null,
  };
}

export function formatCartPricingFacts(pricing: CartPricingResult): string[] {
  const facts: string[] = [];

  for (const item of pricing.items) {
    facts.push(`${item.quantity}x ${item.productName} - ${item.subtotal.toLocaleString("es-CO")} ${pricing.currency}`);
    for (const modifier of item.modifiers) {
      const sign = modifier.total >= 0 ? "+" : "-";
      facts.push(
        `${modifier.name}${modifier.total === 0 ? "" : ` ${sign}${Math.abs(modifier.total).toLocaleString("es-CO")} ${pricing.currency}`}`,
      );
    }
  }

  facts.push(`Subtotal: ${pricing.subtotal.toLocaleString("es-CO")} ${pricing.currency}`);
  if (pricing.discount > 0) {
    facts.push(`Descuento aplicado: -${pricing.discount.toLocaleString("es-CO")} ${pricing.currency}`);
  }
  if (pricing.deliveryFee > 0) {
    facts.push(`Domicilio: ${pricing.deliveryFee.toLocaleString("es-CO")} ${pricing.currency}`);
  }
  if (pricing.tax > 0) {
    facts.push(`Impuestos: ${pricing.tax.toLocaleString("es-CO")} ${pricing.currency}`);
  }
  facts.push(`Total: ${pricing.total.toLocaleString("es-CO")} ${pricing.currency}`);
  return facts;
}
