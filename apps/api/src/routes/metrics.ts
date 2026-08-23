import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePermission } from "../modules/adminUsers/adminAuth.js";
import { getCustomerSegmentCustomers, getMetrics, getMetricsForRange } from "../modules/metrics/metricsService.js";

export async function metricsRoutes(app: FastifyInstance) {
  app.get("/api/metrics", async (request) => {
    requirePermission(request, "metrics");
    return getMetrics();
  });

  app.get("/api/metrics/range", async (request, reply) => {
    requirePermission(request, "metrics");
    const query = z.object({ from: z.string(), to: z.string() }).parse(request.query);
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return reply.status(400).send({ error: "Fechas invalidas" });
    }
    return getMetricsForRange(from, to);
  });

  app.get("/api/metrics/customers", async (request) => {
    requirePermission(request, "metrics");
    const query = z.object({ limit: z.coerce.number().int().min(1).max(50).optional() }).parse(request.query);
    return getCustomerSegmentCustomers(query.limit);
  });
}
