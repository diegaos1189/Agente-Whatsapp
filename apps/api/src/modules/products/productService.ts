import { prisma } from "../../db/prisma.js";
import type { CategoryDTO, ComboItemDTO, ProductDTO, PromotionDTO } from "@pollos/shared";
import { normalizeText } from "../../utils/text.js";
import { logger } from "../../utils/logger.js";
import { deriveLocalizedAliasVariants, normalizeLocalizedText } from "../localization/localeService.js";

const CACHE_TTL_MS = 30_000;
let catalogCache: { value: CategoryDTO[]; expiresAt: number } | null = null;

export type ProductResolutionStatus = "MATCHED" | "AMBIGUOUS" | "NOT_FOUND";
export type ProductMatchSource =
  | "EXACT_NAME"
  | "EXACT_ALIAS"
  | "EXACT_NORMALIZED"
  | "ALIAS_NORMALIZED"
  | "TOKEN"
  | "FUZZY";

export interface ProductResolutionCandidate {
  product: ProductDTO;
  confidence: number;
  matchedBy: ProductMatchSource;
  available: boolean;
  aliases: string[];
}

export interface ProductResolutionResult {
  status: ProductResolutionStatus;
  query: string;
  normalizedQuery: string;
  product: ProductResolutionCandidate | null;
  candidates: ProductResolutionCandidate[];
  suggestions: ProductResolutionCandidate[];
}

const NUMBER_WORDS: Record<string, string> = {
  cero: "0",
  un: "1",
  uno: "1",
  una: "1",
  dos: "2",
  tres: "3",
  cuatro: "4",
  cinco: "5",
  seis: "6",
  siete: "7",
  ocho: "8",
  nueve: "9",
  diez: "10",
  once: "11",
  doce: "12",
  trece: "13",
  catorce: "14",
  quince: "15",
  dieciseis: "16",
  diecisiete: "17",
  dieciocho: "18",
  diecinueve: "19",
  veinte: "20",
  medio: "0.5",
  media: "0.5",
};

/** Interpreta el JSON crudo de comboItems ([{productId, quantity}]) y resuelve nombres reales. */
function resolveComboItems(raw: unknown, nameById: Map<string, string>): ComboItemDTO[] {
  if (!Array.isArray(raw)) return [];
  const items: ComboItemDTO[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const productId = (entry as { productId?: unknown }).productId;
    const quantity = (entry as { quantity?: unknown }).quantity;
    if (typeof productId !== "string") continue;
    const productName = nameById.get(productId);
    if (!productName) continue;
    items.push({ productId, productName, quantity: typeof quantity === "number" && quantity > 0 ? quantity : 1 });
  }
  return items.slice(0, 6);
}

function productToDTO(
  p: {
    id: string;
    categoryId: string;
    name: string;
    description: string | null;
    price: number;
    isAvailable: boolean;
    sortOrder: number;
    isDefaultVariant: boolean;
    searchKeywords: string | null;
    unitCount: number | null;
    isCombo: boolean;
    comboItems: unknown;
    showInMenu: boolean;
  },
  categoryName: string,
  nameById: Map<string, string>,
): ProductDTO {
  return {
    id: p.id,
    categoryId: p.categoryId,
    categoryName,
    name: p.name,
    description: p.description,
    price: p.price,
    isAvailable: p.isAvailable,
    sortOrder: p.sortOrder,
    isDefaultVariant: p.isDefaultVariant,
    searchKeywords: p.searchKeywords,
    unitCount: p.unitCount,
    isCombo: p.isCombo,
    comboItems: p.isCombo ? resolveComboItems(p.comboItems, nameById) : [],
    showInMenu: p.showInMenu,
  };
}

async function fetchCatalog(): Promise<CategoryDTO[]> {
  const [categories, allProducts] = await Promise.all([
    prisma.category.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        products: {
          where: { isAvailable: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    }),
    prisma.product.findMany({ select: { id: true, name: true } }),
  ]);
  const nameById = new Map(allProducts.map((p) => [p.id, p.name]));

  return categories.map((cat) => ({
    id: cat.id,
    name: cat.name,
    slug: cat.slug,
    sortOrder: cat.sortOrder,
    parentCategoryId: cat.parentCategoryId,
    products: cat.products.map((p) => productToDTO(p, cat.name, nameById)),
  }));
}

export async function listAllProductsForResolution(): Promise<ProductDTO[]> {
  const [products, allProducts] = await Promise.all([
    prisma.product.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        category: {
          select: { name: true },
        },
      },
    }),
    prisma.product.findMany({ select: { id: true, name: true } }),
  ]);
  const nameById = new Map(allProducts.map((product) => [product.id, product.name]));
  return products.map((product) => productToDTO(product, product.category.name, nameById));
}

/**
 * Catalogo con cache corta (30s): en un flujo de pedido normal se llama varias veces
 * por mensaje (producto principal + cada acompanante mencionado), y sin cache eso son
 * varias queries identicas a la DB por cada mensaje de WhatsApp. Se invalida apenas
 * el panel admin crea/edita/borra un producto o categoria (ver invalidateCatalogCache).
 */
export async function listCatalog(): Promise<CategoryDTO[]> {
  if (catalogCache && catalogCache.expiresAt > Date.now()) {
    return catalogCache.value;
  }

  const value = await fetchCatalog();
  catalogCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export function invalidateCatalogCache(): void {
  catalogCache = null;
}

function parseDaysOfWeek(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((n): n is number => typeof n === "number" && n >= 0 && n <= 6);
}

function promotionToDTO(p: {
  id: string;
  title: string;
  description: string;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  productId: string | null;
  discountType: string | null;
  discountValue: number | null;
  daysOfWeek: unknown;
  product: { name: string; price: number } | null;
}): PromotionDTO {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    isActive: p.isActive,
    startsAt: p.startsAt?.toISOString() ?? null,
    endsAt: p.endsAt?.toISOString() ?? null,
    productId: p.productId,
    productName: p.product?.name ?? null,
    productPrice: p.product?.price ?? null,
    discountType: p.discountType as PromotionDTO["discountType"],
    discountValue: p.discountValue,
    daysOfWeek: parseDaysOfWeek(p.daysOfWeek),
  };
}

/** true si la promo aplica hoy segun daysOfWeek (vacio = todos los dias). */
export function isPromoActiveToday(promo: PromotionDTO): boolean {
  return promo.daysOfWeek.length === 0 || promo.daysOfWeek.includes(new Date().getDay());
}

/** Mapa productId -> promo con descuento vigente hoy (fecha + dia de semana + activa). Primera coincidencia gana. */
async function getTodaysDiscountByProduct(): Promise<Map<string, PromotionDTO>> {
  const promos = await listActivePromotions();
  const map = new Map<string, PromotionDTO>();
  for (const p of promos) {
    if (p.productId && p.discountType && p.discountValue != null && isPromoActiveToday(p) && !map.has(p.productId)) {
      map.set(p.productId, p);
    }
  }
  return map;
}

/** Precio real a cobrar por un producto, aplicando la promo del dia si existe. */
export async function getEffectivePrice(productId: string, basePrice: number): Promise<number> {
  const map = await getTodaysDiscountByProduct();
  const promo = map.get(productId);
  return promo ? applyPromotionDiscount(basePrice, promo) : basePrice;
}

export async function listAllPromotions(): Promise<PromotionDTO[]> {
  const promos = await prisma.promotion.findMany({
    orderBy: { createdAt: "desc" },
    include: { product: { select: { name: true, price: true } } },
  });
  return promos.map(promotionToDTO);
}

export async function listActivePromotions(): Promise<PromotionDTO[]> {
  const now = new Date();
  const promos = await prisma.promotion.findMany({
    where: {
      isActive: true,
      OR: [{ startsAt: null }, { startsAt: { lte: now } }],
    },
    orderBy: { createdAt: "desc" },
    include: { product: { select: { name: true, price: true } } },
  });

  return promos.filter((p) => !p.endsAt || p.endsAt >= now).map(promotionToDTO);
}

/** Precio final de un producto con la promo aplicada (o el mismo precio si no hay descuento estructurado). */
export function applyPromotionDiscount(productPrice: number, promo: PromotionDTO): number {
  if (!promo.discountType || promo.discountValue == null) return productPrice;
  if (promo.discountType === "PERCENTAGE") {
    return Math.round(productPrice * (1 - promo.discountValue / 100));
  }
  return Math.max(0, productPrice - promo.discountValue);
}

function singularize(token: string): string {
  return token.endsWith("s") ? token.slice(0, -1) : token;
}

function normalizeCatalogText(text: string): string {
  return normalizeLocalizedText(normalizeText(text ?? ""))
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactNormalizedText(text: string): string {
  return normalizeCatalogText(text).replace(/\s+/g, "");
}

function tokenizeCatalogText(text: string): string[] {
  const normalized = normalizeCatalogText(text);
  if (!normalized) return [];

  const rawTokens = normalized.split(/\s+/).filter(Boolean);
  const expanded = new Set<string>();
  for (const token of rawTokens) {
    const mapped = NUMBER_WORDS[token] ?? token;
    if (mapped.length >= 3 || /^\d+(?:\.\d+)?$/.test(mapped)) {
      expanded.add(mapped);
    }
    const singular = singularize(mapped);
    if (singular.length >= 3 || /^\d+(?:\.\d+)?$/.test(singular)) {
      expanded.add(singular);
    }
  }
  return [...expanded];
}

/**
 * Tokens "con significado" para el matching: se descartan palabras de 1-2 letras, pero
 * los numeros SI cuentan para distinguir variantes como "4 presas" vs "8 presas".
 */
function meaningfulTokens(text: string): string[] {
  return tokenizeCatalogText(text);
}

function parseAliases(searchKeywords: string | null): string[] {
  if (!searchKeywords) return [];
  return searchKeywords
    .split(/[\n,;|]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function deriveAliases(product: ProductDTO): string[] {
  const aliases = new Set<string>();
  aliases.add(normalizeCatalogText(product.name));

  for (const alias of parseAliases(product.searchKeywords)) {
    aliases.add(normalizeCatalogText(alias));
  }
  for (const alias of deriveLocalizedAliasVariants(product.name)) {
    aliases.add(normalizeCatalogText(alias));
  }
  for (const alias of parseAliases(product.searchKeywords)) {
    for (const localized of deriveLocalizedAliasVariants(alias)) {
      aliases.add(normalizeCatalogText(localized));
    }
  }

  const tokens = tokenizeCatalogText(product.name);
  if (tokens.includes("familiar")) {
    aliases.add("familiar");
    aliases.add("el familiar");
  }
  if (tokens.includes("grande")) {
    aliases.add("grande");
    aliases.add("el grande");
  }
  if (tokens.includes("pequeno")) {
    aliases.add("pequeno");
    aliases.add("el pequeno");
  }
  if (tokens.includes("mediano")) {
    aliases.add("mediano");
    aliases.add("el mediano");
  }
  if (tokens.includes("medio")) {
    aliases.add("medio");
    aliases.add("medio pollo");
  }

  if (product.unitCount != null) {
    const count = String(product.unitCount);
    aliases.add(count);
    aliases.add(`${count} presas`);
    aliases.add(`${count} piezas`);
    aliases.add(`de ${count}`);
    aliases.add(`el de ${count}`);
    aliases.add(`pollo de ${count}`);
    if (product.isCombo) {
      aliases.add(`combo de ${count}`);
      aliases.add(`combo ${count}`);
      aliases.add(`familiar ${count}`);
    }
  }

  return [...aliases].filter(Boolean);
}

/** Distancia de edicion simple (Levenshtein) para tolerar errores de tipeo. */
function editDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[a.length]![b.length]!;
}

/** Dos tokens cuentan como el mismo si son iguales o difieren por 1-2 letras en palabras largas. */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5) return false;
  return editDistance(a, b) <= (Math.max(a.length, b.length) >= 8 ? 2 : 1);
}

function scoreProductQuery(query: string, product: ProductDTO): ProductResolutionCandidate | null {
  const normalizedQuery = normalizeCatalogText(query);
  if (!normalizedQuery) return null;

  const aliases = deriveAliases(product);
  const exactQuery = query.trim().toLowerCase();
  const normalizedName = normalizeCatalogText(product.name);
  const compactQuery = compactNormalizedText(query);

  if (product.name.trim().toLowerCase() === exactQuery) {
    return { product, confidence: 1, matchedBy: "EXACT_NAME", available: product.isAvailable, aliases };
  }

  if (aliases.some((alias) => alias === exactQuery)) {
    return { product, confidence: 0.99, matchedBy: "EXACT_ALIAS", available: product.isAvailable, aliases };
  }

  if (normalizedName === normalizedQuery) {
    return { product, confidence: 0.98, matchedBy: "EXACT_NORMALIZED", available: product.isAvailable, aliases };
  }

  if (aliases.some((alias) => normalizeCatalogText(alias) === normalizedQuery)) {
    return { product, confidence: 0.96, matchedBy: "ALIAS_NORMALIZED", available: product.isAvailable, aliases };
  }

  const queryTokens = meaningfulTokens(query);
  if (queryTokens.length === 0) return null;
  const soleToken = queryTokens.length === 1 ? queryTokens[0] : null;
  if (soleToken && /^\d+$/.test(soleToken)) return null;

  const productTokens = new Set(
    meaningfulTokens(`${product.categoryName} ${product.name} ${aliases.join(" ")} ${product.unitCount ?? ""}`),
  );
  const matchedTokens = queryTokens.filter((queryToken) =>
    [...productTokens].some((productToken) => tokensMatch(queryToken, productToken)),
  );
  let score = matchedTokens.length / queryTokens.length;

  const aliasHits = aliases.filter((alias) =>
    tokenizeCatalogText(alias).some((aliasToken) => queryTokens.some((queryToken) => tokensMatch(queryToken, aliasToken))),
  ).length;
  score += Math.min(0.12, aliasHits * 0.03);
  if (matchedTokens.some((token) => /^\d+$/.test(token))) score += 0.08;
  if (product.isDefaultVariant) score += 0.02;

  const fuzzyCandidates = [normalizedName, ...aliases].map((candidate) => compactNormalizedText(candidate)).filter(Boolean);
  const bestFuzzyDistance =
    fuzzyCandidates.length > 0
      ? Math.min(...fuzzyCandidates.map((candidate) => editDistance(compactQuery, candidate)))
      : Number.POSITIVE_INFINITY;
  if (bestFuzzyDistance <= 2 && compactQuery.length >= 4) {
    score = Math.max(score, compactQuery.length >= 6 ? 0.82 : 0.75);
  }

  if (score < 0.45) return null;
  return {
    product,
    confidence: Math.min(0.95, Number(score.toFixed(3))),
    matchedBy: bestFuzzyDistance <= 2 && compactQuery.length >= 4 ? "FUZZY" : "TOKEN",
    available: product.isAvailable,
    aliases,
  };
}

function sortCandidates(a: ProductResolutionCandidate, b: ProductResolutionCandidate): number {
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  if (a.available !== b.available) return Number(b.available) - Number(a.available);
  if (a.product.isDefaultVariant !== b.product.isDefaultVariant) {
    return Number(b.product.isDefaultVariant) - Number(a.product.isDefaultVariant);
  }
  return a.product.sortOrder - b.product.sortOrder;
}

function shouldTreatAsAmbiguous(
  first: ProductResolutionCandidate | undefined,
  second: ProductResolutionCandidate | undefined,
): boolean {
  if (!first || !second) return false;
  if (first.available && !second.available) return false;
  if (first.matchedBy === "EXACT_ALIAS" && second.matchedBy === "EXACT_ALIAS") return true;
  if (first.matchedBy === "ALIAS_NORMALIZED" && second.matchedBy === "ALIAS_NORMALIZED") return true;
  if (first.confidence < 0.75 && second.confidence >= first.confidence - 0.08) return true;
  if (Math.abs(first.confidence - second.confidence) <= 0.04) return true;
  return false;
}

export function resolveProductReferenceFromProducts(
  query: string,
  products: ProductDTO[],
): ProductResolutionResult {
  const normalizedQuery = normalizeCatalogText(query);
  const queryTokens = meaningfulTokens(query);
  if (!normalizedQuery || queryTokens.length === 0) {
    return {
      status: "NOT_FOUND",
      query,
      normalizedQuery,
      product: null,
      candidates: [],
      suggestions: [],
    };
  }

  const candidates = products
    .map((product) => scoreProductQuery(query, product))
    .filter((candidate): candidate is ProductResolutionCandidate => Boolean(candidate))
    .sort(sortCandidates);

  const top = candidates[0];
  const second = candidates[1];

  if (!top) {
    return {
      status: "NOT_FOUND",
      query,
      normalizedQuery,
      product: null,
      candidates: [],
      suggestions: [],
    };
  }

  if (shouldTreatAsAmbiguous(top, second)) {
    return {
      status: "AMBIGUOUS",
      query,
      normalizedQuery,
      product: null,
      candidates: candidates.slice(0, 5),
      suggestions: candidates.slice(0, 5),
    };
  }

  return {
    status: "MATCHED",
    query,
    normalizedQuery,
    product: top,
    candidates: candidates.slice(0, 5),
    suggestions: candidates.slice(1, 4),
  };
}

export async function resolveProductReference(query: string): Promise<ProductResolutionResult> {
  const products = await listAllProductsForResolution();
  const result = resolveProductReferenceFromProducts(query, products);
  if (result.status === "NOT_FOUND" && result.normalizedQuery) {
    logger.info({ event: "UNKNOWN_TERM", query: result.query, normalizedQuery: result.normalizedQuery }, "Termino no resuelto contra catalogo");
  } else if (result.status === "AMBIGUOUS") {
    logger.info({ event: "PRODUCT_NOT_RESOLVED", query: result.query, normalizedQuery: result.normalizedQuery }, "Referencia de producto ambigua");
  }
  return result;
}

export async function findBestProductMatch(query: string): Promise<ProductDTO | null> {
  const result = await resolveProductReference(query);
  if (result.status !== "MATCHED" || !result.product?.available) return null;
  return result.product.product;
}

export async function listAllProductsFlat(): Promise<ProductDTO[]> {
  const categories = await listCatalog();
  return categories.flatMap((c) => c.products);
}

// "tomar"/"beber" son sinonimos genericos en espanol de "bebida".
const CATEGORY_QUERY_SYNONYMS: Record<string, string[]> = {
  bebida: ["tomar", "beber", "gaseosa", "gaseosas", "coca", "cocacola", "cola"],
  combo: ["combos", "promocion", "promociones"],
  acompanante: ["acompanamiento", "acompanamientos", "papas", "yuca", "ensalada"],
  alita: ["alitas", "wing", "wings"],
  pollo: ["pollos", "presa", "presas"],
};

/**
 * Busca si un texto libre del cliente se refiere a una categoria completa del menu
 * en vez de un producto especifico.
 */
export async function findCategoryMatch(query: string): Promise<{ categoryName: string; products: ProductDTO[] } | null> {
  const queryTokens = new Set(meaningfulTokens(query ?? "").map(singularize));
  if (queryTokens.size === 0) return null;

  for (const [canonical, synonyms] of Object.entries(CATEGORY_QUERY_SYNONYMS)) {
    if (synonyms.some((synonym) => queryTokens.has(singularize(synonym)))) {
      queryTokens.add(canonical);
    }
  }

  const categories = await listCatalog();
  for (const category of categories) {
    const catTokens = meaningfulTokens(category.name).map(singularize);
    if (catTokens.some((token) => [...queryTokens].some((queryToken) => tokensMatch(queryToken, token)))) {
      const available = category.products.filter((product) => product.isAvailable);
      if (available.length > 0) return { categoryName: category.name, products: available };
    }
  }
  return null;
}
