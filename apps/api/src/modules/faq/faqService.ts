import { prisma } from "../../db/prisma.js";
import { normalizeText } from "../../utils/text.js";
import type { FaqDTO } from "@pollos/shared";

function toDTO(faq: { id: string; question: string; answer: string; isActive: boolean }): FaqDTO {
  return { id: faq.id, question: faq.question, answer: faq.answer, isActive: faq.isActive };
}

export async function listAllFaqs(restaurantId: string): Promise<FaqDTO[]> {
  const faqs = await prisma.faq.findMany({ where: { restaurantId }, orderBy: { createdAt: "desc" } });
  return faqs.map(toDTO);
}

function meaningfulWords(text: string): string[] {
  return normalizeText(text)
    .split(/\s+/)
    .filter((w) => w.length >= 4);
}

/**
 * Busca la FAQ activa cuya pregunta se parece mas al mensaje del cliente, por overlap de
 * palabras. Exige al menos 2 palabras en comun para evitar falsos positivos (una sola
 * palabra compartida no alcanza para confiar en que es la misma pregunta).
 */
export async function findFaqMatch(restaurantId: string, text: string): Promise<FaqDTO | null> {
  const queryWords = new Set(meaningfulWords(text));
  if (queryWords.size === 0) return null;

  const faqs = await prisma.faq.findMany({ where: { restaurantId, isActive: true } });
  let best: { faq: (typeof faqs)[number]; score: number } | null = null;

  for (const faq of faqs) {
    const questionWords = meaningfulWords(faq.question);
    const score = questionWords.reduce((acc, w) => acc + (queryWords.has(w) ? 1 : 0), 0);
    if (score < 2) continue;
    if (!best || score > best.score) best = { faq, score };
  }

  return best ? toDTO(best.faq) : null;
}
