import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isProduction } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { prisma } from "../db/prisma.js";
import { parseMetaWebhookPayload, type MetaWebhookPayload } from "../modules/whatsapp/whatsappTypes.js";
import { handleIncomingMessage } from "../modules/conversation/conversationService.js";
import { getWhatsAppClient } from "../modules/whatsapp/whatsappClient.js";
import { getBusinessSettings } from "../modules/business/businessHoursService.js";
import { resolveRestaurantIdByWhatsAppPhoneNumberId } from "../modules/platform/restaurantContext.js";
import { incomingWhatsAppMessageIdempotencyService } from "../modules/whatsapp/incomingWhatsAppMessageIdempotencyService.js";

const verifyQuerySchema = z.object({
  "hub.mode": z.string().optional(),
  "hub.verify_token": z.string().optional(),
  "hub.challenge": z.string().optional(),
});

/**
 * Verifica que el request realmente venga de Meta comparando la firma HMAC-SHA256
 * del body crudo (header X-Hub-Signature-256) contra la calculada con el app secret
 * configurado para este negocio. Si no hay app secret configurado, no valida (modo dev/mock).
 */
function isValidMetaSignature(appSecret: string, rawBody: Buffer | undefined, signatureHeader: string | undefined): boolean {
  if (!appSecret) return true;
  if (!signatureHeader || !rawBody) return false;

  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signatureHeader);
  if (expectedBuffer.length !== receivedBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

/**
 * Numero del negocio que recibio el lote (phone_number_id de Meta), leido del payload crudo.
 *
 * Todos los mensajes de un mismo POST llegan al mismo numero, asi que basta con mirar el
 * primer `entry`. Se lee ANTES de verificar la firma porque es justamente lo que dice con que
 * app secret hay que verificarla — el dato todavia no es de fiar aca, y por eso lo unico que
 * se hace con el es elegir un restaurante; si el elegido no valida la firma, el request muere.
 */
function readPhoneNumberId(payload: MetaWebhookPayload): string | null {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const id = change.value?.metadata?.phone_number_id;
      if (id) return id;
    }
  }
  return null;
}

export async function whatsappWebhookRoutes(app: FastifyInstance) {
  // Verificacion inicial del webhook por parte de Meta. Cada restaurante configura su propio
  // verify token, asi que el reto se acepta si coincide con el de CUALQUIER restaurante: es
  // la misma URL de webhook para todos y Meta no manda nada mas con que distinguirlos.
  app.get("/webhooks/whatsapp", async (request, reply) => {
    const query = verifyQuerySchema.parse(request.query);
    const token = query["hub.verify_token"] ?? "";

    // El token vacio nunca puede pasar: si algun restaurante todavia no lo configuro, su
    // campo esta en "" y un reto sin token le calzaria.
    const matches = token
      ? await prisma.businessSettings.count({ where: { whatsappVerifyToken: token } })
      : 0;

    if (query["hub.mode"] === "subscribe" && matches > 0) {
      return reply.status(200).send(query["hub.challenge"] ?? "");
    }

    return reply.status(403).send("Verificacion fallida");
  });

  // Mensajes entrantes. Siempre respondemos 200 rapido para que Meta no reintente
  // en bucle; los errores de procesamiento se loguean pero no se propagan al webhook.
  app.post("/webhooks/whatsapp", async (request, reply) => {
    const payload = request.body as MetaWebhookPayload;

    // A que negocio le escribieron. Sin numero en el payload (curl de prueba, modo mock) cae
    // al restaurante local, que es el comportamiento de un deployment de un solo negocio.
    const restaurantId = await resolveRestaurantIdByWhatsAppPhoneNumberId(readPhoneNumberId(payload));
    const settings = await getBusinessSettings(restaurantId);

    // En produccion con el proveedor real de Meta, el app secret es obligatorio: sin el
    // no se puede verificar la firma HMAC y cualquiera que conozca la URL podria inyectar
    // mensajes falsos (pedidos inventados, gasto de IA). Fallamos cerrado en vez de confiar.
    // Esto tambien es lo que impide usar el ruteo de arriba para esquivar la verificacion:
    // apuntarle a un restaurante sin app secret no abre la puerta, la cierra.
    if (isProduction && settings.whatsappProvider === "meta" && !settings.whatsappAppSecret) {
      logger.error(
        { restaurantId },
        "Webhook de WhatsApp rechazado: falta el app secret en produccion (configuralo en Configuracion)",
      );
      return reply.status(403).send({ error: "Webhook sin verificacion configurada" });
    }

    const signature = request.headers["x-hub-signature-256"];
    if (!isValidMetaSignature(settings.whatsappAppSecret, request.rawBody, Array.isArray(signature) ? signature[0] : signature)) {
      logger.warn({ restaurantId }, "Webhook de WhatsApp con firma invalida, se rechaza");
      return reply.status(403).send({ error: "Firma invalida" });
    }

    reply.status(200).send({ received: true });

    try {
      const messages = parseMetaWebhookPayload(payload);

      for (const msg of messages) {
        const claimed = await incomingWhatsAppMessageIdempotencyService.claim({
          waMessageId: msg.waMessageId,
          fromPhone: msg.from,
          inboundType: msg.type,
          providerTimestamp: msg.timestamp,
        });
        if (!claimed) {
          logger.info({ waMessageId: msg.waMessageId }, "Mensaje de WhatsApp duplicado, se ignora");
          continue;
        }

        // Marca leido + "escribiendo..." de inmediato: la IA tarda unos segundos en
        // responder y esto le da feedback visual al cliente mientras tanto.
        getWhatsAppClient(restaurantId)
          .then((client) => client.markAsReadWithTyping(msg.waMessageId))
          .catch((error) => logger.warn({ err: error }, "Fallo mostrando indicador de escribiendo"));

        await handleIncomingMessage({
          restaurantId,
          waMessageId: msg.waMessageId,
          phone: msg.from,
          name: msg.name,
          type: msg.type,
          text: msg.text,
          mediaId: msg.mediaId,
          mediaMimeType: msg.mediaMimeType,
          providerTimestamp: msg.timestamp,
        });
      }
    } catch (error) {
      logger.error({ err: error }, "Error procesando webhook de WhatsApp");
    }
  });
}
