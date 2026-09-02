import { Prisma } from "@prisma/client";
import { PaymentMethod, PaymentStatus, OrderStatus } from "@pollos/shared";
import { prisma } from "../../db/prisma.js";
import { getBusinessSettings } from "../business/businessHoursService.js";
import { getPaymentProvider, type ParsedPaymentWebhookEvent } from "./paymentProviderRegistry.js";

const PAID_LIKE_STATUSES = new Set<string>([
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
]);

const PROGRESS_RANK: Record<string, number> = {
  [PaymentStatus.PENDING]: 10,
  [PaymentStatus.REPORTED]: 15,
  [PaymentStatus.PROCESSING]: 20,
  [PaymentStatus.AUTHORIZED]: 30,
  [PaymentStatus.PAID]: 40,
  [PaymentStatus.PARTIALLY_REFUNDED]: 50,
  [PaymentStatus.REFUNDED]: 60,
  [PaymentStatus.FAILED]: 5,
  [PaymentStatus.CANCELLED]: 5,
};

function sanitizeFailure(input: string | null | undefined): string | null {
  if (!input) return null;
  return input.slice(0, 120);
}

export function isPaymentTerminalStatus(status: string): boolean {
  return new Set<string>([PaymentStatus.PAID, PaymentStatus.FAILED, PaymentStatus.CANCELLED, PaymentStatus.REFUNDED]).has(status);
}

export function canTransitionPaymentStatus(currentStatus: string, nextStatus: string): boolean {
  if (currentStatus === nextStatus) return true;
  if ([PaymentStatus.FAILED, PaymentStatus.CANCELLED].includes(nextStatus as any)) {
    return ![PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED].includes(currentStatus as any);
  }
  return (PROGRESS_RANK[nextStatus] ?? 0) >= (PROGRESS_RANK[currentStatus] ?? 0);
}

export function mapLegacyOrderMethodToPaymentMethod(method: string | null, deliveryType: string): string {
  if (method === PaymentMethod.TRANSFER) return PaymentMethod.BANK_TRANSFER;
  if (method === PaymentMethod.CARD_ON_DELIVERY) return deliveryType === "DELIVERY" ? PaymentMethod.CARD_ON_DELIVERY : PaymentMethod.CARD;
  return method ?? PaymentMethod.CASH;
}

export function buildInitialPaymentStatus(method: string, deliveryType: string): string {
  if (method === PaymentMethod.CASH && deliveryType === "PICKUP") return PaymentStatus.PENDING;
  if (method === PaymentMethod.CARD_ON_DELIVERY) return PaymentStatus.PENDING;
  if (method === PaymentMethod.BANK_TRANSFER || method === PaymentMethod.TRANSFER) return PaymentStatus.PENDING;
  return PaymentStatus.PENDING;
}

export function buildInitialPaymentRecord(params: {
  orderCode: string;
  amount: number;
  currency: string;
  method: string;
  deliveryType: string;
  provider?: string;
}): Prisma.PaymentUncheckedCreateWithoutOrderInput {
  return {
    method: params.method,
    amount: params.amount,
    currency: params.currency,
    provider: params.provider ?? "MANUAL",
    status: buildInitialPaymentStatus(params.method, params.deliveryType),
    providerReference: params.orderCode,
    paidAmount: 0,
    refundedAmount: 0,
    metadata: {},
  };
}

function computeOrderPaymentProjection(payments: Array<{
  status: string;
  amount: number;
  paidAmount: number;
  refundedAmount: number;
  reportedAt: Date | null;
}>): {
  paymentStatus: string;
  paidAmount: number;
  refundedAmount: number;
  netPaidAmount: number;
} {
  let paidAmount = 0;
  let refundedAmount = 0;
  let hasReported = false;
  let hasProcessing = false;
  let hasAuthorized = false;
  let hasPending = false;
  let hasFailed = false;
  let hasCancelled = false;
  let hasPaid = false;

  for (const payment of payments) {
    const effectivePaid = payment.paidAmount > 0 ? payment.paidAmount : PAID_LIKE_STATUSES.has(payment.status) ? payment.amount : 0;
    paidAmount += effectivePaid;
    refundedAmount += payment.refundedAmount ?? 0;
    if (payment.status === PaymentStatus.REPORTED || payment.reportedAt) hasReported = true;
    if (payment.status === PaymentStatus.PROCESSING) hasProcessing = true;
    if (payment.status === PaymentStatus.AUTHORIZED) hasAuthorized = true;
    if (payment.status === PaymentStatus.PENDING) hasPending = true;
    if (payment.status === PaymentStatus.FAILED) hasFailed = true;
    if (payment.status === PaymentStatus.CANCELLED) hasCancelled = true;
    if (PAID_LIKE_STATUSES.has(payment.status)) hasPaid = true;
  }

  const netPaidAmount = paidAmount - refundedAmount;
  let paymentStatus: string = PaymentStatus.PENDING;
  if (refundedAmount > 0 && netPaidAmount <= 0 && paidAmount > 0) {
    paymentStatus = PaymentStatus.REFUNDED;
  } else if (refundedAmount > 0) {
    paymentStatus = PaymentStatus.PARTIALLY_REFUNDED;
  } else if (hasPaid) {
    paymentStatus = PaymentStatus.PAID;
  } else if (hasAuthorized) {
    paymentStatus = PaymentStatus.AUTHORIZED;
  } else if (hasProcessing) {
    paymentStatus = PaymentStatus.PROCESSING;
  } else if (hasReported) {
    paymentStatus = PaymentStatus.REPORTED;
  } else if (hasPending) {
    paymentStatus = PaymentStatus.PENDING;
  } else if (hasFailed) {
    paymentStatus = PaymentStatus.FAILED;
  } else if (hasCancelled) {
    paymentStatus = PaymentStatus.CANCELLED;
  }

  return { paymentStatus, paidAmount, refundedAmount, netPaidAmount };
}

export async function refreshOrderPaymentProjectionTx(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<{ paymentStatus: string; paidAmount: number; refundedAmount: number; netPaidAmount: number }> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { payments: true },
  });
  const projection = computeOrderPaymentProjection(order.payments);
  if (projection.paymentStatus === PaymentStatus.PAID && projection.netPaidAmount < order.total) {
    projection.paymentStatus = PaymentStatus.PENDING;
  }
  await tx.order.update({
    where: { id: orderId },
    data: {
      paymentStatus: projection.paymentStatus,
    },
  });
  return projection;
}

export async function refreshOrderPaymentProjection(orderId: string) {
  return prisma.$transaction((tx) => refreshOrderPaymentProjectionTx(tx, orderId));
}

export async function createPaymentForOrder(params: {
  orderId: string;
  provider: string;
  method: string;
  idempotencyKey: string | null;
  checkoutVersion: number | null;
}): Promise<{ paymentId: string; paymentUrl: string | null; status: string }> {
  // La moneda del cobro es la del negocio dueño del pedido, no la del deployment.
  const { restaurantId } = await prisma.order.findUniqueOrThrow({
    where: { id: params.orderId },
    select: { restaurantId: true },
  });
  const settings = await getBusinessSettings(restaurantId);
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: params.orderId },
      include: { payments: true },
    });

    if (params.idempotencyKey) {
      const existing = await tx.payment.findFirst({
        where: {
          orderId: params.orderId,
          provider: params.provider,
          idempotencyKey: params.idempotencyKey,
        },
      });
      if (existing) {
        return { paymentId: existing.id, paymentUrl: existing.paymentUrl, status: existing.status };
      }
    }

    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        method: params.method,
        provider: params.provider,
        amount: order.total,
        currency: settings.currency,
        status: params.provider === "MANUAL" ? PaymentStatus.PENDING : PaymentStatus.PROCESSING,
        idempotencyKey: params.idempotencyKey,
        checkoutVersion: params.checkoutVersion,
        providerReference: order.code,
        paidAmount: 0,
        refundedAmount: 0,
        metadata: {},
      },
    });

    if (params.provider === "MANUAL") {
      await refreshOrderPaymentProjectionTx(tx, order.id);
      return { paymentId: payment.id, paymentUrl: null, status: payment.status };
    }

    const provider = getPaymentProvider(params.provider);
    const created = await provider.createPayment({
      paymentId: payment.id,
      amount: order.total,
      currency: settings.currency,
      orderCode: order.code,
      idempotencyKey: params.idempotencyKey,
    });

    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: {
        providerPaymentId: created.providerPaymentId,
        providerReference: created.providerReference,
        paymentUrl: created.paymentUrl ?? null,
        expiresAt: created.expiresAt ?? null,
        metadata: (created.raw ?? {}) as Prisma.InputJsonValue,
      },
    });
    await refreshOrderPaymentProjectionTx(tx, order.id);
    return { paymentId: updated.id, paymentUrl: updated.paymentUrl, status: updated.status };
  });
}

export async function markPaymentReported(params: { orderId: string; note?: string | null; proofImageUrl?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { orderId: params.orderId, status: PaymentStatus.PENDING },
      orderBy: { createdAt: "desc" },
    });
    if (!payment) throw new Error("No hay pago pendiente para reportar");
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.REPORTED,
        reportedAt: new Date(),
        proofImageUrl: params.proofImageUrl ?? payment.proofImageUrl,
        metadata: {
          ...((payment.metadata as Record<string, unknown> | null) ?? {}),
          reportNote: params.note ?? null,
        } as Prisma.InputJsonValue,
      },
    });
    return refreshOrderPaymentProjectionTx(tx, params.orderId);
  });
}

export async function markPaymentPaid(params: {
  orderId: string;
  paymentId?: string;
  method?: string | null;
  actor?: string | null;
  providerReference?: string | null;
  amount?: number | null;
}) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: params.orderId } });
    const payment =
      params.paymentId
        ? await tx.payment.findUnique({ where: { id: params.paymentId } })
        : await tx.payment.findFirst({ where: { orderId: params.orderId }, orderBy: { createdAt: "desc" } });
    if (!payment) throw new Error("Pago no encontrado");
    const amount = params.amount ?? order.total;
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        method: params.method ?? payment.method,
        status: PaymentStatus.PAID,
        paidAmount: amount,
        providerReference: params.providerReference ?? payment.providerReference,
        paidAt: new Date(),
        confirmedAt: new Date(),
        failureCode: null,
        failureMessage: null,
      },
    });
    const projection = await refreshOrderPaymentProjectionTx(tx, order.id);
    if (order.status === OrderStatus.AWAITING_PAYMENT) {
      await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.RECEIVED } });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          status: OrderStatus.RECEIVED,
          note: `Pago confirmado${params.actor ? ` por ${params.actor}` : ""}`,
        },
      });
    }
    return projection;
  });
}

export async function markPaymentFailed(params: { paymentId: string; failureCode?: string | null; failureMessage?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: params.paymentId } });
    if (!canTransitionPaymentStatus(payment.status, PaymentStatus.FAILED)) {
      return payment;
    }
    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.FAILED,
        failedAt: new Date(),
        failureCode: sanitizeFailure(params.failureCode),
        failureMessage: sanitizeFailure(params.failureMessage),
      },
    });
    await refreshOrderPaymentProjectionTx(tx, payment.orderId);
    return updated;
  });
}

export async function createRefund(params: {
  paymentId: string;
  amount: number;
  reasonCode?: string | null;
  requestedBy?: string | null;
  idempotencyKey?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: params.paymentId } });
    const totalRefunded = await tx.paymentRefund.aggregate({
      where: { paymentId: payment.id, status: { in: [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED] } },
      _sum: { amount: true },
    });
    const refundedSoFar = totalRefunded._sum.amount ?? 0;
    const paidAmount = payment.paidAmount > 0 ? payment.paidAmount : payment.amount;
    if (refundedSoFar + params.amount > paidAmount) {
      throw new Error("El refund supera el monto pagado");
    }
    if (params.idempotencyKey) {
      const existing = await tx.paymentRefund.findFirst({
        where: { paymentId: payment.id, idempotencyKey: params.idempotencyKey },
      });
      if (existing) return existing;
    }

    let providerRefundId: string | null = null;
    if (payment.provider !== "MANUAL") {
      const provider = getPaymentProvider(payment.provider);
      if (provider.refundPayment) {
        const result = await provider.refundPayment({
          paymentId: payment.id,
          providerPaymentId: payment.providerPaymentId,
          providerReference: payment.providerReference,
          amount: params.amount,
          currency: payment.currency,
          idempotencyKey: params.idempotencyKey ?? null,
        });
        providerRefundId = result.providerRefundId;
      }
    }

    const newRefundedAmount = refundedSoFar + params.amount;
    const newStatus = newRefundedAmount >= paidAmount ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;
    const updateResult = await tx.payment.updateMany({
      where: {
        id: payment.id,
        refundedAmount: refundedSoFar,
      },
      data: {
        refundedAmount: newRefundedAmount,
        status: newStatus,
      },
    });
    if (updateResult.count !== 1) {
      throw new Error("Conflicto concurrente al procesar refund");
    }
    const refund = await tx.paymentRefund.create({
      data: {
        paymentId: payment.id,
        amount: params.amount,
        currency: payment.currency,
        status: PaymentStatus.PAID,
        idempotencyKey: params.idempotencyKey ?? null,
        providerRefundId,
        reasonCode: params.reasonCode ?? null,
        requestedBy: params.requestedBy ?? null,
        completedAt: new Date(),
      },
    });
    await refreshOrderPaymentProjectionTx(tx, payment.orderId);
    return refund;
  });
}

function toParsedStatus(status: string): string {
  const allowed = new Set(Object.values(PaymentStatus));
  return allowed.has(status as any) ? status : PaymentStatus.PENDING;
}

export async function processPaymentWebhook(params: {
  provider: string;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
}) {
  const provider = getPaymentProvider(params.provider);
  if (!provider.verifyWebhook || !provider.parseWebhook) {
    throw new Error("Proveedor sin soporte de webhook");
  }
  if (!provider.verifyWebhook({ headers: params.headers, rawBody: params.rawBody })) {
    throw new Error("Firma de webhook invalida");
  }
  const event = provider.parseWebhook({ headers: params.headers, rawBody: params.rawBody });
  return prisma.$transaction(async (tx) => {
    const existing = await tx.paymentWebhookEvent.findUnique({
      where: { provider_eventId: { provider: event.provider, eventId: event.eventId } },
    });
    if (existing) {
      return { duplicated: true as const, paymentId: existing.paymentId };
    }

    const payment = await resolveWebhookPayment(tx, event);
    const webhookEvent = await tx.paymentWebhookEvent.create({
      data: {
        paymentId: payment?.id ?? null,
        provider: event.provider,
        eventId: event.eventId,
        eventType: event.eventType,
        providerReference: event.providerReference ?? null,
        rawPayload: event.rawPayload as Prisma.InputJsonValue,
        status: "RECEIVED",
      },
    });

    if (!payment) {
      await tx.paymentReconciliationIssue.create({
        data: {
          issueType: "MISSING_PROVIDER_PAYMENT",
          paymentId: null,
          providerReference: event.providerReference ?? null,
          note: "Webhook sin payment interno asociado",
        },
      });
      await tx.paymentWebhookEvent.update({ where: { id: webhookEvent.id }, data: { status: "PROCESSED", processedAt: new Date() } });
      return { duplicated: false as const, paymentId: null };
    }

    const nextStatus = toParsedStatus(event.status);
    if (event.amount != null && event.amount !== payment.amount) {
      await tx.paymentReconciliationIssue.create({
        data: {
          paymentId: payment.id,
          issueType: "AMOUNT_MISMATCH",
          expectedAmount: payment.amount,
          providerAmount: event.amount,
          expectedCurrency: payment.currency,
          providerCurrency: event.currency ?? payment.currency,
          providerReference: event.providerReference ?? payment.providerReference,
        },
      });
    }
    if (event.currency && event.currency !== payment.currency) {
      await tx.paymentReconciliationIssue.create({
        data: {
          paymentId: payment.id,
          issueType: "CURRENCY_MISMATCH",
          expectedAmount: payment.amount,
          providerAmount: event.amount ?? payment.amount,
          expectedCurrency: payment.currency,
          providerCurrency: event.currency,
          providerReference: event.providerReference ?? payment.providerReference,
        },
      });
    }

    if (canTransitionPaymentStatus(payment.status, nextStatus)) {
      const data: Prisma.PaymentUncheckedUpdateInput = {
        status: nextStatus,
        providerPaymentId: event.providerPaymentId ?? payment.providerPaymentId,
        providerReference: event.providerReference ?? payment.providerReference,
      };
      if (nextStatus === PaymentStatus.PAID) {
        data.paidAmount = event.amount ?? payment.amount;
        data.paidAt = new Date();
        data.confirmedAt = new Date();
      }
      if (nextStatus === PaymentStatus.FAILED) {
        data.failedAt = new Date();
      }
      if (nextStatus === PaymentStatus.CANCELLED) {
        data.cancelledAt = new Date();
      }
      await tx.payment.update({ where: { id: payment.id }, data });
      await refreshOrderPaymentProjectionTx(tx, payment.orderId);
    }

    await tx.paymentWebhookEvent.update({
      where: { id: webhookEvent.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
    return { duplicated: false as const, paymentId: payment.id };
  });
}

async function resolveWebhookPayment(tx: Prisma.TransactionClient, event: ParsedPaymentWebhookEvent) {
  if (event.paymentId) {
    const byId = await tx.payment.findUnique({ where: { id: event.paymentId } });
    if (byId) return byId;
  }
  if (event.providerPaymentId) {
    const byProviderPaymentId = await tx.payment.findFirst({
      where: { provider: event.provider, providerPaymentId: event.providerPaymentId },
    });
    if (byProviderPaymentId) return byProviderPaymentId;
  }
  if (event.providerReference) {
    return tx.payment.findFirst({
      where: { provider: event.provider, providerReference: event.providerReference },
      orderBy: { createdAt: "desc" },
    });
  }
  return null;
}

export async function reconcilePayments(params: { restaurantId: string; olderThanMinutes?: number }) {
  const olderThanMinutes = params.olderThanMinutes ?? 30;
  const threshold = new Date(Date.now() - olderThanMinutes * 60_000);
  // Los pagos no tienen restaurante propio: cuelgan del pedido, que si lo tiene.
  const payments = await prisma.payment.findMany({
    where: {
      status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING, PaymentStatus.AUTHORIZED] },
      createdAt: { lte: threshold },
      order: { restaurantId: params.restaurantId },
    },
    include: { order: true },
  });

  const issues: string[] = [];
  for (const payment of payments) {
    const issueType = payment.provider === "MOCK" ? "INTERNAL_PENDING_PROVIDER_UNKNOWN" : "INTERNAL_PENDING_PROVIDER_PAID";
    await prisma.paymentReconciliationIssue.create({
      data: {
        paymentId: payment.id,
        issueType,
        expectedAmount: payment.amount,
        expectedCurrency: payment.currency,
        providerReference: payment.providerReference,
        note: "Pago pendiente antiguo requiere revision",
      },
    });
    issues.push(payment.id);
  }
  return { reviewed: payments.length, issuesCreated: issues.length };
}

export async function listPayments(restaurantId: string) {
  return prisma.payment.findMany({
    where: { order: { restaurantId } },
    orderBy: { createdAt: "desc" },
    include: {
      refunds: { orderBy: { createdAt: "desc" } },
      webhookEvents: { orderBy: { createdAt: "desc" }, take: 10 },
      order: true,
    },
    take: 200,
  });
}

export function toPaymentDTO(payment: Awaited<ReturnType<typeof listPayments>>[number]) {
  return {
    id: payment.id,
    orderId: payment.orderId,
    method: payment.method,
    provider: payment.provider,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    paidAmount: payment.paidAmount > 0 ? payment.paidAmount : payment.status === PaymentStatus.PAID ? payment.amount : 0,
    refundedAmount: payment.refundedAmount,
    netPaidAmount: (payment.paidAmount > 0 ? payment.paidAmount : payment.status === PaymentStatus.PAID ? payment.amount : 0) - payment.refundedAmount,
    idempotencyKey: payment.idempotencyKey,
    checkoutVersion: payment.checkoutVersion,
    providerPaymentId: payment.providerPaymentId,
    providerReference: payment.providerReference,
    failureCode: payment.failureCode,
    failureMessage: payment.failureMessage,
    paymentUrl: payment.paymentUrl,
    expiresAt: payment.expiresAt?.toISOString() ?? null,
    authorizedAt: payment.authorizedAt?.toISOString() ?? null,
    paidAt: payment.paidAt?.toISOString() ?? null,
    failedAt: payment.failedAt?.toISOString() ?? null,
    cancelledAt: payment.cancelledAt?.toISOString() ?? null,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };
}
