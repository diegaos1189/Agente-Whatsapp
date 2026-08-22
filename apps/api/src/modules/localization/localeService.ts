export interface LocaleProfile {
  locale: string;
  region: string;
  contractionReplacements: Array<[RegExp, string]>;
  lexicalReplacements: Array<[RegExp, string]>;
  diminutiveBaseMap: Record<string, string>;
  confirmationPhrases: string[];
  cancellationPhrases: string[];
}

export const DEFAULT_LOCALE = "es-CO";
export const DEFAULT_REGION = "antioquia";

const esCoAntioquiaProfile: LocaleProfile = {
  locale: "es-CO",
  region: "antioquia",
  contractionReplacements: [
    [/\bpa(?:['’])?\b/gu, "para"],
    [/\bpal\b/gu, "para el"],
    [/\bpa\s+la\b/gu, "para la"],
    [/\bpa\s+el\b/gu, "para el"],
    [/\bpra\b/gu, "para"],
    [/\btoy\b/gu, "estoy"],
    [/\bta\b/gu, "esta"],
    [/\bq'hubo\b/gu, "quiubo"],
  ],
  lexicalReplacements: [
    [/\bbarbecue\b/gu, "bbq"],
    [/\bbarbiquiu\b/gu, "bbq"],
    [/\bbarbikiu\b/gu, "bbq"],
    [/\bbarbique\b/gu, "bbq"],
    [/\bcocacola\b/gu, "coca cola"],
    [/\bcoca-cola\b/gu, "coca cola"],
    [/\bquesud[oa]\b/gu, "quesudo"],
    [/\bquiubo\b/gu, "quiubo"],
    [/\bkiubo\b/gu, "quiubo"],
    [/\bquibo\b/gu, "quiubo"],
  ],
  diminutiveBaseMap: {
    papitas: "papas",
    papita: "papas",
    arepita: "arepa",
    arepitas: "arepa",
    salsita: "salsa",
    salsitas: "salsa",
    gaseosita: "gaseosa",
    gaseositas: "gaseosa",
    pollito: "pollo",
    pollitos: "pollo",
    pollita: "pollo",
    combito: "combo",
    combitos: "combo",
    ensaladita: "ensalada",
    ensaladitas: "ensalada",
    presita: "presa",
    presitas: "presa",
    alitas: "alita",
    papaz: "papas",
    ensalda: "ensalada",
    picnate: "picante",
    domiciliito: "domicilio",
    domiciliitoo: "domicilio",
  },
  confirmationPhrases: [
    "hagale",
    "hagale pues",
    "dele",
    "de una",
    "si senor",
    "si senora",
    "mande eso",
    "eso es",
    "correcto",
    "listo hagale",
    "asi mero",
  ],
  cancellationPhrases: [
    "mejor no",
    "ese no",
    "quite eso",
    "ya no",
    "saquelo",
    "borreme eso",
    "no senor",
    "no mejor",
  ],
};

export function getLocaleProfile(locale = DEFAULT_LOCALE, region = DEFAULT_REGION): LocaleProfile {
  if (locale === "es-CO" && region === "antioquia") {
    return esCoAntioquiaProfile;
  }
  return esCoAntioquiaProfile;
}

function collapseSpaces(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

export function normalizeLocalizedText(text: string, profile = getLocaleProfile()): string {
  let normalized = text ?? "";

  for (const [pattern, replacement] of profile.contractionReplacements) {
    normalized = normalized.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of profile.lexicalReplacements) {
    normalized = normalized.replace(pattern, replacement);
  }

  normalized = normalized
    .split(/\s+/gu)
    .map((token) => profile.diminutiveBaseMap[token.toLowerCase()] ?? token)
    .join(" ");

  return collapseSpaces(normalized);
}

export function normalizeLocalizedToken(token: string, profile = getLocaleProfile()): string {
  return normalizeLocalizedText(token, profile).toLowerCase();
}

export function deriveLocalizedAliasVariants(text: string, profile = getLocaleProfile()): string[] {
  const base = normalizeLocalizedText(text, profile).toLowerCase();
  if (!base) return [];

  const variants = new Set<string>([base]);
  const tokens = base.split(/\s+/gu).filter(Boolean);

  for (const token of tokens) {
    if (token === "coca" || token.startsWith("coca-") || token.startsWith("coca")) {
      variants.add("coca cola");
      variants.add("cocacola");
    }
    if (token === "bbq") {
      variants.add("barbiquiu");
      variants.add("barbecue");
      variants.add("barbikiu");
      variants.add("barbique");
    }
    if (token === "papa" || token === "papas") {
      variants.add("papitas");
    }
    if (token === "arepa") {
      variants.add("arepita");
    }
    if (token === "ensalada") {
      variants.add("ensaladita");
    }
    if (token === "salsa") {
      variants.add("salsita");
    }
    if (token === "gaseosa") {
      variants.add("gaseosita");
    }
    if (token === "combo") {
      variants.add("combito");
    }
    if (token === "pollo") {
      variants.add("pollito");
    }
    if (token === "presa") {
      variants.add("presita");
    }
  }

  return [...variants];
}

function normalizeForPhraseMatch(text: string, profile = getLocaleProfile()): string {
  return normalizeLocalizedText(text, profile)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function isRegionalConfirmation(text: string, profile = getLocaleProfile()): boolean {
  const normalized = normalizeForPhraseMatch(text, profile);
  return profile.confirmationPhrases.some((phrase) => normalized === normalizeForPhraseMatch(phrase, profile));
}

export function isRegionalCancellation(text: string, profile = getLocaleProfile()): boolean {
  const normalized = normalizeForPhraseMatch(text, profile);
  return profile.cancellationPhrases.some((phrase) => normalized.includes(normalizeForPhraseMatch(phrase, profile)));
}
