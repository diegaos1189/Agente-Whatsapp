import { logger } from "../../utils/logger.js";

const MAX_RESPONSE_LENGTH = 700;
export const SAFE_FALLBACK_MESSAGE =
  "Disculpa, no logre confirmar ese dato con certeza. ¿Me lo repites de otra forma? Si prefieres, escribe *asesor* y te atiende una persona del equipo.";

/**
 * Extrae numeros que parecen montos de dinero de un texto (ej: $12.000, 12000, COP 25.000).
 */
export function extractMoneyLikeNumbers(text: string): number[] {
  const matches = text.match(/\$?\s?\d{1,3}(?:[.,]\d{3})+|\$\s?\d+/g) ?? [];
  return matches
    .map((m) => Number(m.replace(/[^\d]/g, "")))
    .filter((n) => !Number.isNaN(n) && n > 0);
}

interface GuardrailParams {
  generatedText: string;
  allowedAmounts: number[];
}

interface GuardrailResult {
  text: string;
  wasModified: boolean;
}

/**
 * Guardrail anti-alucinacion: valida que cualquier monto mencionado en la respuesta
 * generada por el modelo exista en la lista de montos reales permitidos (precios/costos
 * que vienen de base de datos). Si el modelo menciona un monto que no cuadra, se descarta
 * la respuesta completa y se usa un fallback seguro en vez de arriesgar un precio inventado.
 */
export function applyGuardrails({ generatedText, allowedAmounts }: GuardrailParams): GuardrailResult {
  const trimmed = generatedText?.trim();

  if (!trimmed) {
    logger.warn("Guardrail: respuesta vacia del modelo, uso fallback");
    return { text: SAFE_FALLBACK_MESSAGE, wasModified: true };
  }

  const mentionedAmounts = extractMoneyLikeNumbers(trimmed);
  const allowedSet = new Set(allowedAmounts);
  const hasHallucinatedAmount = mentionedAmounts.some((amount) => !allowedSet.has(amount));

  if (hasHallucinatedAmount) {
    logger.warn(
      { mentionedAmounts, allowedAmounts },
      "Guardrail: monto no reconocido en respuesta generada, uso fallback",
    );
    return { text: SAFE_FALLBACK_MESSAGE, wasModified: true };
  }

  if (trimmed.length > MAX_RESPONSE_LENGTH) {
    logger.warn({ length: trimmed.length }, "Guardrail: respuesta demasiado larga, truncando");
    return { text: `${trimmed.slice(0, MAX_RESPONSE_LENGTH)}...`, wasModified: true };
  }

  return { text: trimmed, wasModified: false };
}
