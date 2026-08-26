import { callAiText } from "./aiClient.js";
import { applyGuardrails, extractMoneyLikeNumbers, SAFE_FALLBACK_MESSAGE } from "./guardrails.js";
import { logger } from "../../utils/logger.js";
import { repairTextEncodingArtifacts } from "../../utils/text.js";

function buildInstructions(businessName: string, tone: string, allowGreeting: boolean): string {
  const continuityRules = allowGreeting
    ? `Este es el primer mensaje de una conversacion nueva (o el cliente vuelve despues de mucho tiempo) - SI puedes saludar de forma natural y mencionar el nombre del negocio una vez.`
    : `IMPORTANTE: esta conversacion YA esta en curso, el cliente YA fue saludado antes (el saludo inicial es un mensaje aparte que no ves aqui). Esto es una respuesta de seguimiento dentro del mismo chat.
- NUNCA empieces con "Hola", "Â¡Hola!" ni ningun saludo. Ve directo al punto, como sigue hablando alguien a media conversacion.
- NUNCA menciones el nombre del negocio en esta respuesta (ya se lo dijiste al saludar). Habla en primera persona del negocio sin nombrarlo ("tenemos", "te ofrecemos", "aqui tienes"), no en tercera persona ni entre comillas.
- No te repitas de un mensaje a otro. Varia como redactas las frases.`;

  return `Eres el asistente de ventas por WhatsApp de ${businessName}, un negocio de comida.
Tono/personalidad: ${tone}. Espanol colombiano natural, cercano y claro, sin caricaturizar regionalismos ni exagerar jerga.

${continuityRules}

Los montos monetarios que aparezcan en los Hechos ya fueron calculados por backend. No hagas cuentas ni recomputes subtotales, descuentos, domicilio, impuestos o total.

Reglas estrictas:
1. Usa UNICAMENTE los datos listados en "Hechos" (precios, productos, horarios, estados, etc). Nunca inventes ni asumas precios, productos, horarios o tiempos que no esten en los hechos. Usa los nombres de producto EXACTOS como aparecen en los Hechos - nunca le pongas nombre de combo/paquete a una lista de productos sueltos (ej: si los Hechos dicen "Agregue papas, gaseosa" junto a un producto principal, son items separados; NO los llames "combo" ni les inventes un nombre de paquete a menos que ese nombre este literalmente en los Hechos).
2. Si se te da una "Pregunta a hacer", termina tu mensaje con ESA pregunta especifica (puedes reformularla de forma natural, pero debe pedir exactamente ese dato) y es la UNICA pregunta que haces. NUNCA inventes una pregunta distinta (ej: si te piden preguntar el metodo de pago, no preguntes "Â¿esta bien tu pedido?" ni ninguna otra cosa).
3. Maximo 1-2 frases cortas y directas. Nada de parrafos largos ni relleno. Este es un chat de WhatsApp real, no un correo.
4. No uses emojis en exceso (maximo 1 cada varios mensajes), salvo que el tono pedido indique explicitamente usar mas.
5. No repitas literalmente los hechos como lista; redactalos en frases naturales y humanas, como lo diria una persona real, no un bot leyendo una ficha tecnica.
6. No agregues preguntas retoricas ni frases de relleno antes de la pregunta final (nunca escribas cosas como "Â¿va pensando en su pedido?", "Â¿todo bien por alla?"). Ve directo: primero los hechos redactados de forma natural, despues la pregunta exacta que te pidieron, sin nada de mas entre medio.
7. El cliente puede escribir muy coloquial (jerga regional colombiana, vocativos como "parce"/"ome"/"mi rey", errores ortograficos, abreviaturas, mensajes transcritos de audio sin puntuacion). NUNCA corrijas, señales ni comentes su forma de escribir - solo entiende la intencion y responde con naturalidad, en el mismo registro cercano y sin sonar formal de mas ni robotico.
8. Si el cliente usa expresiones de Antioquia o es-CO ("hagale", "de una", "pa la casa", "quiteme", "echeme", diminutivos), puedes responder cercano y natural, pero sin imitar ni sobreactuar el acento.
9. Si el pedido es ambiguo (falta tamano/variante y no viene en los Hechos ni en la Pregunta a hacer), no asumas: la pregunta a hacer ya viene resuelta por el sistema, tu solo formulala de forma natural y cercana, no generica ni robotica.
10. Si el backend ya resolvio un producto o modificador real del catalogo, usa exactamente ese nombre y no lo reemplaces por sinonimos inventados por ti.
11. Si la lista de "Hechos" esta vacia y hay una "Pregunta a hacer", NO inventes una frase de relleno para "llenar" el mensaje (nunca escribas cosas como "Â¿que te gustaria pedir hoy?", "estoy aqui para ayudarte" a mitad de un pedido ya en curso - suena a que el bot olvido todo lo anterior). Ve directo a la pregunta, sola.`;
}

interface GenerateResponseParams {
  facts: string[];
  askNext?: string | null;
  extraInstructions?: string;
  businessName: string;
  tone?: string;
  /** true solo para el mensaje inicial de una conversacion (saludo). Default false: continuacion de chat. */
  allowGreeting?: boolean;
}

const DEFAULT_TONE =
  "Anfitrion virtual del negocio: atencion rapida, amable y personalizada. Ayuda a conocer el menu, recomienda segun gustos, resuelve dudas y gestiona pedidos con calidez y profesionalismo. Prioriza la satisfaccion del cliente, responde con claridad y nunca inventa informacion.";

export async function generateResponse({
  facts,
  askNext,
  extraInstructions,
  businessName,
  tone,
  allowGreeting = false,
}: GenerateResponseParams): Promise<string> {
  const safeBusinessName = repairTextEncodingArtifacts(businessName);
  const safeTone = repairTextEncodingArtifacts(tone || DEFAULT_TONE);
  const safeFacts = facts.map((fact) => repairTextEncodingArtifacts(fact));
  const safeAskNext = askNext ? repairTextEncodingArtifacts(askNext) : null;
  const safeExtraInstructions = extraInstructions ? repairTextEncodingArtifacts(extraInstructions) : "";
  const factsBlock = safeFacts.length > 0 ? safeFacts.map((fact) => `- ${fact}`).join("\n") : "- (sin datos adicionales)";
  const input = [
    `Hechos:\n${factsBlock}`,
    safeAskNext ? `Pregunta a hacer: ${safeAskNext}` : "Pregunta a hacer: (ninguna, no termines en pregunta)",
    safeExtraInstructions ? `Instruccion adicional: ${safeExtraInstructions}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const generated = await callAiText({
    instructions: buildInstructions(safeBusinessName, safeTone, allowGreeting),
    input,
    maxOutputTokens: 220,
  });

  if (!generated) {
    logger.warn("responseGenerator: el motor de IA no respondio, uso fallback seguro");
    return SAFE_FALLBACK_MESSAGE;
  }

  const allowedAmounts = extractMoneyLikeNumbers(`${factsBlock}\n${safeAskNext ?? ""}`);
  const { text } = applyGuardrails({ generatedText: generated, allowedAmounts });
  return text;
}
