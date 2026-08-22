/**
 * Quita tildes y puntuacion (guiones, puntos) antes de tokenizar para el matching de
 * productos — sin esto, "cocacola" (como la escribe la gente en la calle) nunca
 * matcheaba contra "Coca-Cola" del catalogo por el guion, ni "1.5L" contra variantes
 * sin punto.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[-.]/g, "")
    .trim();
}

const HANDOFF_KEYWORDS = ["asesor", "humano", "persona", "queja", "reclamo", "operador", "agente"];

export function messageContainsHandoffKeyword(text: string): boolean {
  const normalized = normalizeText(text);
  return HANDOFF_KEYWORDS.some((kw) => normalized.includes(kw));
}
