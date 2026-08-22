import type { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma.js";
import { getBusinessSettings } from "../modules/business/businessHoursService.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async (_request, reply) => {
    const timestamp = new Date().toISOString();

    try {
      await prisma.$queryRaw`SELECT 1`;
      const settings = await getBusinessSettings();

      return {
        status: "ok",
        timestamp,
        checks: {
          api: "ok",
          database: "ok",
          whatsappConfig:
            settings.whatsappProvider === "meta"
              ? settings.whatsappPhoneNumberId && settings.whatsappToken
                ? "ok"
                : "degraded"
              : "mock",
          aiConfig: settings.restaurantName ? "ok" : "degraded",
        },
      };
    } catch (error) {
      return reply.status(503).send({
        status: "degraded",
        timestamp,
        error: error instanceof Error ? error.message : "Healthcheck failed",
      });
    }
  });
}
