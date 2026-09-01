import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { createAuthorizationError } from "../adminUsers/adminAuth.js";

/**
 * Id fijo de la fila que representa al restaurante que corre en ESTE deployment.
 *
 * Todo lo que existia antes del multi-tenant (catalogo, configuracion, pedidos,
 * conversaciones) le pertenece: la migracion 20260901120000_multi_tenant_catalog se lo
 * asigna, y es tambien el restaurante por defecto cuando un request no dice cual quiere
 * — que hoy es el caso del bot de WhatsApp (ver nota en resolveRestaurantId).
 */
export const LOCAL_RESTAURANT_ID = "local-deployment";

/** Header con el que el panel admin dice sobre que restaurante esta trabajando. */
export const RESTAURANT_HEADER = "x-restaurant-id";

/** "Dely Combos" -> "delycombos": minusculas sin tildes, solo a-z0-9, para el link publico. */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Si el slug del nombre ya esta tomado (dos negocios con el mismo nombre), numera: delycombos2, delycombos3... */
export async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || "restaurante";
  let candidate = base;
  for (let suffix = 2; ; suffix++) {
    const taken = await prisma.platformRestaurant.findUnique({ where: { slug: candidate } });
    if (!taken) return candidate;
    candidate = `${base}${suffix}`;
  }
}

/**
 * Restaurante sobre el que aplica este request.
 *
 * Fase 1 del multi-tenant: el panel manda el header con el restaurante que el usuario abrio
 * (/<slug>/productos, /<slug>/configuracion). Si no viene header, se asume el restaurante
 * local — asi el panel de siempre (/products, /settings) y, sobre todo, el bot de WhatsApp
 * siguen funcionando exactamente igual mientras no exista el ruteo por numero (fase 3).
 *
 * Se valida contra la base a proposito: sin esto, un header arbitrario crearia catalogo
 * colgando de un restaurante inexistente.
 */
export async function resolveRestaurantId(request: FastifyRequest): Promise<string> {
  const header = String(request.headers[RESTAURANT_HEADER] ?? "").trim();
  if (!header) return LOCAL_RESTAURANT_ID;

  const restaurant = await prisma.platformRestaurant.findUnique({ where: { id: header }, select: { id: true } });
  if (!restaurant) {
    throw createAuthorizationError("Restaurante no encontrado", 404);
  }
  return restaurant.id;
}

/**
 * El restaurante que ya esta funcionando en este deployment (business_settings) tambien es
 * un cliente de la plataforma, asi que se registra solo en la lista la primera vez. Solo se
 * crea si falta: despues es una fila normal, editable (ciudad, contacto, estado) sin que la
 * proxima carga pise los cambios.
 */
export async function ensureLocalRestaurantListed(): Promise<void> {
  const existing = await prisma.platformRestaurant.findUnique({ where: { id: LOCAL_RESTAURANT_ID } });
  if (existing) return;

  // Se lee la fila cruda en vez de getBusinessSettings() porque este es justamente el caso
  // en que todavia no hay restaurante al cual atribuirsela.
  const settings = await prisma.businessSettings.findFirst();
  if (!settings) {
    // Deployment recien creado, sin fila en business_settings: no hay nada que registrar.
    return;
  }

  await prisma.platformRestaurant.create({
    data: {
      id: LOCAL_RESTAURANT_ID,
      name: settings.restaurantName,
      slug: await uniqueSlug(settings.restaurantName),
      city: "",
      address: settings.address,
      ownerPhone: settings.phone,
      currency: settings.currency,
      status: "ACTIVE",
    },
  });
}

/**
 * Configuracion inicial de un restaurante recien creado en la plataforma.
 *
 * Son valores neutros a proposito (horario corrido, sin datos de ningun negocio concreto):
 * el dueño los ajusta desde /<slug>/settings, que es justamente el panel que esto habilita.
 * Sin esta fila el panel del restaurante nuevo no tendria nada que mostrar.
 */
export async function ensureRestaurantSettings(restaurant: {
  id: string;
  name: string;
  address: string;
  ownerPhone: string;
  currency: string;
}): Promise<void> {
  const existing = await prisma.businessSettings.findUnique({ where: { restaurantId: restaurant.id } });
  if (existing) return;

  const openingHours = Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [day, { open: "08:00", close: "22:00" }]),
  );

  await prisma.businessSettings.create({
    data: {
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      phone: restaurant.ownerPhone,
      address: restaurant.address,
      currency: restaurant.currency,
      openingHours,
      outOfHoursMessage: `Gracias por escribirnos. En este momento estamos cerrados, pero puedes dejar tu mensaje y te respondemos apenas abramos.`,
      welcomeMessage: `Hola, bienvenido a ${restaurant.name}. ¿En que te puedo ayudar?

1. Ver el menu
2. Hacer un pedido
3. Promociones
4. Estado de un pedido`,
    },
  });
}
