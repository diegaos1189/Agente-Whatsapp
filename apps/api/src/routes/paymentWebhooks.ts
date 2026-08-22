import type { FastifyInstance } from "fastify";
import { processPaymentWebhook } from "../modules/payments/paymentService.js";

export async function paymentWebhookRoutes(app: FastifyInstance) {
  app.post("/webhooks/payments/mock", async (request, reply) => {
    try {
      const result = await processPaymentWebhook({
        provider: "MOCK",
        rawBody: request.rawBody ?? Buffer.from(JSON.stringify(request.body ?? {})),
        headers: request.headers,
      });
      return { ok: true, duplicated: result.duplicated };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : "Webhook invalido" });
    }
  });
}
