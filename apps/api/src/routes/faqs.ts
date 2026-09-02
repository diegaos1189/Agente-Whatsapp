import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePermission } from "../modules/adminUsers/adminAuth.js";
import { prisma } from "../db/prisma.js";
import { listAllFaqs } from "../modules/faq/faqService.js";
import { resolveRestaurantId } from "../modules/platform/restaurantContext.js";

const faqCreateSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  isActive: z.boolean().optional(),
});

const faqUpdateSchema = z.object({
  question: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export async function faqRoutes(app: FastifyInstance) {
  app.get("/api/faqs", async (request) => {
    requirePermission(request, "faqs");
    return listAllFaqs(await resolveRestaurantId(request));
  });

  app.post("/api/faqs", async (request) => {
    requirePermission(request, "faqs");
    const body = faqCreateSchema.parse(request.body);
    return prisma.faq.create({ data: { ...body, restaurantId: await resolveRestaurantId(request) } });
  });

  app.patch("/api/faqs/:id", async (request, reply) => {
    requirePermission(request, "faqs");
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = faqUpdateSchema.parse(request.body);
    const faq = await prisma.faq.findFirst({ where: { id, restaurantId: await resolveRestaurantId(request) } });
    if (!faq) return reply.status(404).send({ error: "FAQ no encontrada" });
    return prisma.faq.update({ where: { id }, data: body });
  });

  app.delete("/api/faqs/:id", async (request, reply) => {
    requirePermission(request, "faqs");
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const faq = await prisma.faq.findFirst({ where: { id, restaurantId: await resolveRestaurantId(request) } });
    if (!faq) return reply.status(404).send({ error: "FAQ no encontrada" });
    await prisma.faq.delete({ where: { id } });
    return { ok: true };
  });
}
