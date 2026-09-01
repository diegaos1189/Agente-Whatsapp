import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { healthRoutes } from "./routes/health.js";
import { whatsappWebhookRoutes } from "./routes/whatsapp.webhook.js";
import { conversationRoutes } from "./routes/conversations.js";
import { orderRoutes } from "./routes/orders.js";
import { productRoutes } from "./routes/products.js";
import { settingsRoutes } from "./routes/settings.js";
import { metricsRoutes } from "./routes/metrics.js";
import { adminUserRoutes } from "./routes/adminUsers.js";
import { faqRoutes } from "./routes/faqs.js";
import { platformRestaurantRoutes } from "./routes/platformRestaurants.js";
import { leadRoutes } from "./routes/leads.js";
import { paymentRoutes } from "./routes/payments.js";
import { paymentWebhookRoutes } from "./routes/paymentWebhooks.js";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function buildApp() {
  // Default de Fastify es 1MB — muy poco para el logo del negocio (subido como data URL
  // base64 dentro del JSON de /api/settings). Subido el limite a 8MB con margen.
  const app = Fastify({ loggerInstance: logger, bodyLimit: 8 * 1024 * 1024 });

  app.register(cors, { origin: env.CORS_ORIGIN });

  // Limite general anti-abuso: sin esto, cualquiera que encuentre la URL publica puede
  // saturar el webhook o la API con requests (factura de IA/WhatsApp disparada, o tumbar
  // el servidor). 300 req/min por IP alcanza de sobra para trafico real de un restaurante.
  app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    errorResponseBuilder: () => ({ error: "Demasiadas solicitudes, intenta de nuevo en un momento." }),
  });

  // Capturamos el body crudo (ademas de parsearlo como JSON normalmente) para poder
  // verificar la firma HMAC de webhooks entrantes (ej: X-Hub-Signature-256 de Meta).
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    const buffer = body as Buffer;
    request.rawBody = buffer;
    if (buffer.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(buffer.toString("utf8")));
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  // Autenticacion simple por bearer token para el panel administrativo.
  // Los webhooks de WhatsApp quedan fuera (Meta no manda este header; se validan aparte).
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;

    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

    if (!token || !safeEqual(token, env.ADMIN_API_TOKEN)) {
      return reply.status(401).send({ error: "No autorizado" });
    }
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    logger.error({ err: error, url: request.url }, "Error no controlado");
    const status = error.statusCode ?? 500;
    reply.status(status).send({ error: error.message || "Error interno" });
  });

  app.register(healthRoutes);
  app.register(whatsappWebhookRoutes);
  app.register(paymentWebhookRoutes);
  app.register(conversationRoutes);
  app.register(orderRoutes);
  app.register(paymentRoutes);
  app.register(productRoutes);
  app.register(settingsRoutes);
  app.register(metricsRoutes);
  app.register(adminUserRoutes);
  app.register(faqRoutes);
  app.register(platformRestaurantRoutes);
  app.register(leadRoutes);

  return app;
}
