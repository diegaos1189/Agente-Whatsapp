import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePlatformAdmin } from "../modules/adminUsers/adminAuth.js";
import { prisma } from "../db/prisma.js";

const leadCreateSchema = z.object({
  businessName: z.string().min(1),
  contactName: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().optional(),
  message: z.string().optional(),
});

const leadStatusSchema = z.object({
  status: z.enum(["NEW", "CONTACTED", "CLOSED"]),
});

/**
 * Leads capturados desde el formulario "Quiero una demo" de la landing publica (/). El POST
 * no pide permisos de admin a proposito: lo llama el Route Handler publico del admin
 * (apps/admin/src/app/api/public-lead/route.ts), que ya es el unico que conoce el
 * ADMIN_API_TOKEN — cualquier visitante anonimo de la landing termina creando un lead aqui
 * sin necesitar sesion. Listar/actualizar si exige requireAdmin: solo el dueño de la
 * plataforma ve los leads de sus prospectos.
 */
export async function leadRoutes(app: FastifyInstance) {
  app.post("/api/leads", async (request, reply) => {
    const body = leadCreateSchema.parse(request.body);
    const lead = await prisma.lead.create({
      data: {
        businessName: body.businessName,
        contactName: body.contactName,
        phone: body.phone,
        email: body.email ?? "",
        message: body.message ?? "",
      },
    });
    reply.status(201);
    return lead;
  });

  app.get("/api/platform/leads", async (request) => {
    requirePlatformAdmin(request);
    return prisma.lead.findMany({ orderBy: { createdAt: "desc" } });
  });

  app.patch("/api/platform/leads/:id", async (request) => {
    requirePlatformAdmin(request);
    const { id } = request.params as { id: string };
    const body = leadStatusSchema.parse(request.body);
    return prisma.lead.update({ where: { id }, data: { status: body.status } });
  });
}
