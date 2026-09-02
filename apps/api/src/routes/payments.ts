import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PaymentMethod, PaymentStatus } from "@pollos/shared";
import { getAdminActor, requirePermission } from "../modules/adminUsers/adminAuth.js";
import {
  createPaymentForOrder,
  createRefund,
  listPayments,
  markPaymentPaid,
  reconcilePayments,
  toPaymentDTO,
} from "../modules/payments/paymentService.js";
import { prisma } from "../db/prisma.js";
import { resolveRestaurantId } from "../modules/platform/restaurantContext.js";

/**
 * Pedido del restaurante del request. Los pagos no llevan restaurante propio (cuelgan del
 * pedido), asi que este es el chequeo que impide cobrar o reembolsar el pedido de otro.
 */
async function findOwnOrder(request: Parameters<typeof resolveRestaurantId>[0], orderId: string) {
  return prisma.order.findFirst({
    where: { id: orderId, restaurantId: await resolveRestaurantId(request) },
    select: { id: true },
  });
}

/** Idem para un pago, resuelto a traves de su pedido. */
async function findOwnPayment(request: Parameters<typeof resolveRestaurantId>[0], paymentId: string) {
  return prisma.payment.findFirst({
    where: { id: paymentId, order: { restaurantId: await resolveRestaurantId(request) } },
    select: { id: true },
  });
}

export async function paymentRoutes(app: FastifyInstance) {
  app.get("/api/payments", async (request) => {
    requirePermission(request, "facturacion");
    const payments = await listPayments(await resolveRestaurantId(request));
    return payments.map(toPaymentDTO);
  });

  app.post("/api/orders/:id/payments", async (request, reply) => {
    requirePermission(request, "facturacion");
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        provider: z.string().default("MOCK"),
        method: z
          .enum([
            PaymentMethod.CASH,
            PaymentMethod.CARD,
            PaymentMethod.CARD_ON_DELIVERY,
            PaymentMethod.TRANSFER,
            PaymentMethod.BANK_TRANSFER,
            PaymentMethod.ONLINE_PAYMENT,
          ])
          .default(PaymentMethod.ONLINE_PAYMENT),
        idempotencyKey: z.string().min(1).optional(),
        checkoutVersion: z.number().int().min(0).nullable().optional(),
      })
      .parse(request.body);

    if (!(await findOwnOrder(request, id))) {
      return reply.status(404).send({ error: "Pedido no encontrado" });
    }

    const payment = await createPaymentForOrder({
      orderId: id,
      provider: body.provider,
      method: body.method,
      idempotencyKey: body.idempotencyKey ?? null,
      checkoutVersion: body.checkoutVersion ?? null,
    });
    return payment;
  });

  app.post("/api/payments/:id/refunds", async (request, reply) => {
    try {
      requirePermission(request, "facturacion");
    } catch (error) {
      return reply.status(403).send({ error: error instanceof Error ? error.message : "No autorizado" });
    }
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        amount: z.number().int().positive(),
        reasonCode: z.string().optional(),
        idempotencyKey: z.string().min(1).optional(),
      })
      .parse(request.body);
    if (!(await findOwnPayment(request, id))) {
      return reply.status(404).send({ error: "Pago no encontrado" });
    }
    try {
      const actor = getAdminActor(request);
      return await createRefund({
        paymentId: id,
        amount: body.amount,
        reasonCode: body.reasonCode ?? null,
        requestedBy: actor.role ? `${actor.role}` : "system",
        idempotencyKey: body.idempotencyKey ?? null,
      });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : "No se pudo crear el refund" });
    }
  });

  app.post("/api/payments/:id/mark-paid", async (request, reply) => {
    requirePermission(request, "facturacion");
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        orderId: z.string(),
        method: z.string().optional(),
        amount: z.number().int().positive().optional(),
        providerReference: z.string().optional(),
      })
      .parse(request.body);
    if (!(await findOwnPayment(request, id)) || !(await findOwnOrder(request, body.orderId))) {
      return reply.status(404).send({ error: "Pago no encontrado" });
    }
    await markPaymentPaid({
      paymentId: id,
      orderId: body.orderId,
      method: body.method ?? null,
      amount: body.amount ?? null,
      providerReference: body.providerReference ?? null,
      actor: getAdminActor(request).role || "operador",
    });
    return { ok: true, status: PaymentStatus.PAID };
  });

  app.post("/api/payments/reconcile", async (request) => {
    requirePermission(request, "facturacion");
    return reconcilePayments({ restaurantId: await resolveRestaurantId(request) });
  });
}
