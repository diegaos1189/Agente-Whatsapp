import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePlatformAdmin } from "../modules/adminUsers/adminAuth.js";
import {
  ensureLocalRestaurantListed,
  ensureRestaurantSettings,
  uniqueSlug,
} from "../modules/platform/restaurantContext.js";
import { prisma } from "../db/prisma.js";

const restaurantCreateSchema = z.object({
  name: z.string().min(1),
  city: z.string().min(1),
  address: z.string().default(""),
  ownerPhone: z.string().default(""),
  ownerEmail: z.string().default(""),
  currency: z.string().min(1).default("COP"),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

const restaurantUpdateSchema = restaurantCreateSchema.partial();

/**
 * CRUD del registro central de clientes de la plataforma (/super-admin/restaurantes).
 * Solo rol ADMIN: es informacion del dueño del producto, no de un restaurante.
 */
export async function platformRestaurantRoutes(app: FastifyInstance) {
  app.get("/api/platform/restaurants", async (request) => {
    requirePlatformAdmin(request);
    await ensureLocalRestaurantListed();
    return prisma.platformRestaurant.findMany({ orderBy: { createdAt: "asc" } });
  });

  app.post("/api/platform/restaurants", async (request) => {
    requirePlatformAdmin(request);
    const body = restaurantCreateSchema.parse(request.body);
    const restaurant = await prisma.platformRestaurant.create({
      data: { ...body, slug: await uniqueSlug(body.name) },
    });
    // Nace con su configuracion para que su panel (/<slug>) sea usable de una, sin un paso
    // manual intermedio: el dueño entra y ya puede cargar menu y ajustar datos.
    await ensureRestaurantSettings(restaurant);
    return restaurant;
  });

  // El panel admin resuelve /<slug> con esta ruta (pagina de entrada de cada restaurante).
  app.get("/api/platform/restaurants/by-slug/:slug", async (request, reply) => {
    requirePlatformAdmin(request);
    const { slug } = z.object({ slug: z.string() }).parse(request.params);
    const restaurant = await prisma.platformRestaurant.findUnique({ where: { slug } });
    if (!restaurant) return reply.status(404).send({ error: "Restaurante no encontrado" });
    // Restaurantes creados antes del multi-tenant no tienen configuracion propia todavia.
    await ensureRestaurantSettings(restaurant);
    return restaurant;
  });

  app.patch("/api/platform/restaurants/:id", async (request, reply) => {
    requirePlatformAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = restaurantUpdateSchema.parse(request.body);
    const restaurant = await prisma.platformRestaurant.findUnique({ where: { id } });
    if (!restaurant) return reply.status(404).send({ error: "Restaurante no encontrado" });
    return prisma.platformRestaurant.update({ where: { id }, data: body });
  });

  app.delete("/api/platform/restaurants/:id", async (request, reply) => {
    requirePlatformAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const restaurant = await prisma.platformRestaurant.findUnique({ where: { id } });
    if (!restaurant) return reply.status(404).send({ error: "Restaurante no encontrado" });
    // El catalogo y la configuracion del restaurante caen con el (onDelete: Cascade).
    await prisma.platformRestaurant.delete({ where: { id } });
    return { ok: true };
  });
}
