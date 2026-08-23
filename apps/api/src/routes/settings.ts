import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, requireAuthenticated } from "../modules/adminUsers/adminAuth.js";
import { prisma } from "../db/prisma.js";
import { getBusinessSettings, invalidateBusinessSettingsCache } from "../modules/business/businessHoursService.js";

const openingHoursDaySchema = z.object({ open: z.string(), close: z.string() }).nullable();

const settingsUpdateSchema = z.object({
  restaurantName: z.string().min(1).optional(),
  logoUrl: z.string().nullable().optional(),
  phone: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  currency: z.string().optional(),
  timezone: z.string().optional(),
  openingHours: z
    .object({
      mon: openingHoursDaySchema.optional(),
      tue: openingHoursDaySchema.optional(),
      wed: openingHoursDaySchema.optional(),
      thu: openingHoursDaySchema.optional(),
      fri: openingHoursDaySchema.optional(),
      sat: openingHoursDaySchema.optional(),
      sun: openingHoursDaySchema.optional(),
    })
    .optional(),
  deliveryFee: z.number().int().min(0).optional(),
  estimatedPrepMinutes: z.number().int().positive().optional(),
  acceptsScheduledOrders: z.boolean().optional(),
  acceptedPaymentMethods: z.array(z.enum(["CASH", "TRANSFER", "CARD_ON_DELIVERY"])).min(1).optional(),
  transferAccounts: z
    .array(
      z.object({
        bankName: z.string().min(1),
        accountInfo: z.string().min(1),
        qrImage: z.string().nullable().optional(),
      }),
    )
    .max(4, "Maximo 4 cuentas de transferencia")
    .optional(),
  outOfHoursMessage: z.string().min(1).optional(),
  // Sin minimo: vacio significa "usa el saludo por defecto" (ver conversationService.ts).
  welcomeMessage: z.string().optional(),
  assistantTone: z.string().min(1).optional(),
  agentName: z.string().optional(),
  cartRecoveryEnabled: z.boolean().optional(),
  cartRecoveryDelayMinutes: z.number().int().positive().optional(),
  cartRecoveryMaxAttempts: z.number().int().min(0).max(1).optional(),
  cartRecoveryMessage: z.string().min(1).optional(),
  upsellEnabled: z.boolean().optional(),
  maxUpsellOffers: z.number().int().min(0).max(3).optional(),
  dailyArchiveTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato de hora invalido, usa HH:MM")
    .optional(),
  whatsappProvider: z.enum(["mock", "meta"]).optional(),
  whatsappPhoneNumberId: z.string().optional(),
  whatsappToken: z.string().optional(),
  whatsappAppSecret: z.string().optional(),
  whatsappVerifyToken: z.string().optional(),
  whatsappApiVersion: z.string().optional(),
});

/** Oculta un secreto en la respuesta al panel: solo se ven los ultimos 4 caracteres. */
function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "•".repeat(value.length);
  return `••••${value.slice(-4)}`;
}

/** El campo llega sin cambios desde el formulario (todavia muestra el valor enmascarado). */
function isUnchangedMask(value: string | undefined): boolean {
  return !!value && value.startsWith("••••");
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get("/api/settings", async (request) => {
    requireAuthenticated(request);
    const settings = await getBusinessSettings();
    return {
      ...settings,
      whatsappToken: maskSecret(settings.whatsappToken),
      whatsappAppSecret: maskSecret(settings.whatsappAppSecret),
      whatsappVerifyToken: maskSecret(settings.whatsappVerifyToken),
    };
  });

  app.put("/api/settings", async (request) => {
    requireAdmin(request);
    const body = settingsUpdateSchema.parse(request.body);
    // Si el campo llego igual a como se mostro (enmascarado) o vacio, no se toca el valor real guardado.
    if (isUnchangedMask(body.whatsappToken) || body.whatsappToken === "") delete body.whatsappToken;
    if (isUnchangedMask(body.whatsappAppSecret) || body.whatsappAppSecret === "") delete body.whatsappAppSecret;
    if (isUnchangedMask(body.whatsappVerifyToken) || body.whatsappVerifyToken === "") delete body.whatsappVerifyToken;

    const current = await prisma.businessSettings.findFirst();

    const updated = current
      ? await prisma.businessSettings.update({
          where: { id: current.id },
          data: body as Parameters<typeof prisma.businessSettings.update>[0]["data"],
        })
      : await prisma.businessSettings.create({
          data: {
            restaurantName: body.restaurantName ?? "Mi Restaurante",
            phone: body.phone ?? "",
            address: body.address ?? "",
            openingHours: body.openingHours ?? {},
            outOfHoursMessage: body.outOfHoursMessage ?? "Estamos cerrados en este momento.",
            welcomeMessage: body.welcomeMessage ?? "¡Hola! Bienvenido.",
            ...body,
          },
        });

    invalidateBusinessSettingsCache();
    return updated;
  });
}
