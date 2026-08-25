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

// Regresion: la regla de "contesta la pregunta pendiente" (que manda los mensajes cortos a
// PROVIDE_INFO) choca con la regla vieja de CONFIRM cuando la pregunta pendiente ES la
// confirmacion final del pedido. Sin la excepcion explicita, un "Si" salia PROVIDE_INFO y
// decideOrderFlow (que solo crea el pedido con intent === CONFIRM) re-preguntaba lo mismo.
describe("carve-out de CONFIRM cuando la pregunta pendiente es la confirmacion final", () => {
  const confirmingQuestion = getPendingOrderQuestion({ ...initialOrderFlowState, step: OrderFlowStep.CONFIRMING });

  beforeEach(() => {
    vi.clearAllMocks();
    aiClientMocks.callAiJson.mockResolvedValue(JSON.stringify({ intent: Intent.CONFIRM, confidence: 0.95 }));
  });

  // La excepcion se dispara sobre el texto "confirma su pedido". Si alguien reescribe la
  // pregunta del paso CONFIRMING y deja de contener ese texto, la excepcion deja de aplicar
  // en silencio y "Si" vuelve a caer en PROVIDE_INFO — por eso se atan las dos puntas aqui.
  it("la pregunta del paso CONFIRMING contiene el texto sobre el que dispara la excepcion", () => {
    expect(confirmingQuestion).toContain("confirma su pedido");
  });

  it("las instrucciones mantienen CONFIRM (y no lo degradan a PROVIDE_INFO) en la confirmacion final", async () => {
    await classifyIntent({
      message: "Si",
      recentHistory: "bot: ¿Confirma su pedido asi?",
      businessName: "Mi Negocio",
      pendingQuestion: confirmingQuestion,
    });

    const { instructions, input } = aiClientMocks.callAiJson.mock.calls[0][0];
    expect(input).toContain(`El bot esta esperando respuesta a: ${confirmingQuestion}`);
    expect(instructions).toContain("confirma su pedido");
    expect(instructions).toContain("CONFIRM, NUNCA PROVIDE_INFO");
    // Las aceptaciones que reporto el cliente como fallando deben estar nombradas.
    for (const acceptance of ["si", "confirmo", "correcto", "asi esta bien", "hagale", "de una"]) {
      expect(instructions).toContain(acceptance);
    }
  });

  it("la excepcion no pisa el carve-out de CANCEL ni la regla de correcciones", async () => {
    await classifyIntent({
      message: "Si",
      recentHistory: "",
      businessName: "Mi Negocio",
      pendingQuestion: confirmingQuestion,
    });

    const { instructions } = aiClientMocks.callAiJson.mock.calls[0][0];
    // Sigue vigente lo del fix anterior: un "no" a un item opcional nunca es CANCEL.
    expect(instructions).toContain("NUNCA CANCEL");
    // Y en la confirmacion final, cancelar sigue siendo cancelar y un cambio no es CONFIRM.
    expect(instructions).toContain('"cancelar"/"anular" siguen siendo CANCEL');
    expect(instructions).toContain("no es CONFIRM");
  });
});
