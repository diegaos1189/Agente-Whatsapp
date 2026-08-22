import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "../utils/logger.js";
import { parseMetaWebhookPayload, type MetaWebhookPayload } from "../modules/whatsapp/whatsappTypes.js";
import { handleIncomingMessage } from "../modules/conversation/conversationService.js";
import { getWhatsAppClient } from "../modules/whatsapp/whatsappClient.js";
import { getBusinessSettings } from "../modules/business/businessHoursService.js";
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

export async function whatsappWebhookRoutes(app: FastifyInstance) {
  // Verificacion inicial del webhook por parte de Meta.
  app.get("/webhooks/whatsapp", async (request, reply) => {
    const query = verifyQuerySchema.parse(request.query);
    const settings = await getBusinessSettings();

    if (query["hub.mode"] === "subscribe" && query["hub.verify_token"] === settings.whatsappVerifyToken) {
      return reply.status(200).send(query["hub.challenge"] ?? "");
    }

    return reply.status(403).send("Verificacion fallida");
  });

  // Mensajes entrantes. Siempre respondemos 200 rapido para que Meta no reintente
  // en bucle; los errores de procesamiento se loguean pero no se propagan al webhook.
  app.post("/webhooks/whatsapp", async (request, reply) => {
    const settings = await getBusinessSettings();
    const signature = request.headers["x-hub-signature-256"];
    if (!isValidMetaSignature(settings.whatsappAppSecret, request.rawBody, Array.isArray(signature) ? signature[0] : signature)) {
      logger.warn("Webhook de WhatsApp con firma invalida, se rechaza");
      return reply.status(403).send({ error: "Firma invalida" });
    }

    reply.status(200).send({ received: true });

    try {
      const payload = request.body as MetaWebhookPayload;
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
        getWhatsAppClient()
          .then((client) => client.markAsReadWithTyping(msg.waMessageId))
          .catch((error) => logger.warn({ err: error }, "Fallo mostrando indicador de escribiendo"));

        await handleIncomingMessage({
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
