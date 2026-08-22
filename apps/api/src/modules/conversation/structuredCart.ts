import type { ComboItemDTO, ProductDTO } from "@pollos/shared";
import type { CartLine } from "../orders/orderService.js";
import { normalizeLocalizedText } from "../localization/localeService.js";
import { resolveProductReferenceFromProducts } from "../products/productService.js";

export interface StructuredCartComponent {
  id: string;
  productId: string | null;
  productName: string;
  categoryName: string | null;
  quantity: number;
  unitPrice: number;
  source: "INCLUDED" | "ADDED";
  status: "ACTIVE" | "REMOVED";
}

export interface StructuredCartItem {
  id: string;
  productId: string;
  productName: string;
  categoryName: string | null;
  unitPrice: number;
  components: StructuredCartComponent[];
  notes: string[];
}

export interface StructuredCartState {
  items: StructuredCartItem[];
  lastReferencedItemId: string | null;
}

export interface StructuredCartSnapshotItem {
  itemId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  notes: string | null;
  components: Array<{
    componentId: string;
    productId: string | null;
    productName: string;
    categoryName: string | null;
    quantity: number;
    unitPrice: number;
    source: "INCLUDED" | "ADDED";
    status: "ACTIVE" | "REMOVED";
  }>;
}

export interface StructuredCartInstruction {
  type: "REMOVE_COMPONENT" | "ADD_COMPONENT" | "REPLACE_COMPONENT" | "DUPLICATE_ITEM" | "SET_GROUP_QUANTITY";
  target:
    | { kind: "ORDINAL"; ordinal: number }
    | { kind: "ITEM_ID"; itemId: string }
    | { kind: "LAST_REFERENCED" }
    | { kind: "LAST_ITEM" }
    | { kind: "UNSPECIFIED" };
  componentText?: string;
  replacementText?: string;
  quantity?: number;
}

export interface StructuredCartActionResult {
  ok: boolean;
  updatedCart: StructuredCartState;
  message: string;
  requiresClarification?: boolean;
}

export interface DistributedFlavorSelection {
  productId: string;
  productName: string;
  quantity: number;
}

export type DistributedFlavorResolution =
  | { status: "OK"; selections: DistributedFlavorSelection[] }
  | { status: "INVALID_TOTAL"; message: string; selections: DistributedFlavorSelection[] }
  | { status: "AMBIGUOUS"; message: string; selections: DistributedFlavorSelection[] }
  | { status: "NOT_FOUND"; message: string; selections: DistributedFlavorSelection[] };

export const EMPTY_STRUCTURED_CART: StructuredCartState = {
  items: [],
  lastReferencedItemId: null,
};

function nextId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalize(value: string): string {
  return normalizeLocalizedText(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .toLowerCase()
    .trim();
}

function cloneItem(item: StructuredCartItem): StructuredCartItem {
  return {
    ...item,
    id: nextId("item"),
    components: item.components.map((component) => ({ ...component, id: nextId("component") })),
    notes: [...item.notes],
  };
}

function buildIncludedComponents(
  product: ProductDTO,
  allProducts: ProductDTO[],
  priceById: Map<string, number>,
): StructuredCartComponent[] {
  if (!product.isCombo || product.comboItems.length === 0) return [];

  return product.comboItems.map((comboItem) => {
    const componentProduct = allProducts.find((candidate) => candidate.id === comboItem.productId);
    return {
      id: nextId("component"),
      productId: comboItem.productId,
      productName: comboItem.productName,
      categoryName: componentProduct?.categoryName ?? null,
      quantity: comboItem.quantity,
      unitPrice: priceById.get(comboItem.productId) ?? componentProduct?.price ?? 0,
      source: "INCLUDED",
      status: "ACTIVE",
    };
  });
}

export function createStructuredCartFromLegacyLines(
  lines: CartLine[],
  allProducts: ProductDTO[],
  priceById: Map<string, number>,
): StructuredCartState {
  const items: StructuredCartItem[] = [];

  for (const line of lines) {
    const product = allProducts.find((candidate) => candidate.id === line.productId);
    const quantity = Math.max(1, line.quantity);
    for (let index = 0; index < quantity; index += 1) {
      items.push({
        id: nextId("item"),
        productId: line.productId,
        productName: line.productName,
        categoryName: product?.categoryName ?? null,
        unitPrice: line.unitPrice,
        components: product ? buildIncludedComponents(product, allProducts, priceById) : [],
        notes: line.notes ? [line.notes] : [],
      });
    }
  }

  return {
    items,
    lastReferencedItemId: items.at(-1)?.id ?? null,
  };
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

export function exportStructuredCartLines(cart: StructuredCartState): CartLine[] {
  return cart.items.map((item) => ({
    productId: item.productId,
    productName: item.productName,
    quantity: 1,
    unitPrice: item.unitPrice,
    notes: summarizeItemNotes(item),
  }));
}

export function getStructuredCartSnapshot(cart: StructuredCartState): StructuredCartSnapshotItem[] {
  return cart.items.map((item) => ({
    itemId: item.id,
    productId: item.productId,
    productName: item.productName,
    quantity: 1,
    unitPrice: item.unitPrice,
    notes: summarizeItemNotes(item),
    components: item.components.map((component) => ({
      componentId: component.id,
      productId: component.productId,
      productName: component.productName,
      categoryName: component.categoryName,
      quantity: component.quantity,
      unitPrice: component.unitPrice,
      source: component.source,
      status: component.status,
    })),
  }));
}

function resolveTargetItem(cart: StructuredCartState, target: StructuredCartInstruction["target"]): StructuredCartItem | null {
  if (cart.items.length === 0) return null;

  if (target.kind === "ITEM_ID") {
    return cart.items.find((item) => item.id === target.itemId) ?? null;
  }
  if (target.kind === "ORDINAL") {
    return cart.items[target.ordinal - 1] ?? null;
  }
  if (target.kind === "LAST_REFERENCED" && cart.lastReferencedItemId) {
    return cart.items.find((item) => item.id === cart.lastReferencedItemId) ?? cart.items.at(-1) ?? null;
  }
  return cart.items.at(-1) ?? null;
}

function componentMatches(component: StructuredCartComponent, text: string): boolean {
  const candidate = normalize(text);
  if (!candidate) return false;
  if (component.categoryName && normalize(component.categoryName).includes(candidate)) return true;
  if (candidate.includes("bebida") && component.categoryName && normalize(component.categoryName).includes("bebida")) return true;
  return normalize(component.productName).includes(candidate) || candidate.includes(normalize(component.productName));
}

function canAttachComponent(item: StructuredCartItem, component: ProductDTO): boolean {
  const category = normalize(component.categoryName);
  if (category.includes("salsa")) return true;
  return item.components.some(
    (candidate) => candidate.productId !== component.id && normalize(candidate.categoryName ?? "") === category,
  );
}

function findMatchingProduct(text: string, allProducts: ProductDTO[]) {
  return resolveProductReferenceFromProducts(text, allProducts);
}

function formatCandidateOptions(products: ProductDTO[]): string {
  return products.slice(0, 4).map((product) => product.name).join(", ");
}

function isGenericModifierToken(token: string): boolean {
  return ["salsa", "salsas", "bebida", "bebidas", "acompanante", "acompanantes", "extra"].includes(token);
}

function ambiguousMatchIsActuallyTooWeak(text: string, products: ProductDTO[]): boolean {
  const queryTokens = normalize(text)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !isGenericModifierToken(token));
  if (queryTokens.length === 0) return false;
  return !products.some((product) => {
    const candidateTokens = normalize(`${product.name} ${product.searchKeywords ?? ""}`).split(/\s+/).filter(Boolean);
    return queryTokens.every((queryToken) => candidateTokens.includes(queryToken));
  });
}

function parseFlavorTerms(text: string): Array<{ quantity: number; name: string }> {
  const normalized = normalize(text).replace(/^\d+\s+alitas?\s*,?\s*/i, "");
  return normalized
    .split(/\s+y\s+|,\s*/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const match = chunk.match(/^(\d+)\s+(.+)$/);
      return match ? { quantity: Number(match[1]), name: match[2]!.trim() } : null;
    })
    .filter((match): match is { quantity: number; name: string } => Boolean(match));
}

export function resolveDistributedFlavorSelection(
  text: string,
  totalQuantity: number,
  availableFlavors: ProductDTO[],
): DistributedFlavorResolution {
  const normalized = normalize(text);
  if (totalQuantity <= 0) {
    return { status: "INVALID_TOTAL", message: "La cantidad total debe ser mayor a cero.", selections: [] };
  }

  if (/\bmitad\b/.test(normalized)) {
    const halvesMatch = normalized.match(/mitad\s+([a-z0-9]+)\s+mitad\s+([a-z0-9]+)/);
    const halves = halvesMatch ? [halvesMatch[1]!, halvesMatch[2]!] : [];
    if (halves.length !== 2) {
      return { status: "AMBIGUOUS", message: "No pude identificar claramente las dos mitades.", selections: [] };
    }
    if (totalQuantity % 2 !== 0) {
      return {
        status: "AMBIGUOUS",
        message: `Son ${totalQuantity}. Necesito que me diga como repartirlas porque no se pueden dividir exactamente en mitades.`,
        selections: [],
      };
    }

    const selections: DistributedFlavorSelection[] = [];
    for (const half of halves) {
      const result = resolveProductReferenceFromProducts(half, availableFlavors);
      if (result.status !== "MATCHED" || !result.product) {
        return {
          status: result.status === "AMBIGUOUS" ? "AMBIGUOUS" : "NOT_FOUND",
          message:
            result.status === "AMBIGUOUS"
              ? `Hay varias opciones para "${half}".`
              : `No encontre el sabor "${half}" en las opciones reales.`,
          selections: [],
        };
      }
      selections.push({
        productId: result.product.product.id,
        productName: result.product.product.name,
        quantity: totalQuantity / 2,
      });
    }
    return { status: "OK", selections };
  }

  const terms = parseFlavorTerms(text);
  if (terms.length === 0) {
    return { status: "NOT_FOUND", message: "No encontre una distribucion valida de sabores.", selections: [] };
  }

  const selections: DistributedFlavorSelection[] = [];
  for (const term of terms) {
    const result = resolveProductReferenceFromProducts(term.name, availableFlavors);
    if (result.status !== "MATCHED" || !result.product) {
      return {
        status: result.status === "AMBIGUOUS" ? "AMBIGUOUS" : "NOT_FOUND",
        message:
          result.status === "AMBIGUOUS"
            ? `Hay varias opciones para "${term.name}".`
            : `No encontre el sabor "${term.name}" en las opciones reales.`,
        selections: [],
      };
    }
    selections.push({
      productId: result.product.product.id,
      productName: result.product.product.name,
      quantity: term.quantity,
    });
  }

  const sum = selections.reduce((acc, selection) => acc + selection.quantity, 0);
  if (sum !== totalQuantity) {
    return {
      status: "INVALID_TOTAL",
      message: `La distribucion suma ${sum} y debe sumar ${totalQuantity}.`,
      selections,
    };
  }

  return { status: "OK", selections };
}

function duplicateItem(cart: StructuredCartState, source: StructuredCartItem, quantity: number): StructuredCartState {
  const items = [...cart.items];
  const copies = Math.max(1, quantity);
  for (let index = 0; index < copies; index += 1) {
    items.push(cloneItem(source));
  }
  return { items, lastReferencedItemId: items.at(-1)?.id ?? cart.lastReferencedItemId };
}

function updateItem(cart: StructuredCartState, updatedItem: StructuredCartItem): StructuredCartState {
  return {
    items: cart.items.map((item) => (item.id === updatedItem.id ? updatedItem : item)),
    lastReferencedItemId: updatedItem.id,
  };
}

function askAmbiguous(message: string, cart: StructuredCartState): StructuredCartActionResult {
  return {
    ok: false,
    updatedCart: cart,
    message,
    requiresClarification: true,
  };
}

export function applyStructuredCartInstruction(
  cart: StructuredCartState,
  instruction: StructuredCartInstruction,
  allProducts: ProductDTO[],
  priceById: Map<string, number>,
): StructuredCartActionResult {
  const targetItem = resolveTargetItem(cart, instruction.target);
  if (!targetItem) {
    return { ok: false, updatedCart: cart, message: "Todavia no hay productos en el pedido para modificar." };
  }

  if (instruction.type === "DUPLICATE_ITEM") {
    const updatedCart = duplicateItem(cart, targetItem, instruction.quantity ?? 1);
    return { ok: true, updatedCart, message: `Listo, duplique ${targetItem.productName}.` };
  }

  if (instruction.type === "SET_GROUP_QUANTITY") {
    const siblings = cart.items.filter((item) => item.productId === targetItem.productId);
    const desired = Math.max(1, instruction.quantity ?? 1);
    if (siblings.length === desired) {
      return { ok: true, updatedCart: cart, message: `Su pedido ya tenia ${desired} ${targetItem.productName}.` };
    }
    if (siblings.length < desired) {
      const updatedCart = duplicateItem(cart, targetItem, desired - siblings.length);
      return { ok: true, updatedCart, message: `Listo, deje ${desired} ${targetItem.productName}.` };
    }

    let removed = 0;
    const items = [...cart.items];
    for (let index = items.length - 1; index >= 0 && siblings.length - removed > desired; index -= 1) {
      if (items[index]?.productId === targetItem.productId) {
        items.splice(index, 1);
        removed += 1;
      }
    }
    return {
      ok: true,
      updatedCart: { items, lastReferencedItemId: items.at(-1)?.id ?? null },
      message: `Listo, deje ${desired} ${targetItem.productName}.`,
    };
  }

  if (!instruction.componentText) {
    return { ok: false, updatedCart: cart, message: "No logre identificar que componente queria cambiar." };
  }

  const targetComponents = targetItem.components.filter((component) => componentMatches(component, instruction.componentText!));

  if (instruction.type === "REMOVE_COMPONENT") {
    if (targetComponents.length === 0) {
      return { ok: false, updatedCart: cart, message: `No encontre ${instruction.componentText} en ${targetItem.productName}.` };
    }
    const updatedItem: StructuredCartItem = {
      ...targetItem,
      components: targetItem.components.map((component): StructuredCartComponent =>
        targetComponents.some((candidate) => candidate.id === component.id) ? { ...component, status: "REMOVED" as const } : component,
      ),
    };
    return {
      ok: true,
      updatedCart: updateItem(cart, updatedItem),
      message: `Listo, actualice ${targetItem.productName} sin ${instruction.componentText}.`,
    };
  }

  if (instruction.type === "ADD_COMPONENT") {
    const resolution = findMatchingProduct(instruction.componentText, allProducts);
    if (resolution.status === "AMBIGUOUS") {
      if (ambiguousMatchIsActuallyTooWeak(instruction.componentText, resolution.candidates.map((candidate) => candidate.product))) {
        return { ok: false, updatedCart: cart, message: `No encontre ${instruction.componentText} en el menu real.` };
      }
      return askAmbiguous(
        `Encontre varias opciones para ${instruction.componentText}: ${formatCandidateOptions(resolution.candidates.map((candidate) => candidate.product))}.`,
        cart,
      );
    }
    const product = resolution.product?.product ?? null;
    if (!product || resolution.status !== "MATCHED" || !resolution.product?.available) {
      return { ok: false, updatedCart: cart, message: `No encontre ${instruction.componentText} en el menu real.` };
    }
    if (!canAttachComponent(targetItem, product)) {
      return { ok: false, updatedCart: cart, message: `${product.name} no es un modificador valido para ${targetItem.productName}.` };
    }
    const updatedItem: StructuredCartItem = {
      ...targetItem,
      components: [
        ...targetItem.components,
        {
          id: nextId("component"),
          productId: product.id,
          productName: product.name,
          categoryName: product.categoryName,
          quantity: Math.max(1, instruction.quantity ?? 1),
          unitPrice: priceById.get(product.id) ?? product.price,
          source: "ADDED",
          status: "ACTIVE",
        },
      ],
    };
    return {
      ok: true,
      updatedCart: updateItem(cart, updatedItem),
      message: `Listo, agregue ${instruction.quantity && instruction.quantity > 1 ? `${instruction.quantity} ` : ""}${product.name} a ${targetItem.productName}.`,
    };
  }

  if (instruction.type === "REPLACE_COMPONENT") {
    if (targetComponents.length === 0) {
      return { ok: false, updatedCart: cart, message: `No encontre ${instruction.componentText} en ${targetItem.productName}.` };
    }
    if (!instruction.replacementText) {
      return askAmbiguous(`Â¿Por cual producto real desea cambiar ${instruction.componentText}?`, cart);
    }
    const resolution = findMatchingProduct(instruction.replacementText, allProducts);
    if (resolution.status === "AMBIGUOUS") {
      if (ambiguousMatchIsActuallyTooWeak(instruction.replacementText, resolution.candidates.map((candidate) => candidate.product))) {
        return { ok: false, updatedCart: cart, message: `No encontre ${instruction.replacementText} en el menu real.` };
      }
      return askAmbiguous(
        `Encontre varias opciones para ${instruction.replacementText}: ${formatCandidateOptions(resolution.candidates.map((candidate) => candidate.product))}.`,
        cart,
      );
    }
    const replacement = resolution.product?.product ?? null;
    if (!replacement || resolution.status !== "MATCHED" || !resolution.product?.available) {
      return { ok: false, updatedCart: cart, message: `No encontre ${instruction.replacementText} en el menu real.` };
    }
    if (!canAttachComponent(targetItem, replacement)) {
      return { ok: false, updatedCart: cart, message: `${replacement.name} no es un reemplazo valido para ${targetItem.productName}.` };
    }
    const previous = targetComponents[0]!;
    const replacedComponents: StructuredCartComponent[] = targetItem.components.map((component) =>
      component.id === previous.id ? { ...component, status: "REMOVED" as const } : component,
    );
    const updatedItem: StructuredCartItem = {
      ...targetItem,
      components: [
        ...replacedComponents,
        {
          id: nextId("component"),
          productId: replacement.id,
          productName: replacement.name,
          categoryName: replacement.categoryName,
          quantity: previous.quantity,
          unitPrice: priceById.get(replacement.id) ?? replacement.price,
          source: "ADDED",
          status: "ACTIVE" as const,
        },
      ],
    };
    return {
      ok: true,
      updatedCart: updateItem(cart, updatedItem),
      message: `Listo, cambie ${previous.productName} por ${replacement.name} en ${targetItem.productName}.`,
    };
  }

  return { ok: false, updatedCart: cart, message: "No pude aplicar ese cambio al carrito." };
}

function extractOrdinalTarget(text: string): StructuredCartInstruction["target"] {
  const normalized = normalize(text);
  if (/\bprimer[oa]?\b|\bal primero\b/.test(normalized)) return { kind: "ORDINAL", ordinal: 1 };
  if (/\bsegund[oa]?\b|\bal segundo\b/.test(normalized)) return { kind: "ORDINAL", ordinal: 2 };
  if (/\btercer[oa]?\b|\bal tercero\b/.test(normalized)) return { kind: "ORDINAL", ordinal: 3 };
  if (/\bultim[oa]\b/.test(normalized)) return { kind: "LAST_ITEM" };
  return { kind: "LAST_REFERENCED" };
}

function extractQuantity(text: string): number | undefined {
  const direct = text.match(/\b(\d+)\b/);
  if (direct) return Number(direct[1]);
  if (/\buno?\b/.test(normalize(text))) return 1;
  if (/\bdos\b/.test(normalize(text))) return 2;
  if (/\btres\b/.test(normalize(text))) return 3;
  return undefined;
}

function extractAfterKeyword(text: string, regex: RegExp): string | undefined {
  const match = text.match(regex);
  return match?.[1]?.trim() || undefined;
}

export function parseStructuredCartInstruction(text: string): StructuredCartInstruction | null {
  const normalized = normalize(text);
  const target = extractOrdinalTarget(normalized);

  if (/\botro igual\b|\bel mismo\b|\botro igual al\b/.test(normalized)) {
    return { type: "DUPLICATE_ITEM", target, quantity: 1 };
  }

  if (/\bmejor deme uno\b|\buno solo\b|\bdeme uno solo\b/.test(normalized)) {
    return { type: "SET_GROUP_QUANTITY", target, quantity: 1 };
  }

  if (/\bcambi\w+\b.*\bpor\b/.test(normalized)) {
    const source = extractAfterKeyword(text, /cambi\w+(?:me|le)?\s+(?:las|los|la|el)?\s*(.+?)\s+por\s+/i);
    const replacement = extractAfterKeyword(text, /\bpor\s+(.+)$/i);
    return { type: "REPLACE_COMPONENT", target, componentText: source, replacementText: replacement };
  }

  if (/\bcambi\w+\b/.test(normalized)) {
    const source = extractAfterKeyword(text, /cambi\w+(?:me|le)?\s+(?:las|los|la|el)?\s*(.+)$/i);
    return { type: "REPLACE_COMPONENT", target, componentText: source };
  }

  if (/\bquite\b|\bquitele\b|\bquiteme\b|\bquitale\b|\bsin\b|\bno le eche\b/.test(normalized)) {
    const componentText =
      extractAfterKeyword(text, /(?:qu(?:i|Ã­|í)te(?:me|le)?|quitale|sin|no le eche)\s+(?:las|los|la|el)?\s*(.+)$/i) ??
      extractAfterKeyword(text, /(?:qu(?:i|Ã­|í)te(?:me|le)?|quitale)\s+(?:las|los|la|el)?\s*(.+)$/i);
    return { type: "REMOVE_COMPONENT", target, componentText };
  }

  if (/\bpongale\b|\bpÃ³ngale\b|\becheme\b|\bcon\b|\bextra\b/.test(normalized)) {
    const componentText =
      extractAfterKeyword(text, /(?:p[oÃ³ó]ngale|pongale|echeme|extra)\s+(?:\d+\s+)?(.+)$/i) ??
      extractAfterKeyword(text, /\bcon\s+(.+)$/i);
    return { type: "ADD_COMPONENT", target, componentText, quantity: extractQuantity(text) };
  }

  return null;
}

export function summarizeStructuredCart(cart: StructuredCartState): string[] {
  return cart.items.map((item, index) => {
    const note = summarizeItemNotes(item);
    return `${index + 1}. ${item.productName}${note ? ` (${note})` : ""}`;
  });
}

