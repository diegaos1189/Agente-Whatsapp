import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PaymentMethod, PaymentStatus } from "@pollos/shared";
import {
  createPaymentForOrder,
  createRefund,
  listPayments,
  markPaymentPaid,
  reconcilePayments,
  toPaymentDTO,
} from "../modules/payments/paymentService.js";

function getActor(request: { headers: Record<string, unknown> }) {
  const role = String(request.headers["x-admin-role"] ?? "");
  const permissions = String(request.headers["x-admin-permissions"] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return { role, permissions };
}

function requireBillingPermission(request: { headers: Record<string, unknown> }) {
  const actor = getActor(request);
  if (!actor.role) return;
  if (actor.role === "ADMIN") return;
  if (!actor.permissions.includes("facturacion")) {
    throw new Error("No tiene permisos para gestionar pagos");
  }
}

export async function paymentRoutes(app: FastifyInstance) {
  app.get("/api/payments", async () => {
    const payments = await listPayments();
    return payments.map(toPaymentDTO);
  });

  app.post("/api/orders/:id/payments", async (request, reply) => {
    requireBillingPermission(request);
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
      requireBillingPermission(request);
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
    try {
      const actor = getActor(request);
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
    requireBillingPermission(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        orderId: z.string(),
        method: z.string().optional(),
        amount: z.number().int().positive().optional(),
        providerReference: z.string().optional(),
      })
      .parse(request.body);
    await markPaymentPaid({
      paymentId: id,
      orderId: body.orderId,
      method: body.method ?? null,
      amount: body.amount ?? null,
      providerReference: body.providerReference ?? null,
      actor: getActor(request).role || "operador",
    });
    return { ok: true, status: PaymentStatus.PAID };
  });

  app.post("/api/payments/reconcile", async (request) => {
    requireBillingPermission(request);
    return reconcilePayments();
  });
}
