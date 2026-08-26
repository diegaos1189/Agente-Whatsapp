import { beforeEach, describe, expect, it, vi } from "vitest";

const aiClientMocks = vi.hoisted(() => ({
  callAiText: vi.fn(),
}));

vi.mock("../src/modules/ai/aiClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/ai/aiClient.js")>();
  return { ...actual, callAiText: aiClientMocks.callAiText };
});

import { generateResponse } from "../src/modules/ai/responseGenerator.js";

describe("responseGenerator prompt sanitization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aiClientMocks.callAiText.mockResolvedValue("Claro, ¿confirmamos el pedido?");
  });

  it("repara hechos e instrucciones antes de llamar a la IA", async () => {
    await generateResponse({
      facts: ["acompaÃ±antes disponibles", "Total: $25.000"],
      askNext: "Â¿confirmamos el pedido?",
      extraInstructions: "No escribas Ã‚Â¡Hola!",
      businessName: "Pollos El CorralitÃ³",
      tone: "AtenciÃ³n cercana",
    });

    const call = aiClientMocks.callAiText.mock.calls[0][0];
    expect(call.instructions).toContain("Pollos El Corralitó");
    expect(call.instructions).toContain("Atención cercana");
    expect(call.input).toContain("acompañantes disponibles");
    expect(call.input).toContain("Pregunta a hacer: ¿confirmamos el pedido?");
    expect(call.input).toContain("Instruccion adicional: No escribas ¡Hola!");
  });
});
