import { z } from "zod";
import { Intent } from "@pollos/shared";
import { callAiJson } from "./aiClient.js";
import type { NeutralSchema } from "./schema.js";
import { logger } from "../../utils/logger.js";

const INTENT_VALUES = Object.values(Intent) as [string, ...string[]];

const intentResultSchema = z.object({
  intent: z.enum(INTENT_VALUES),
  confidence: z.number().min(0).max(1),
});

export type IntentResult = z.infer<typeof intentResultSchema>;

const SCHEMA: NeutralSchema = {
  type: "object",
  properties: {
    intent: { type: "string", enum: INTENT_VALUES },
    confidence: { type: "number" },
  },
  required: ["intent", "confidence"],
};

function buildInstructions(businessName: string): string {
  return `Eres un clasificador de intenciones para el WhatsApp de "${businessName}", un negocio de comida (restaurante, pizzeria, hamburgueseria u otro tipo de comida rapida/a domicilio).
Clasifica el ULTIMO mensaje del cliente en una de estas intenciones exactas:
${INTENT_VALUES.join(", ")}

Guia rapida:
- GREETING: saludo inicial sin pedir nada especifico.
- VIEW_MENU: quiere ver el menu o categorias.
- ASK_PRICE: pregunta precio de algo especifico.
- ASK_PROMOTIONS: pregunta por promociones/ofertas.
- ORDER_PRODUCT: quiere pedir algo del menu (cualquier producto: pizza, hamburguesa, combo, bebida, etc), con o sin especificar cual.
- ORDER_PRODUCT tambien cubre repetir un pedido anterior ("lo mismo", "lo de siempre", "repitame el ultimo", "el pedido anterior"), incluso si en la misma frase pide cambios como "sin ensalada" o "hoy lo recojo".
- ASK_DELIVERY: pregunta si hacen domicilio o zonas de cobertura.
- ASK_ETA: pregunta cuanto tiempo tarda el pedido.
- ORDER_STATUS: pregunta por el estado de un pedido ya hecho.
- ORDER_STATUS tambien cubre seguimientos cortos sobre un pedido ya mencionado, por ejemplo: "y ahora", "ya salio", "ya viene", "como va", "ya puedo pasar", "sigue en preparacion".
- ASK_ETA tambien cubre "cuanto falta", "cuanto demora", "falta mucho", "en cuanto llega", cuando se refieren a un pedido ya hecho.
- HUMAN_HANDOFF: pide hablar con una persona, asesor, o similar.
- COMPLAINT: pone una queja o reporta un problema.
- PROVIDE_INFO: esta respondiendo un dato que se le pidio (cantidad, direccion, nombre, metodo de pago, confirmacion de un slot pendiente).
- CONFIRM: confirma explicitamente (si, dale, correcto, confirmo). En clientes de Antioquia tambien puede venir como "hagale", "hagale pues", "dele", "mande eso", "eso es" o "de una", PERO solo cuando semanticamente esten aceptando algo ya pendiente.
- CANCEL: quiere cancelar el pedido o la conversacion actual.
- UNKNOWN: no se entiende o no aplica ninguna anterior.

Los clientes colombianos (incluye jerga paisa/Antioquia y otras regiones) escriben muy coloquial, con vocativos ("ome", "parce", "parcero", "mi rey", "jefe", "patron", "vea", "pues", "de una") que no cambian el significado, y con formas indirectas de pedir ("regaleme", "hagame el favor de", "me manda", "me despacha") que SIEMPRE cuentan como ORDER_PRODUCT igual que "quiero". "otro", "uno mas", "el mismo", "repitamelo" tambien son ORDER_PRODUCT (repetir/aumentar lo ya pedido). Preguntas indirectas de precio ("cuanto vale", "a como esta", "que vale") son ASK_PRICE. Tambien entiende contracciones y localismos como "pa", "pal", "pa la casa", "quiteme", "echeme", diminutivos ("papitas", "arepita", "combito"), y variantes foneticas como "barbiquiu". Nunca clasifiques como UNKNOWN solo por errores ortograficos, abreviaturas o jerga regional: interpreta la intencion real detras de la forma coloquial de escribir. Los audios transcritos llegan como una sola frase larga sin puntuacion mezclando varias cosas; clasifica segun la intencion principal del mensaje completo. Nunca respondas caricaturizando el habla paisa: entiende el regionalismo, pero clasifica con criterio semantico.

Responde SOLO el JSON pedido. confidence entre 0 y 1 segun que tan seguro estas.`;
}

export async function classifyIntent(params: {
  message: string;
  recentHistory: string;
  businessName: string;
}): Promise<IntentResult> {
  const input = `Historial reciente (mas nuevo al final):\n${params.recentHistory}\n\nUltimo mensaje del cliente: "${params.message}"`;

  const raw = await callAiJson({
    instructions: buildInstructions(params.businessName),
    input,
    schemaName: "intent_classification",
    schema: SCHEMA,
  });

  if (!raw) {
    return { intent: Intent.UNKNOWN, confidence: 0 };
  }

  try {
    const parsed = intentResultSchema.parse(JSON.parse(raw));
    return parsed;
  } catch (error) {
    logger.warn({ err: error, raw }, "Respuesta de intent classifier no valida, uso UNKNOWN");
    return { intent: Intent.UNKNOWN, confidence: 0 };
  }
}
