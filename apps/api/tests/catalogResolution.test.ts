import { describe, expect, it } from "vitest";
import type { ProductDTO } from "@pollos/shared";
import {
  applyStructuredCartInstruction,
  createStructuredCartFromLegacyLines,
  parseStructuredCartInstruction,
  resolveDistributedFlavorSelection,
} from "../src/modules/conversation/structuredCart.js";
import { resolveProductReferenceFromProducts } from "../src/modules/products/productService.js";

function buildProduct(partial: Partial<ProductDTO> & Pick<ProductDTO, "id" | "name" | "price" | "categoryName">): ProductDTO {
  return {
    id: partial.id,
    categoryId: partial.categoryId ?? `${partial.categoryName}-id`,
    categoryName: partial.categoryName,
    name: partial.name,
    description: partial.description ?? null,
    price: partial.price,
    isAvailable: partial.isAvailable ?? true,
    sortOrder: partial.sortOrder ?? 1,
    isDefaultVariant: partial.isDefaultVariant ?? false,
    searchKeywords: partial.searchKeywords ?? null,
    unitCount: partial.unitCount ?? null,
    isCombo: partial.isCombo ?? false,
    comboItems: partial.comboItems ?? [],
    showInMenu: partial.showInMenu ?? true,
  };
}

const combo8 = buildProduct({
  id: "combo-8",
  name: "Combo 8 Presas",
  price: 68000,
  categoryName: "Combos",
  isDefaultVariant: true,
  searchKeywords: "pollo de 8, pollo ocho, ocho presas, pollo de ocho, combo familiar, el familiar",
  unitCount: 8,
  isCombo: true,
  comboItems: [
    { productId: "papas", productName: "Papas", quantity: 1 },
    { productId: "ensalada", productName: "Ensalada", quantity: 1 },
    { productId: "coca15", productName: "Coca-Cola 1.5L", quantity: 1 },
  ],
});

const combo12 = buildProduct({
  id: "combo-12",
  name: "Combo Familiar 12 Presas",
  price: 92000,
  categoryName: "Combos",
  searchKeywords: "familiar, el familiar, pollo de 12, doce presas",
  unitCount: 12,
  isCombo: true,
  comboItems: [
    { productId: "yuca", productName: "Yuca", quantity: 1 },
    { productId: "ensalada", productName: "Ensalada", quantity: 1 },
    { productId: "colombiana15", productName: "Colombiana 1.5L", quantity: 1 },
  ],
});

const alitas20 = buildProduct({
  id: "alitas-20",
  name: "Alitas x20",
  price: 36000,
  categoryName: "Alitas",
  searchKeywords: "20 alitas, veinte alitas",
  unitCount: 20,
});

const papas = buildProduct({ id: "papas", name: "Papas", price: 0, categoryName: "Acompanantes" });
const yuca = buildProduct({ id: "yuca", name: "Yuca", price: 0, categoryName: "Acompanantes" });
const ensalada = buildProduct({ id: "ensalada", name: "Ensalada", price: 0, categoryName: "Acompanantes" });
const coca15 = buildProduct({
  id: "coca15",
  name: "Coca-Cola 1.5L",
  price: 9000,
  categoryName: "Bebidas",
  searchKeywords: "cocacola, coca grande, coca cola, coka cola, otra coca",
});
const colombiana15 = buildProduct({
  id: "colombiana15",
  name: "Colombiana 1.5L",
  price: 9000,
  categoryName: "Bebidas",
  searchKeywords: "colombiana grande, kolombiana",
});
const bbq = buildProduct({ id: "bbq", name: "BBQ", price: 0, categoryName: "Salsas", searchKeywords: "barbiquiu" });
const picante = buildProduct({ id: "picante", name: "Picante", price: 0, categoryName: "Salsas", searchKeywords: "picantes, picant" });
const rosada = buildProduct({ id: "rosada", name: "Salsa Rosada", price: 0, categoryName: "Salsas", searchKeywords: "rosada, rosadas" });
const nuggetsOtherTenant = buildProduct({
  id: "other-nuggets",
  name: "Nuggets",
  price: 15000,
  categoryName: "Promos",
  searchKeywords: "nuggets",
});
const combo8Unavailable = buildProduct({
  ...combo8,
  id: "combo-8-off",
  name: "Combo 8 Presas Agotado",
  isAvailable: false,
  searchKeywords: "pollo de 8 agotado, combo 8 agotado",
});

const catalog = [
  combo8,
  combo12,
  combo8Unavailable,
  alitas20,
  papas,
  yuca,
  ensalada,
  coca15,
  colombiana15,
  bbq,
  picante,
  rosada,
];

const comboOnlyCatalog = [combo8, papas, yuca, ensalada, coca15, colombiana15, bbq, picante, rosada];
const priceById = new Map(comboOnlyCatalog.map((product) => [product.id, product.price]));

describe("catalog resolution", () => {
  it("TEST 1: 'pollo de 8' resuelve Combo 8 Presas", () => {
    const result = resolveProductReferenceFromProducts("pollo de 8", catalog);
    expect(result.status).toBe("MATCHED");
    expect(result.product?.product.id).toBe("combo-8");
  });

  it("TEST 2: 'ocho presas' resuelve el mismo producto", () => {
    const result = resolveProductReferenceFromProducts("ocho presas", catalog);
    expect(result.status).toBe("MATCHED");
    expect(result.product?.product.id).toBe("combo-8");
  });

  it("TEST 3: 'el familiar' resuelve si existe un unico match seguro", () => {
    const result = resolveProductReferenceFromProducts("el familiar", [combo8, coca15]);
    expect(result.status).toBe("MATCHED");
    expect(result.product?.product.id).toBe("combo-8");
  });

  it("TEST 4: 'el familiar' con dos candidatos devuelve AMBIGUOUS", () => {
    const result = resolveProductReferenceFromProducts("el familiar", [combo8, combo12]);
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.candidates.map((candidate) => candidate.product.id)).toContain("combo-8");
    expect(result.candidates.map((candidate) => candidate.product.id)).toContain("combo-12");
  });

  it("TEST 5: producto inexistente devuelve NOT_FOUND", () => {
    const result = resolveProductReferenceFromProducts("nuggets", comboOnlyCatalog);
    expect(result.status).toBe("NOT_FOUND");
  });

  it("TEST 6: producto agotado se resuelve pero queda marcado como no disponible", () => {
    const result = resolveProductReferenceFromProducts("combo 8 agotado", catalog);
    expect(result.status).toBe("MATCHED");
    expect(result.product?.available).toBe(false);
  });

  it("TEST 7: '20 alitas mitad BBQ mitad picantes' distribuye correctamente", () => {
    const result = resolveDistributedFlavorSelection("20 alitas mitad BBQ mitad picantes", 20, [bbq, picante]);
    expect(result.status).toBe("OK");
    expect(result.selections).toEqual([
      { productId: "bbq", productName: "BBQ", quantity: 10 },
      { productId: "picante", productName: "Picante", quantity: 10 },
    ]);
  });

  it("TEST 8: '20 alitas, 10 BBQ y 10 picantes' distribuye correctamente", () => {
    const result = resolveDistributedFlavorSelection("20 alitas, 10 BBQ y 10 picantes", 20, [bbq, picante]);
    expect(result.status).toBe("OK");
    expect(result.selections).toEqual([
      { productId: "bbq", productName: "BBQ", quantity: 10 },
      { productId: "picante", productName: "Picante", quantity: 10 },
    ]);
  });

  it("TEST 9: si los sabores superan la cantidad total, rechaza", () => {
    const result = resolveDistributedFlavorSelection("20 alitas, 15 BBQ y 10 picantes", 20, [bbq, picante]);
    expect(result.status).toBe("INVALID_TOTAL");
  });

  it("TEST 15: alias de otro tenant no resuelve si no existe en el catalogo actual", () => {
    const result = resolveProductReferenceFromProducts("nuggets", [combo8, coca15, nuggetsOtherTenant].filter((product) => product.id !== "other-nuggets"));
    expect(result.status).toBe("NOT_FOUND");
  });

  it("TEST 16: error ortografico razonable resuelve correctamente", () => {
    const result = resolveProductReferenceFromProducts("coka cola", [coca15, colombiana15]);
    expect(result.status).toBe("MATCHED");
    expect(result.product?.product.id).toBe("coca15");
  });

  it("TEST 17: query extremadamente ambigua pide aclaracion", () => {
    const result = resolveProductReferenceFromProducts("combo", [combo8, combo12]);
    expect(result.status).toBe("AMBIGUOUS");
  });
});

describe("catalog resolution with structured cart", () => {
  function createCart() {
    return createStructuredCartFromLegacyLines(
      [{ productId: combo8.id, productName: combo8.name, quantity: 2, unitPrice: combo8.price }],
      comboOnlyCatalog,
      priceById,
    );
  }

  it("TEST 10: 'cambie papas por yuca' hace la sustitucion correcta", () => {
    const instruction = parseStructuredCartInstruction("Cambieme las papas por yuca.");
    const result = applyStructuredCartInstruction(createCart(), instruction!, comboOnlyCatalog, priceById);
    expect(result.ok).toBe(true);
    expect(result.updatedCart.items[1]!.components.some((component) => component.productId === "yuca" && component.status === "ACTIVE")).toBe(true);
  });

  it("TEST 11: 'sin ensalada' remueve correctamente si esta permitida", () => {
    const instruction = parseStructuredCartInstruction("Al segundo sin ensalada.");
    const result = applyStructuredCartInstruction(createCart(), instruction!, comboOnlyCatalog, priceById);
    expect(result.ok).toBe(true);
    expect(result.updatedCart.items[1]!.components.find((component) => component.productId === "ensalada")?.status).toBe("REMOVED");
  });

  it("TEST 12: modificador que no pertenece al producto se rechaza", () => {
    const instruction = parseStructuredCartInstruction("Al primero pongale combo familiar 12.");
    const result = applyStructuredCartInstruction(createCart(), instruction!, comboOnlyCatalog, priceById);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("no es un modificador valido");
  });

  it("TEST 13: 'deme otro igual' duplica el item correcto", () => {
    const cart = createStructuredCartFromLegacyLines(
      [{ productId: combo8.id, productName: combo8.name, quantity: 1, unitPrice: combo8.price }],
      comboOnlyCatalog,
      priceById,
    );
    const instruction = parseStructuredCartInstruction("Deme otro igual.");
    const result = applyStructuredCartInstruction(cart, instruction!, comboOnlyCatalog, priceById);
    expect(result.ok).toBe(true);
    expect(result.updatedCart.items).toHaveLength(2);
  });

  it("TEST 14: 'al segundo pongale BBQ' modifica solamente el segundo item", () => {
    const instruction = parseStructuredCartInstruction("Al segundo pongale barbiquiu.");
    const result = applyStructuredCartInstruction(createCart(), instruction!, comboOnlyCatalog, priceById);
    expect(result.ok).toBe(true);
    expect(result.updatedCart.items[0]!.components.some((component) => component.productId === "bbq")).toBe(false);
    expect(result.updatedCart.items[1]!.components.some((component) => component.productId === "bbq")).toBe(true);
  });
});
