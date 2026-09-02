import { OrderFlowStep, type ProductDTO } from "@pollos/shared";
import { prisma } from "../../db/prisma.js";
import { normalizeLocalizedText } from "../localization/localeService.js";
import { getEffectivePrice, listAllProductsForResolution } from "../products/productService.js";
import type { StructuredCartState } from "./structuredCart.js";

/**
 * Upsell/cross-sell 100% backend-decidido: la IA nunca elige el producto, el precio ni
 * la promocion, solo redacta la oferta ya resuelta aqui (mismo patron que
 * generateResponse({facts, askNext}) en el resto del proyecto). Ver docs/UPSELLING.md.
 */

export type RecommendationReason = "UPSELL" | "CROSS_SELL" | "ADD_ON";

export interface RecommendationRuleInput {
  id: string;
  sourceProductId: string | null;
  sourceCategoryId: string | null;
  recommendedProductId: string;
  recommendationType: RecommendationReason;
  priority: number;
  active: boolean;
}

export interface CartRecommendationOffer {
  productId: string;
  name: string;
  price: number;
  reason: RecommendationReason;
  ruleId: string;
}

/**
 * Seleccion pura y deterministica del carrito -> a lo sumo UNA recomendacion elegible.
 * Nunca usa aleatoriedad ni IA. Orden de prioridad:
 *  1) regla de producto explicita que matchea un producto ya en el carrito (priority desc).
 *  2) regla de categoria explicita que matchea la categoria de un producto en el carrito (priority desc).
 *  3) nada (array/valor vacio es un resultado valido y esperado).
 */
export function selectCartRecommendation(params: {
  cartProductIds: string[];
  rejectedProductIds: string[];
  allProducts: ProductDTO[];
  rules: RecommendationRuleInput[];
  priceById: Map<string, number>;
}): CartRecommendationOffer | null {
  const { cartProductIds, rejectedProductIds, allProducts, rules, priceById } = params;
  const productById = new Map(allProducts.map((product) => [product.id, product]));
  const cartIdSet = new Set(cartProductIds);
  const rejectedSet = new Set(rejectedProductIds);

  const cartCategoryIds = new Set(
    cartProductIds.map((id) => productById.get(id)?.categoryId).filter((id): id is string => Boolean(id)),
  );

  function isEligible(rule: RecommendationRuleInput): boolean {
    if (!rule.active) return false;
    const recommended = productById.get(rule.recommendedProductId);
    if (!recommended || !recommended.isAvailable) return false;
    if (cartIdSet.has(rule.recommendedProductId)) return false;
    if (rejectedSet.has(rule.recommendedProductId)) return false;
    return true;
  }

  function toOffer(rule: RecommendationRuleInput): CartRecommendationOffer {
    const recommended = productById.get(rule.recommendedProductId)!;
    const price = priceById.get(rule.recommendedProductId) ?? recommended.price;
    return {
      productId: recommended.id,
      name: recommended.name,
      price,
      reason: rule.recommendationType,
      ruleId: rule.id,
    };
  }

  const productLevelRules = rules
    .filter((rule) => rule.sourceProductId && cartIdSet.has(rule.sourceProductId) && isEligible(rule))
    .sort((a, b) => b.priority - a.priority);
  if (productLevelRules[0]) return toOffer(productLevelRules[0]);

  const categoryLevelRules = rules
    .filter((rule) => rule.sourceCategoryId && cartCategoryIds.has(rule.sourceCategoryId) && isEligible(rule))
    .sort((a, b) => b.priority - a.priority);
  if (categoryLevelRules[0]) return toOffer(categoryLevelRules[0]);

  return null;
}

function toRuleInput(row: {
  id: string;
  sourceProductId: string | null;
  sourceCategoryId: string | null;
  recommendedProductId: string;
  recommendationType: string;
  priority: number;
  active: boolean;
}): RecommendationRuleInput {
  return {
    id: row.id,
    sourceProductId: row.sourceProductId,
    sourceCategoryId: row.sourceCategoryId,
    recommendedProductId: row.recommendedProductId,
    recommendationType: row.recommendationType as RecommendationReason,
    priority: row.priority,
    active: row.active,
  };
}

/**
 * Version conectada a base de datos de selectCartRecommendation: carga catalogo, reglas
 * activas y precios vigentes (con promo del dia via getEffectivePrice) y devuelve a lo
 * sumo un elemento (nunca mas de una oferta por llamada, ver docs/UPSELLING.md).
 */
export async function getCartRecommendations(params: {
  restaurantId: string;
  cart: StructuredCartState;
  rejectedProductIds: string[];
}): Promise<CartRecommendationOffer[]> {
  if (!params.cart.items.length) return [];

  const [allProducts, ruleRows] = await Promise.all([
    listAllProductsForResolution(params.restaurantId),
    prisma.productRecommendation.findMany({ where: { restaurantId: params.restaurantId, active: true } }),
  ]);

  const cartProductIds = [...new Set(params.cart.items.map((item) => item.productId))];
  const rules = ruleRows.map(toRuleInput);

  const priceById = new Map<string, number>();
  const candidateProductIds = new Set([
    ...rules.filter((r) => r.sourceProductId && cartProductIds.includes(r.sourceProductId)).map((r) => r.recommendedProductId),
    ...rules.map((r) => r.recommendedProductId),
  ]);
  for (const productId of candidateProductIds) {
    const product = allProducts.find((candidate) => candidate.id === productId);
    if (product) {
      priceById.set(productId, await getEffectivePrice(params.restaurantId, productId, product.price));
    }
  }

  const offer = selectCartRecommendation({
    cartProductIds,
    rejectedProductIds: params.rejectedProductIds,
    allProducts,
    rules,
    priceById,
  });
  return offer ? [offer] : [];
}

/**
 * Punto seguro para ofrecer upsell: solo justo cuando el producto principal + acompanantes/
 * bebidas quedaron resueltos ESTE turno (transicion a ASK_MORE_ITEMS), nunca durante
 * checkout/confirmacion ni en turnos donde no hubo avance real del carrito. Pura y exportada
 * para poder probarla sin mockear todo conversationService.ts.
 */
export function shouldOfferUpsellThisTurn(params: {
  stepBeforeTurn: string;
  nextStep: string;
  orderCreated: boolean;
}): boolean {
  return (
    !params.orderCreated &&
    params.nextStep === OrderFlowStep.ASK_MORE_ITEMS &&
    params.stepBeforeTurn !== OrderFlowStep.ASK_MORE_ITEMS
  );
}

// ---------- Frases del cliente (mismo patron que cartRecoveryService.ts) ----------

function normalize(text: string): string {
  return normalizeLocalizedText(text ?? "").trim();
}

const ACCEPT_PATTERNS = [
  /\bde una\b/i,
  /\bh[aá]gale\b/i,
  /\bh[eé]chela\b/i,
  /\bagr[eé]guela\b/i,
  /\bagr[eé]guelo\b/i,
  /\bs[ií] se[ñn]or\b/i,
  /\bmande eso\b/i,
  /\bdele pues\b/i,
  /\bs[ií]\s*porfa\b/i,
  /\bclaro que s[ií]\b/i,
  /^\s*si\s*$/i,
  /^\s*s[ií]\s*$/i,
  /^\s*(ok|okay|vale|listo|dale)\s*$/i,
];

const REJECT_PATTERNS = [
  /\bno se[ñn]or\b/i,
  /\bd[eé]jelo as[ií]\b/i,
  /\bas[ií] est[aá] bien\b/i,
  /\bno gracias\b/i,
  /\bnada m[aá]s\b/i,
  /\bsolo eso\b/i,
  /\beso es todo\b/i,
  /^\s*no\s*$/i,
];

/** "nada mas"/"solo eso" suspenden CUALQUIER oferta futura de este carrito, no solo rechazan la actual. */
const SUSPEND_ALL_PATTERNS = [/\bnada m[aá]s\b/i, /\bsolo eso\b/i, /\beso es todo\b/i];

const OPT_OUT_PATTERNS = [/\bsin adicionales\b/i, /\bno me ofrezca m[aá]s\b/i, /\bno me ofrezcan m[aá]s\b/i, ...SUSPEND_ALL_PATTERNS];

export function isUpsellAcceptMessage(text: string): boolean {
  const normalized = normalize(text);
  if (REJECT_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  return ACCEPT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isUpsellRejectMessage(text: string): boolean {
  return REJECT_PATTERNS.some((pattern) => pattern.test(normalize(text)));
}

export function isUpsellSuspendAllMessage(text: string): boolean {
  return SUSPEND_ALL_PATTERNS.some((pattern) => pattern.test(normalize(text)));
}

/** El cliente pidio explicitamente que no le ofrezcan mas adicionales este carrito (independiente de si hay oferta pendiente). */
export function isUpsellOptOutMessage(text: string): boolean {
  return OPT_OUT_PATTERNS.some((pattern) => pattern.test(normalize(text)));
}

export async function createUpsellAuditEvent(
  conversationId: string,
  eventType: "UPSELL_OFFERED" | "UPSELL_ACCEPTED" | "UPSELL_REJECTED" | "UPSELL_UNAVAILABLE",
  note?: string | null,
): Promise<void> {
  await prisma.conversationAuditEvent.create({
    data: {
      conversationId,
      adminUserId: null,
      eventType,
      reason: null,
      note: note ?? null,
    },
  });
}
