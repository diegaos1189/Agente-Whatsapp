import type { FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { logger } from "../../utils/logger.js";
import { createAuthorizationError, getAdminActor } from "../adminUsers/adminAuth.js";

/**
 * Id fijo de la fila que representa al restaurante que corre en ESTE deployment.
 *
 * Todo lo que existia antes del multi-tenant (catalogo, configuracion, pedidos,
 * conversaciones) le pertenece: las migraciones multi_tenant_catalog y multi_tenant_operations
 * se lo asignan. Es tambien el restaurante por defecto cuando un request no dice cual quiere
 * (el panel de la raiz) y cuando un mensaje de WhatsApp no se puede rutear a ningun otro.
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

/**
 * Nombres que no pueden ser el slug de un restaurante porque ya son secciones del panel.
 *
 * El link publico de un cliente es <panel>/<slug>, asi que un negocio llamado "Orders" con
 * slug "orders" chocaria con /orders — el panel resuelve el primer segmento comparandolo
 * contra esta misma lista (ver PANEL_SECTIONS en el admin).
 */
const RESERVED_SLUGS = new Set([
  "metrics",
  "conversations",
  "orders",
  "products",
  "promotions",
  "recommendations",
  "faqs",
  "kitchen",
  "facturacion",
  "capacitacion",
  "settings",
  "users",
  "login",
  "api",
]);

/** Si el slug del nombre ya esta tomado (dos negocios con el mismo nombre), numera: delycombos2, delycombos3... */
export async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || "restaurante";
  let candidate = RESERVED_SLUGS.has(base) ? `${base}2` : base;
  for (let suffix = 2; ; suffix++) {
    const taken = await prisma.platformRestaurant.findUnique({ where: { slug: candidate } });
    if (!taken && !RESERVED_SLUGS.has(candidate)) return candidate;
    candidate = `${base}${suffix}`;
  }
}

/**
 * Restaurante sobre el que aplica este request.
 *
 * El panel manda el header con el restaurante que el usuario abrio (/<slug>/pedidos,
 * /<slug>/conversaciones...). Si no viene header se asume el restaurante local, que es el
 * que atiende el panel de siempre en la raiz (/orders, /settings).
 *
 * El header viene del navegador, asi que NO alcanza por si solo: si el usuario pertenece a
 * un restaurante, ese gana siempre y un header que apunte a otro se rechaza. Sin esto, el
 * dueño de un negocio podria leer los pedidos de otro cambiando un header a mano.
 *
 * Ademas se valida contra la base: sin eso, un header arbitrario crearia datos colgando de
 * un restaurante inexistente.
 */
export async function resolveRestaurantId(request: FastifyRequest): Promise<string> {
  const header = String(request.headers[RESTAURANT_HEADER] ?? "").trim();
  const actorRestaurantId = getAdminActor(request).restaurantId;

  if (actorRestaurantId) {
    if (header && header !== actorRestaurantId) {
      throw createAuthorizationError("No tiene acceso a ese restaurante");
    }
    return actorRestaurantId;
  }

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

/**
 * Restaurante al que le escribieron por WhatsApp, identificado por el numero del negocio que
 * recibio el mensaje (phone_number_id de Meta).
 *
 * Es el ruteo que hace multi-tenant al bot: cada cliente configura sus propias credenciales
 * de WhatsApp en /<slug>/settings, y el numero que recibio el mensaje dice de quien es el
 * chat. Sin esto, todos los mensajes de todos los negocios caerian en el restaurante local.
 *
 * Cae al restaurante local cuando el payload no trae numero (modo mock, curl de prueba) o
 * cuando ningun restaurante lo tiene configurado — que es exactamente el deployment de un
 * solo negocio, donde el numero vive en el .env y no hace falta rutear nada.
 */
export async function resolveRestaurantIdByWhatsAppPhoneNumberId(phoneNumberId: string | null): Promise<string> {
  if (!phoneNumberId) return LOCAL_RESTAURANT_ID;

  const settings = await prisma.businessSettings.findFirst({
    where: { whatsappPhoneNumberId: phoneNumberId },
    select: { restaurantId: true },
  });
  if (settings) return settings.restaurantId;

  logger.warn(
    { phoneNumberId },
    "Mensaje de WhatsApp de un numero que ningun restaurante tiene configurado: se atiende como el restaurante local",
  );
  return LOCAL_RESTAURANT_ID;
}

/**
 * Restaurante cuyos USUARIOS se estan administrando. null = usuarios de la plataforma (los
 * del dueño del producto, que no pertenecen a ningun cliente).
 *
 * Se distingue de resolveRestaurantId porque aca "sin header" no significa "el local": el
 * dueño de la plataforma sin header administra a los suyos, y con header administra los del
 * cliente que abrio. Un usuario de restaurante solo puede administrar los de su restaurante.
 */
export async function resolveAdminUserScope(request: FastifyRequest): Promise<string | null> {
  const actorRestaurantId = getAdminActor(request).restaurantId;
  const header = String(request.headers[RESTAURANT_HEADER] ?? "").trim();

  if (actorRestaurantId) {
    if (header && header !== actorRestaurantId) {
      throw createAuthorizationError("No tiene acceso a ese restaurante");
    }
    return actorRestaurantId;
  }

  if (!header) return null;

  const restaurant = await prisma.platformRestaurant.findUnique({ where: { id: header }, select: { id: true } });
  if (!restaurant) {
    throw createAuthorizationError("Restaurante no encontrado", 404);
  }
  return restaurant.id;
}
