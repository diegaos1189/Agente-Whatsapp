import { describe, expect, it } from "vitest";
import { isGenericOrderConfirmation } from "../src/modules/localization/localeService.js";

describe("isGenericOrderConfirmation", () => {
  // Mensajes reales de un cliente que el clasificador de IA no reconocia como CONFIRM,
  // dejando al bot re-preguntando "¿Confirma su pedido asi?" en bucle.
  it.each([
    "SI confirmo el pedido asi",
    "Confirmado",
    "SI es correcto mi pedido y lo confirmo asi",
    "Esta correcto mi pedido y lo confirmo",
    "Es correcto mi pedido y lo confirmo asi",
    "si",
    "Sí",
    "Sí, confirmo.",
    "listo, confirmado",
    "ok perfecto",
    "de acuerdo",
    "dale pues",
  ])("reconoce %j como confirmacion", (text) => {
    expect(isGenericOrderConfirmation(text)).toBe(true);
  });

  it.each([
    "no es correcto",
    "no",
    "si pero cambia la gaseosa",
    "confirmo sin la arepa",
    "mejor quita las papitas",
    "si, y agrega una gaseosa",
    "quiero una carne de res",
    "cuanto es el total",
    "espera todavia no",
    "correcto pero falta la ensalada",
    "",
  ])("NO trata %j como confirmacion", (text) => {
    expect(isGenericOrderConfirmation(text)).toBe(false);
  });

  it("rechaza frases largas aunque contengan palabras de confirmacion", () => {
    expect(
      isGenericOrderConfirmation("si mira lo que pasa es que yo habia pedido otra cosa distinta ayer por la tarde y quede confundido"),
    ).toBe(false);
  });
});
