import { z } from "zod";
import { DeliveryType, PaymentMethod } from "@pollos/shared";
import { callAiJson } from "./aiClient.js";
import type { NeutralSchema } from "./schema.js";
import { logger } from "../../utils/logger.js";

const entitySchema = z.object({
  productType: z.string().nullable(),
  quantity: z.number().int().positive().nullable(),
  size: z.string().nullable(),
  sides: z.array(z.string()).nullable(),
  deliveryType: z.enum([DeliveryType.DELIVERY, DeliveryType.PICKUP]).nullable(),
  address: z.string().nullable(),
  neighborhood: z.string().nullable(),
  reference: z.string().nullable(),
  paymentMethod: z
    .enum([PaymentMethod.CASH, PaymentMethod.TRANSFER, PaymentMethod.CARD_ON_DELIVERY])
    .nullable(),
  name: z.string().nullable(),
  contactPhone: z.string().nullable(),
});

export type ExtractedEntities = z.infer<typeof entitySchema>;

export const EMPTY_ENTITIES: ExtractedEntities = {
  productType: null,
  quantity: null,
  size: null,
  sides: null,
  deliveryType: null,
  address: null,
  neighborhood: null,
  reference: null,
  paymentMethod: null,
  name: null,
  contactPhone: null,
};

const SCHEMA: NeutralSchema = {
  type: "object",
  properties: {
    productType: {
      type: "string",
      nullable: true,
      description: "nombre o tipo de producto del menu que el cliente menciono (ej: pizza, hamburguesa, combo, gaseosa)",
    },
    quantity: {
      type: "number",
      nullable: true,
      description:
        "cuantas unidades del producto principal pide. Interpreta articulos indefinidos como cantidad: 'un'/'una' = 1, 'dos' = 2, etc. Si el cliente solo menciona el producto sin decir cantidad de forma alguna, usa null (no asumas 1).",
    },
    size: { type: "string", nullable: true, description: "tamano o variante si se menciona (ej: grande, mediana, 8 piezas, doble carne)" },
    sides: { type: "array", nullable: true, items: { type: "string" } },
    deliveryType: { type: "string", nullable: true, enum: [DeliveryType.DELIVERY, DeliveryType.PICKUP] },
    address: { type: "string", nullable: true },
    neighborhood: { type: "string", nullable: true },
    reference: { type: "string", nullable: true, description: "punto de referencia para la entrega" },
    paymentMethod: {
      type: "string",
      nullable: true,
      enum: [PaymentMethod.CASH, PaymentMethod.TRANSFER, PaymentMethod.CARD_ON_DELIVERY],
    },
    name: { type: "string", nullable: true, description: "nombre del cliente si lo menciona" },
    contactPhone: {
      type: "string",
      nullable: true,
      description: "numero de telefono de contacto para el domiciliario, SOLO si el cliente da un numero explicito (puede ser distinto al de WhatsApp, ej: 'llamen al 3001234567' o 'contacto: 3001234567')",
    },
  },
  required: [
    "productType",
    "quantity",
    "size",
    "sides",
    "deliveryType",
    "address",
    "neighborhood",
    "reference",
    "paymentMethod",
    "name",
    "contactPhone",
  ],
};

function buildInstructions(businessName: string): string {
  return `Extraes entidades de mensajes de WhatsApp de clientes de "${businessName}", un negocio de comida.
Devuelve SOLO datos que el cliente menciono explicita o implicitamente en su ULTIMO mensaje (usa el historial solo como contexto para desambiguar, no inventes datos que no esten en el ultimo mensaje).
Si un dato no esta presente, usa null. No inventes direcciones, nombres, ni cantidades.
"domicilio", "a mi casa", "me lo llevan" implica deliveryType=DELIVERY.
"recojo", "paso por el", "para recoger" implica deliveryType=PICKUP.
"efectivo", "cash" implica paymentMethod=CASH. "transferencia", "nequi", "daviplata" implica TRANSFER. "tarjeta contraentrega" implica CARD_ON_DELIVERY.
Los clientes colombianos (incluye jerga paisa/Antioquia y otras regiones) suelen escribir de forma muy coloquial. Interpreta esto con naturalidad, NUNCA rechaces ni pidas reformular un mensaje solo por su forma:
- Vocativos y muletillas que van pegados al pedido pero no significan nada por si solos: "ome", "parce", "parcero", "vecino", "mi rey", "mi reina", "jefe", "patron", "socio", "nea", "vea", "hagale", "pues", "de una". Ignoralos como relleno, nunca los tomes como parte de un nombre de producto.
- Formas de pedir que NO son un regalo literal ni una pregunta abierta, son sinonimos directos de "quiero pedir": "regaleme", "me regalas", "hagame el favor de", "me hace un favor y me manda", "me manda", "me envia", "me despacha", "me hace". Trata "regaleme un X" exactamente igual que "quiero un X".
- En Antioquia/es-CO tambien aparecen contracciones o giros como "pa", "pal", "pa la casa", "quiteme", "quitele", "no le eche", "echeme", "cambieme", "mandemelo", y diminutivos como "papitas", "arepita", "combito", "gaseosita". Interpretalos con naturalidad y extrae el dato real del menu o del delivery.
- Repetir o aumentar el pedido anterior: "otro", "uno mas", "deme otro", "el mismo", "igual al anterior", "repitamelo", "otro igual" - usa el historial reciente para saber a que producto se refiere y sube la cantidad en consecuencia; no dejes productType/quantity en null si el historial deja claro de que producto se trata.
- Preguntas de precio dichas de forma indirecta: "cuanto vale", "en cuanto sale", "a como esta", "que vale", "cuanto me sale" - es una pregunta de precio sobre lo que se menciona junto a la frase.
- Modificadores sobre el producto ("sin X", "mas X", "doble X", "extra X", "bien tostado/crocante/dorado/calentico") van en "sides" como texto libre, no los descartes.
- Variantes foneticas o regionales de sabores/marcas como "barbiquiu", "barbikiu", "cocacola", "coca cola", "picantico" o "salsita" deben mapearse a la forma mas probable segun el contexto del menu, no descartarse.
- Tolera errores ortograficos, letras dobladas o cambiadas foneticamente (ej: "s"/"z" intercambiadas, letras que faltan o sobran) y abreviaturas - interpreta la palabra mas parecida del contexto en vez de ignorar el dato.
- Los audios transcritos suelen llegar como una sola frase larga sin puntuacion, mezclando saludo, pedido, modificadores y entrega todo junto (ej: "vea pues mi rey mandeme uno con papa y una gaseosa grande pa la casa") - procesa la frase completa y extrae TODOS los datos presentes, no solo el primero.
- Cantidades dichas en palabras: "litro y medio" = "1.5 litros" o "1.5L", "media libra" = "0.5 libras", "docena" = "12". Normaliza esto en el campo "size" usando numeros (ej: size="1.5L") para que coincida con como esta escrito en el menu, en vez de dejarlo en palabras.

Pregunta pendiente del bot: si el input trae una linea "El bot esta esperando respuesta a: ...", el ultimo mensaje casi siempre responde ESA pregunta. Usala para decidir en que campo va un mensaje corto o ambiguo, en vez de dejar todo en null o meterlo en el campo equivocado:
- Si la pregunta pendiente es por ACOMPANANTES, un nombre de comida suelto ("ensalada", "papa salada", "arepa", "papitas") va en "sides" como texto libre, NUNCA en "productType" (ese campo es solo para el producto principal del pedido). Lo mismo si menciona varios ("ensalada y papas").
- Si la pregunta pendiente es por BEBIDAS, la bebida mencionada ("gaseosa", "coca cola", "jugo") va en "productType" (y "quantity"/"size" si los dice).
- Si la pregunta pendiente es por CANTIDAD, un numero suelto ("dos", "2") va en "quantity"; si es por DIRECCION, el texto va en "address"/"neighborhood"/"reference"; si es por METODO DE PAGO, va en "paymentMethod"; si es por domicilio o recoger, va en "deliveryType".
- Si el cliente declina la pregunta pendiente ("no", "no gracias", "asi esta bien", "nada mas", "ninguno"), no esta nombrando ningun producto: deja TODOS los campos en null, no inventes un productType ni un side.`;
}

export async function extractEntities(params: {
  message: string;
  recentHistory: string;
  businessName: string;
  /**
   * Pregunta del flujo de pedido que quedo pendiente en el turno anterior (ver
   * getPendingOrderQuestion en orderFlow). Sin este dato, un "Ensalada" suelto contestando la
   * pregunta de acompanantes salia en productType, sides quedaba vacio y el bot re-preguntaba
   * lo mismo en bucle.
   */
  pendingQuestion?: string | null;
}): Promise<ExtractedEntities> {
  const pendingLine = params.pendingQuestion ? `El bot esta esperando respuesta a: ${params.pendingQuestion}\n\n` : "";
  const input = `${pendingLine}Historial reciente:\n${params.recentHistory}\n\nUltimo mensaje del cliente: "${params.message}"`;

  const raw = await callAiJson({
    instructions: buildInstructions(params.businessName),
    input,
    schemaName: "entity_extraction",
    schema: SCHEMA,
  });

  if (!raw) {
    return EMPTY_ENTITIES;
  }

  try {
    return entitySchema.parse(JSON.parse(raw));
  } catch (error) {
    logger.warn({ err: error, raw }, "Respuesta de entity extractor no valida, uso vacio");
    return EMPTY_ENTITIES;
  }
}
