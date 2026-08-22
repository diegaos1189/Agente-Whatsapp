import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getMetrics, getMetricsForRange } from "../modules/metrics/metricsService.js";

export async function metricsRoutes(app: FastifyInstance) {
  app.get("/api/metrics", async () => getMetrics());

  app.get("/api/metrics/range", async (request, reply) => {
    const query = z.object({ from: z.string(), to: z.string() }).parse(request.query);
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return reply.status(400).send({ error: "Fechas invalidas" });
    }
    return getMetricsForRange(from, to);
  });
}
