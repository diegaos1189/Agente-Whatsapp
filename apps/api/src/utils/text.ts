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

function mojibakeScore(text: string): number {
  const matches = text.match(/(?:Ã.|Â.|â.|聶|澳|澧|熹|燉|禦|盧|篙|激|穌|燐|盥)/gu);
  return matches?.length ?? 0;
}

export function repairTextEncodingArtifacts(text: string): string {
  if (!text) return text;

  const candidates = [text, Buffer.from(text, "latin1").toString("utf8")];
  let best = candidates[0]!;
  let bestScore = mojibakeScore(best);

  for (const candidate of candidates.slice(1)) {
    const score = mojibakeScore(candidate);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best
    .replace(/[\uFFFD\u001A]/gu, "")
    .replace(/Ã‚Â¿/gu, "¿")
    .replace(/Â¿/gu, "¿")
    .replace(/Ã‚Â¡/gu, "¡")
    .replace(/Â¡/gu, "¡")
    .replace(/acompaÃ±/gu, "acompañ")
    .replace(/CÃ³/gu, "Có");
}
