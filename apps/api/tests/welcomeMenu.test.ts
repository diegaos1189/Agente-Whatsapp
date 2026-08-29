import { describe, expect, it } from "vitest";
import { normalizeNumberedMenuLines } from "../src/utils/text.js";
import { buildWelcomeShortcutFromMessage } from "../src/modules/conversation/conversationService.js";
import { Intent } from "@pollos/shared";

describe("normalizeNumberedMenuLines", () => {
  it("empareja el espaciado inconsistente de un menu escrito a mano", () => {
    const raw = "¡Hola! Bienvenido a Dely Combos 🍗 ¿En qué te ayudo hoy?\n\n 1. Ver el menu\n2.Promociones\n3.  Estado de un pedido\n\nEscribe el numero para continuar.";
    expect(normalizeNumberedMenuLines(raw)).toBe(
      "¡Hola! Bienvenido a Dely Combos 🍗 ¿En qué te ayudo hoy?\n\n1. Ver el menu\n2. Promociones\n3. Estado de un pedido\n\nEscribe el numero para continuar.",
    );
  });

  it("acepta parentesis como separador y numeros de varios digitos", () => {
    expect(normalizeNumberedMenuLines("10)Opcion diez")).toBe("10. Opcion diez");
  });

  it("no toca montos con separador de miles al inicio de linea", () => {
    expect(normalizeNumberedMenuLines("12.000 pesos el combo")).toBe("12.000 pesos el combo");
  });

  it("no toca lineas sin numeracion", () => {
    const raw = "Escribe el numero para continuar.";
    expect(normalizeNumberedMenuLines(raw)).toBe(raw);
  });
});

describe("buildWelcomeShortcutFromMessage", () => {
  it("deriva el mapa numero->intent del menu personalizado (orden distinto al default)", () => {
    // Menu real de un cliente: 3 opciones donde "2" es promociones y "3" es estado —
    // con el mapa por defecto, "2" arrancaba un pedido y "3" mostraba promociones.
    const message = "¡Hola! Bienvenido a Dely Combos 🍗\n\n1. Ver el menu\n2.Promociones\n3. Estado de un pedido\n\nEscribe el numero para continuar.";
    expect(buildWelcomeShortcutFromMessage(message)).toEqual({
      "1": Intent.VIEW_MENU,
      "2": Intent.ASK_PROMOTIONS,
      "3": Intent.ORDER_STATUS,
    });
  });

  it("reconoce hacer un pedido y tildes/mayusculas en las etiquetas", () => {
    const message = "1. Ver el MENÚ\n2. Hacer un pedido\n3. Promociones";
    expect(buildWelcomeShortcutFromMessage(message)).toEqual({
      "1": Intent.VIEW_MENU,
      "2": Intent.ORDER_PRODUCT,
      "3": Intent.ASK_PROMOTIONS,
    });
  });

  it("deja sin atajo las lineas que no se reconocen (caen a clasificacion por IA)", () => {
    const message = "1. Ver el menu\n2. Hablar con el chef";
    expect(buildWelcomeShortcutFromMessage(message)).toEqual({ "1": Intent.VIEW_MENU });
  });

  it("devuelve null si el mensaje no tiene lineas numeradas (aplica el mapa por defecto)", () => {
    expect(buildWelcomeShortcutFromMessage("¡Hola! Escribeme lo que necesites.")).toBeNull();
  });
});
