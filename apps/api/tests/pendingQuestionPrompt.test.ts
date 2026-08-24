import { beforeEach, describe, expect, it, vi } from "vitest";
import { Intent, OrderFlowStep } from "@pollos/shared";

const aiClientMocks = vi.hoisted(() => ({
  callAiJson: vi.fn(),
}));

vi.mock("../src/modules/ai/aiClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/ai/aiClient.js")>();
  return { ...actual, callAiJson: aiClientMocks.callAiJson };
});

import { classifyIntent } from "../src/modules/ai/intentClassifier.js";
import { extractEntities } from "../src/modules/ai/entityExtractor.js";
import { getPendingOrderQuestion, initialOrderFlowState } from "../src/modules/conversation/orderFlow.js";

// Sin esta pieza, ninguna de las dos llamadas de IA sabe QUE pregunta acaba de hacer el bot:
// un "No" contestando "¿desea algun acompanante?" salia como CANCEL (cancelaba el pedido) y un
// "Ensalada" suelto salia en productType en vez de sides (el bot re-preguntaba en bucle).
describe("contexto de pregunta pendiente en las llamadas de IA", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("classifyIntent antepone la pregunta pendiente al input", async () => {
    aiClientMocks.callAiJson.mockResolvedValue(JSON.stringify({ intent: Intent.PROVIDE_INFO, confidence: 0.9 }));

    await classifyIntent({
      message: "No",
      recentHistory: "cliente: quiero un pollo",
      businessName: "Mi Negocio",
      pendingQuestion: "¿desea agregar algun acompanante?",
    });

    const call = aiClientMocks.callAiJson.mock.calls[0][0];
    expect(call.input).toContain("El bot esta esperando respuesta a: ¿desea agregar algun acompanante?");
    expect(call.instructions).toContain("El bot esta esperando respuesta a:");
    expect(call.instructions).toContain("NUNCA CANCEL");
  });

  it("extractEntities antepone la pregunta pendiente al input", async () => {
    aiClientMocks.callAiJson.mockResolvedValue(
      JSON.stringify({
        productType: null,
        quantity: null,
        size: null,
        sides: ["ensalada"],
        deliveryType: null,
        address: null,
        neighborhood: null,
        reference: null,
        paymentMethod: null,
        name: null,
        contactPhone: null,
      }),
    );

    await extractEntities({
      message: "Ensalada",
      recentHistory: "bot: ¿desea agregar algun acompanante?",
      businessName: "Mi Negocio",
      pendingQuestion: "¿desea agregar algun acompanante?",
    });

    const call = aiClientMocks.callAiJson.mock.calls[0][0];
    expect(call.input).toContain("El bot esta esperando respuesta a: ¿desea agregar algun acompanante?");
    expect(call.instructions).toContain('va en "sides"');
  });

  it("sin pregunta pendiente el input queda como antes (fuera del flujo de pedido)", async () => {
    aiClientMocks.callAiJson.mockResolvedValue(JSON.stringify({ intent: Intent.GREETING, confidence: 1 }));

    await classifyIntent({ message: "hola", recentHistory: "", businessName: "Mi Negocio" });

    const call = aiClientMocks.callAiJson.mock.calls[0][0];
    expect(call.input).not.toContain("El bot esta esperando respuesta a:");
    expect(call.input.startsWith("Historial reciente")).toBe(true);
  });

  it("la pregunta pendiente que se le pasa a la IA describe el paso real del pedido", () => {
    expect(getPendingOrderQuestion({ ...initialOrderFlowState, step: OrderFlowStep.ASK_SIDES })).toContain("acompanante");
    expect(getPendingOrderQuestion({ ...initialOrderFlowState, step: OrderFlowStep.ASK_DRINKS })).toContain("tomar");
    expect(getPendingOrderQuestion(initialOrderFlowState)).toBeNull();
  });
});
