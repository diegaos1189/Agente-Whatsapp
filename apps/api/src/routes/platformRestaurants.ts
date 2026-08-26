import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../modules/adminUsers/adminAuth.js";
import { getBusinessSettings } from "../modules/business/businessHoursService.js";
import { prisma } from "../db/prisma.js";

/** Id fijo de la fila que representa al restaurante corriendo en ESTE deployment. */
const LOCAL_RESTAURANT_ID = "local-deployment";

/**
 * El restaurante que ya esta funcionando en este deployment (business_settings) tambien es
 * un cliente de la plataforma, asi que se registra solo en la lista la primera vez. Solo se
 * crea si falta: despues es una fila normal, editable (ciudad, contacto, estado) sin que la
 * proxima carga pise los cambios.
 */
async function ensureLocalRestaurantListed(): Promise<void> {
  const existing = await prisma.platformRestaurant.findUnique({ where: { id: LOCAL_RESTAURANT_ID } });
  if (existing) return;

  let settings;
  try {
    settings = await getBusinessSettings();
  } catch {
    // Deployment recien creado, sin fila en business_settings: no hay nada que registrar.
    return;
  }

  await prisma.platformRestaurant.create({
    data: {
      id: LOCAL_RESTAURANT_ID,
      name: settings.restaurantName,
      city: "",
      address: settings.address,
      ownerPhone: settings.phone,
      currency: settings.currency,
      status: "ACTIVE",
    },
  });
}

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
    requireAdmin(request);
    await ensureLocalRestaurantListed();
    return prisma.platformRestaurant.findMany({ orderBy: { createdAt: "asc" } });
  });

  app.post("/api/platform/restaurants", async (request) => {
    requireAdmin(request);
    const body = restaurantCreateSchema.parse(request.body);
    return prisma.platformRestaurant.create({ data: body });
  });

  app.patch("/api/platform/restaurants/:id", async (request, reply) => {
    requireAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = restaurantUpdateSchema.parse(request.body);
    const restaurant = await prisma.platformRestaurant.findUnique({ where: { id } });
    if (!restaurant) return reply.status(404).send({ error: "Restaurante no encontrado" });
    return prisma.platformRestaurant.update({ where: { id }, data: body });
  });

  app.delete("/api/platform/restaurants/:id", async (request, reply) => {
    requireAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const restaurant = await prisma.platformRestaurant.findUnique({ where: { id } });
    if (!restaurant) return reply.status(404).send({ error: "Restaurante no encontrado" });
    await prisma.platformRestaurant.delete({ where: { id } });
    return { ok: true };
  });
}
