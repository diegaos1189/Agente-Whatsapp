import { describe, expect, it } from "vitest";
import { applyGuardrails, SAFE_FALLBACK_MESSAGE, extractMoneyLikeNumbers } from "../src/modules/ai/guardrails.js";

describe("extractMoneyLikeNumbers", () => {
  it("detecta montos con separador de miles", () => {
    expect(extractMoneyLikeNumbers("Cuesta $52.000 el combo")).toEqual([52000]);
  });

  it("ignora texto sin montos", () => {
    expect(extractMoneyLikeNumbers("Hola, como estas?")).toEqual([]);
  });

  it("detecta montos dentro de una pregunta con precios del catalogo (askNext)", () => {
    // responseGenerator.ts ahora incluye el texto de askNext (ademas de los facts) al
    // calcular los montos permitidos — sin esto, preguntas como "¿que desea tomar? tenemos
    // gaseosa ($9.000)" se marcaban como alucinacion cuando facts venia vacio.
    expect(extractMoneyLikeNumbers("¿Que desea tomar? Tenemos: Gaseosa 1.5L ($9.000).")).toEqual([9000]);
  });
});

describe("applyGuardrails", () => {
  it("deja pasar una respuesta que solo menciona montos permitidos", () => {
    const result = applyGuardrails({
      generatedText: "El combo familiar cuesta $68.000 e incluye gaseosa.",
      allowedAmounts: [68000],
    });
    expect(result.wasModified).toBe(false);
    expect(result.text).toContain("68.000");
  });

  it("bloquea y reemplaza una respuesta que inventa un monto no permitido", () => {
    const result = applyGuardrails({
      generatedText: "El combo familiar cuesta $30.000, una ganga.",
      allowedAmounts: [68000],
    });
    expect(result.wasModified).toBe(true);
    expect(result.text).toBe(SAFE_FALLBACK_MESSAGE);
  });

  it("usa el fallback seguro si la respuesta viene vacia", () => {
    const result = applyGuardrails({ generatedText: "   ", allowedAmounts: [] });
    expect(result.text).toBe(SAFE_FALLBACK_MESSAGE);
  });
});
