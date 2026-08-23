import { describe, expect, it, vi } from "vitest";
import type { ProductDTO } from "@pollos/shared";

vi.mock("../src/config/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config/env.js")>();
  return {
    ...actual,
    isProduction: false,
    env: {
      ...actual.env,
      LOG_LEVEL: "info",
      AI_PROVIDER: "gemini",
      AUDIO_TRANSCRIPTION_TIMEOUT_MS: 100,
      AUDIO_TRANSCRIPTION_MAX_RETRIES: 1,
      MAX_WHATSAPP_AUDIO_SIZE_BYTES: 1024,
      MAX_WHATSAPP_AUDIO_DURATION_SECONDS: 30,
      ALLOWED_WHATSAPP_AUDIO_MIME_TYPES: "audio/ogg,audio/mpeg",
    },
  };
});

import {
  deriveLocalizedAliasVariants,
  isRegionalCancellation,
  isRegionalConfirmation,
  normalizeLocalizedText,
} from "../src/modules/localization/localeService.js";
import { repairTextEncodingArtifacts } from "../src/utils/text.js";
import { resolveProductReferenceFromProducts } from "../src/modules/products/productService.js";
import { parseStructuredCartInstruction, resolveDistributedFlavorSelection } from "../src/modules/conversation/structuredCart.js";
import { processWhatsAppAudio } from "../src/modules/conversation/whatsappAudioService.js";

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
  searchKeywords: "pollo de 8, pollo ocho, ocho presas, combo familiar, combito",
  unitCount: 8,
  isCombo: true,
  comboItems: [
    { productId: "papas", productName: "Papas", quantity: 1 },
    { productId: "ensalada", productName: "Ensalada", quantity: 1 },
    { productId: "coca15", productName: "Coca-Cola 1.5L", quantity: 1 },
  ],
});
const papas = buildProduct({ id: "papas", name: "Papas", price: 0, categoryName: "Acompanantes", searchKeywords: "papitas" });
const ensalada = buildProduct({ id: "ensalada", name: "Ensalada", price: 0, categoryName: "Acompanantes", searchKeywords: "ensaladita" });
const arepa = buildProduct({ id: "arepa", name: "Arepa", price: 0, categoryName: "Acompanantes", searchKeywords: "arepita" });
const coca15 = buildProduct({
  id: "coca15",
  name: "Coca-Cola 1.5L",
  price: 9000,
  categoryName: "Bebidas",
  searchKeywords: "cocacola, coca cola, coka cola, gaseosita",
});
const bbq = buildProduct({ id: "bbq", name: "BBQ", price: 0, categoryName: "Salsas", searchKeywords: "barbiquiu, barbikiu, barbique" });
const picante = buildProduct({ id: "picante", name: "Picante", price: 0, categoryName: "Salsas", searchKeywords: "picantico, picnate" });
const catalog = [combo8, papas, ensalada, arepa, coca15, bbq, picante];

describe("golden conversations Antioquia/es-CO", () => {
  const normalizationCases = [
    ["GOLDEN ANT 1: pa la casa se normaliza", "mandemelo pa la casa", "mandemelo para la casa"],
    ["GOLDEN ANT 2: pal se expande", "pal centro", "para el centro"],
    ["GOLDEN ANT 3: papitas se reduce", "papitas", "papas"],
    ["GOLDEN ANT 4: arepita se reduce", "arepita", "arepa"],
    ["GOLDEN ANT 5: gaseosita se reduce", "gaseosita", "gaseosa"],
    ["GOLDEN ANT 6: combito se reduce", "combito", "combo"],
    ["GOLDEN ANT 7: barbiquiu se normaliza a bbq", "barbiquiu", "bbq"],
    ["GOLDEN ANT 8: barbikiu se normaliza a bbq", "barbikiu", "bbq"],
    ["GOLDEN ANT 9: cocacola se separa", "cocacola", "coca cola"],
    ["GOLDEN ANT 10: quiubo se conserva", "kiubo pues", "quiubo pues"],
    ["GOLDEN ANT 11: ensalda se corrige", "ensalda", "ensalada"],
    ["GOLDEN ANT 12: picnate se corrige", "picnate", "picante"],
    ["GOLDEN ANT 13: presitas se reduce", "presitas", "presa"],
    ["GOLDEN ANT 14: pollito se reduce", "pollito", "pollo"],
    ["GOLDEN ANT 15: pa sola se expande", "pa llevar", "para llevar"],
  ] as const;

  it.each(normalizationCases)("%s", (_title, input, expected) => {
    expect(normalizeLocalizedText(input)).toBe(expected);
  });

  const phraseCases = [
    ["GOLDEN ANT 16: hagale confirma", "hagale", true, false],
    ["GOLDEN ANT 17: de una confirma", "de una", true, false],
    ["GOLDEN ANT 18: mande eso confirma", "mande eso", true, false],
    ["GOLDEN ANT 19: mejor no cancela", "mejor no", false, true],
    ["GOLDEN ANT 20: saquelo cancela", "saquelo de ahi", false, true],
  ] as const;

  it.each(phraseCases)("%s", (_title, input, expectConfirm, expectCancel) => {
    expect(isRegionalConfirmation(input)).toBe(expectConfirm);
    expect(isRegionalCancellation(input)).toBe(expectCancel);
  });

  const aliasCases = [
    ["GOLDEN ANT 21: alias coca agrega cocacola", "Coca-Cola 1.5L", "cocacola"],
    ["GOLDEN ANT 22: alias bbq agrega barbiquiu", "BBQ", "barbiquiu"],
    ["GOLDEN ANT 23: alias papas agrega papitas", "Papas", "papitas"],
    ["GOLDEN ANT 24: alias arepa agrega arepita", "Arepa", "arepita"],
    ["GOLDEN ANT 25: alias combo agrega combito", "Combo 8 Presas", "combito"],
  ] as const;

  it.each(aliasCases)("%s", (_title, input, alias) => {
    expect(deriveLocalizedAliasVariants(input)).toContain(alias);
  });

  const resolutionCases = [
    ["GOLDEN ANT 26: combito resuelve combo", "combito de 8", "combo-8"],
    ["GOLDEN ANT 27: papitas resuelve papas", "papitas", "papas"],
    ["GOLDEN ANT 28: arepita resuelve arepa", "arepita", "arepa"],
    ["GOLDEN ANT 29: cocacola resuelve coca", "cocacola", "coca15"],
    ["GOLDEN ANT 30: barbiquiu resuelve bbq", "barbiquiu", "bbq"],
    ["GOLDEN ANT 31: barbique resuelve bbq", "barbique", "bbq"],
    ["GOLDEN ANT 32: picantico resuelve picante", "picantico", "picante"],
    ["GOLDEN ANT 33: pollo de ocho resuelve combo 8", "pollo de ocho", "combo-8"],
    ["GOLDEN ANT 34: ocho presas resuelve combo 8", "ocho presas", "combo-8"],
    ["GOLDEN ANT 35: gaseosita resuelve coca", "gaseosita coca cola", "coca15"],
  ] as const;

  it.each(resolutionCases)("%s", (_title, query, productId) => {
    const result = resolveProductReferenceFromProducts(query, catalog);
    expect(result.status).toBe("MATCHED");
    expect(result.product?.product.id).toBe(productId);
  });

  const parserCases = [
    ["GOLDEN ANT 36: quiteme ensalada", "quiteme la ensalada", "REMOVE_COMPONENT"],
    ["GOLDEN ANT 37: no le eche ensalada", "no le eche ensalada", "REMOVE_COMPONENT"],
    ["GOLDEN ANT 38: echeme bbq", "echeme bbq", "ADD_COMPONENT"],
    ["GOLDEN ANT 39: pongale papitas", "pongale papitas", "ADD_COMPONENT"],
    ["GOLDEN ANT 40: cambieme la gaseosa por cocacola", "cambieme la gaseosa por cocacola", "REPLACE_COMPONENT"],
    ["GOLDEN ANT 41: al segundo quiteme la ensalada", "al segundo quiteme la ensalada", "REMOVE_COMPONENT"],
    ["GOLDEN ANT 42: al primero echeme bbq", "al primero echeme bbq", "ADD_COMPONENT"],
    ["GOLDEN ANT 43: deme otro igual pues", "deme otro igual pues", "DUPLICATE_ITEM"],
    ["GOLDEN ANT 44: mejor deme uno solo", "mejor deme uno solo", "SET_GROUP_QUANTITY"],
    ["GOLDEN ANT 45: cambieme las papitas por arepita", "cambieme las papitas por arepita", "REPLACE_COMPONENT"],
  ] as const;

  it.each(parserCases)("%s", (_title, text, type) => {
    const instruction = parseStructuredCartInstruction(text);
    expect(instruction?.type).toBe(type);
  });

  it("GOLDEN ANT 46: parser conserva componente regional", () => {
    const instruction = parseStructuredCartInstruction("al primero echeme salsita bbq");
    expect(instruction?.componentText?.toLowerCase()).toContain("salsita bbq");
  });

  it("GOLDEN ANT 47: alitas mitad barbiquiu mitad picantico distribuye", () => {
    const result = resolveDistributedFlavorSelection("20 alitas mitad barbiquiu mitad picantico", 20, [bbq, picante]);
    expect(result.status).toBe("OK");
    expect(result.selections).toHaveLength(2);
  });

  it("GOLDEN ANT 48: audio normaliza pa la casa", async () => {
    const result = await processWhatsAppAudio({
      media: { base64: "ZmFrZQ==", mimeType: "audio/ogg", byteLength: 10, contentLength: 10, fileSize: 10 },
      transcribe: vi.fn().mockResolvedValue({
        ok: true,
        text: "mandemelo pa la casa",
        language: "es",
        durationSeconds: 3,
        provider: "gemini",
        retryable: false,
        errorCode: null,
      }),
    });
    expect(result.status).toBe("READY");
    expect(result.normalizedText).toBe("mandemelo para la casa");
  });

  it("GOLDEN ANT 49: audio normaliza barbiquiu", async () => {
    const result = await processWhatsAppAudio({
      media: { base64: "ZmFrZQ==", mimeType: "audio/ogg", byteLength: 10, contentLength: 10, fileSize: 10 },
      transcribe: vi.fn().mockResolvedValue({
        ok: true,
        text: "echeme barbiquiu",
        language: "es",
        durationSeconds: 3,
        provider: "gemini",
        retryable: false,
        errorCode: null,
      }),
    });
    expect(result.normalizedText).toBe("echeme bbq");
  });

  it("GOLDEN ANT 50: audio normaliza diminutivos", async () => {
    const result = await processWhatsAppAudio({
      media: { base64: "ZmFrZQ==", mimeType: "audio/ogg", byteLength: 10, contentLength: 10, fileSize: 10 },
      transcribe: vi.fn().mockResolvedValue({
        ok: true,
        text: "combito con papitas y gaseosita",
        language: "es",
        durationSeconds: 3,
        provider: "gemini",
        retryable: false,
        errorCode: null,
      }),
    });
    expect(result.normalizedText).toBe("combo con papas y gaseosa");
  });

  it("GOLDEN ANT 51: limpia signos dañados antes de responder", () => {
    expect(repairTextEncodingArtifacts("Ã‚Â¿Desea corregir el pedido para continuar?")).toBe(
      "¿Desea corregir el pedido para continuar?",
    );
  });

  it("GOLDEN ANT 52: repara texto dañado de acompanantes", () => {
    expect(repairTextEncodingArtifacts("acompaÃ±antes")).toBe("acompañantes");
  });
});
