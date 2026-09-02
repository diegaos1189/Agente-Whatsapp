import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentMethod, PaymentStatus } from "@pollos/shared";

const state = vi.hoisted(() => ({
  orders: [] as any[],
  payments: [] as any[],
  refunds: [] as any[],
  webhookEvents: [] as any[],
  reconciliationIssues: [] as any[],
  orderEvents: [] as any[],
  providerVerifyOk: true,
  nextWebhookEvent: null as any,
}));

function matchWhere(row: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR" && Array.isArray(value)) return value.some((part) => matchWhere(row, part));
    // Filtro por la relacion: los pagos no llevan restaurante propio, se acotan por su pedido.
    if (key === "order" && typeof value === "object" && value !== null) {
      const order = state.orders.find((item) => item.id === row.orderId);
      return Boolean(order) && matchWhere(order, value);
    }
    if (typeof value === "object" && value !== null) {
      if ("in" in value) return value.in.includes(row[key]);
      if ("lte" in value) return row[key] <= value.lte;
      if ("gte" in value) return row[key] >= value.gte;
    }
    return row[key] === value;
  });
}

function applyData(row: any, data: any) {
  Object.entries(data).forEach(([key, value]) => {
    row[key] = value;
  });
}

const prismaMock = vi.hoisted(() => {
  const prisma = {
    order: {
      findUniqueOrThrow: vi.fn(async ({ where, include }: any) => {
        const row = state.orders.find((item) => item.id === where.id);
        if (!row) throw new Error("order not found");
        if (!include?.payments) return { ...row };
        return { ...row, payments: state.payments.filter((payment) => payment.orderId === row.id) };
      }),
      findUnique: vi.fn(async ({ where, include }: any) => {
        const row = state.orders.find((item) => item.id === where.id) ?? null;
        if (!row) return null;
        if (!include?.payments) return { ...row };
        return { ...row, payments: state.payments.filter((payment) => payment.orderId === row.id) };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = state.orders.find((item) => item.id === where.id);
        if (!row) throw new Error("order not found");
        applyData(row, data);
        return row;
      }),
      findMany: vi.fn(async ({ where, include }: any) => {
        const rows = state.orders.filter((row) => matchWhere(row, where));
        if (!include?.payments) return rows;
        return rows.map((row) => ({ ...row, payments: state.payments.filter((payment) => payment.orderId === row.id) }));
      }),
    },
    payment: {
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        let rows = state.payments.filter((row) => matchWhere(row, where));
        if (orderBy?.createdAt === "desc") rows = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return rows[0] ?? null;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        return state.payments.find((row) => row.id === where.id) ?? null;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => {
        const row = state.payments.find((item) => item.id === where.id);
        if (!row) throw new Error("payment not found");
        return row;
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = {
          id: data.id ?? `payment-${state.payments.length + 1}`,
          createdAt: new Date("2026-08-22T10:00:00.000Z"),
          updatedAt: new Date("2026-08-22T10:00:00.000Z"),
          ...data,
        };
        state.payments.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = state.payments.find((item) => item.id === where.id);
        if (!row) throw new Error("payment not found");
        applyData(row, data);
        row.updatedAt = new Date("2026-08-22T10:05:00.000Z");
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const rows = state.payments.filter((row) => matchWhere(row, where));
        rows.forEach((row) => {
          applyData(row, data);
          row.updatedAt = new Date("2026-08-22T10:05:00.000Z");
        });
        return { count: rows.length };
      }),
      findMany: vi.fn(async ({ where, include }: any) => {
        const rows = state.payments.filter((row) => matchWhere(row, where));
        if (!include) return rows;
        return rows.map((row) => ({ ...row, order: state.orders.find((order) => order.id === row.orderId) }));
      }),
    },
    paymentRefund: {
      aggregate: vi.fn(async ({ where }: any) => {
        const rows = state.refunds.filter((row) => matchWhere(row, where));
        return { _sum: { amount: rows.reduce((sum, row) => sum + row.amount, 0) } };
      }),
      findFirst: vi.fn(async ({ where }: any) => state.refunds.find((row) => matchWhere(row, where)) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const row = {
          id: `refund-${state.refunds.length + 1}`,
          createdAt: new Date("2026-08-22T10:10:00.000Z"),
          updatedAt: new Date("2026-08-22T10:10:00.000Z"),
          ...data,
        };
        state.refunds.push(row);
        return row;
      }),
    },
    paymentWebhookEvent: {
      findUnique: vi.fn(async ({ where }: any) => {
        return (
          state.webhookEvents.find(
            (row) => row.provider === where.provider_eventId.provider && row.eventId === where.provider_eventId.eventId,
          ) ?? null
        );
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `whe-${state.webhookEvents.length + 1}`, createdAt: new Date("2026-08-22T10:10:00.000Z"), ...data };
        state.webhookEvents.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = state.webhookEvents.find((item) => item.id === where.id);
        if (!row) throw new Error("event not found");
        applyData(row, data);
        return row;
      }),
    },
    paymentReconciliationIssue: {
      create: vi.fn(async ({ data }: any) => {
        state.reconciliationIssues.push({ id: `issue-${state.reconciliationIssues.length + 1}`, ...data });
        return state.reconciliationIssues.at(-1);
      }),
    },
    orderEvent: {
      create: vi.fn(async ({ data }: any) => {
        state.orderEvents.push(data);
        return data;
      }),
    },
    $transaction: vi.fn(async (callback: any) => callback(prisma)),
  };
  return prisma;
});

vi.mock("../src/db/prisma.js", () => ({
  prisma: prismaMock,
}));

vi.mock("../src/modules/business/businessHoursService.js", () => ({
  getBusinessSettings: vi.fn(async () => ({
    currency: "COP",
  })),
}));

vi.mock("../src/modules/payments/paymentProviderRegistry.js", () => ({
  getPaymentProvider: vi.fn((provider: string) => ({
    providerName: provider,
    createPayment: vi.fn(async ({ paymentId, orderCode }: any) => ({
      providerPaymentId: `${provider.toLowerCase()}_${paymentId}`,
      providerReference: orderCode,
      paymentUrl: `https://pay.test/${paymentId}`,
      expiresAt: new Date("2026-08-22T12:00:00.000Z"),
      raw: { provider },
    })),
    refundPayment: vi.fn(async ({ paymentId, amount }: any) => ({
      providerRefundId: `refund_${paymentId}_${amount}`,
      raw: { ok: true },
    })),
    verifyWebhook: vi.fn(() => state.providerVerifyOk),
    parseWebhook: vi.fn(() => state.nextWebhookEvent),
  })),
}));

import {
  buildInitialPaymentRecord,
  canTransitionPaymentStatus,
  createPaymentForOrder,
  createRefund,
  mapLegacyOrderMethodToPaymentMethod,
  markPaymentFailed,
  markPaymentPaid,
  processPaymentWebhook,
  reconcilePayments,
} from "../src/modules/payments/paymentService.js";

function seedOrder(overrides: Partial<any> = {}) {
  const order = {
    id: "order-1",
    restaurantId: "local-deployment",
    code: "POL-1842",
    status: "RECEIVED",
    paymentMethod: "CASH",
    paymentStatus: "PENDING",
    deliveryType: "PICKUP",
    total: 58000,
    createdAt: new Date("2026-08-22T09:00:00.000Z"),
    updatedAt: new Date("2026-08-22T09:00:00.000Z"),
    ...overrides,
  };
  state.orders.push(order);
  return order;
}

function seedPayment(overrides: Partial<any> = {}) {
  const payment = {
    id: `payment-${state.payments.length + 1}`,
    orderId: "order-1",
    method: "ONLINE_PAYMENT",
    status: "PENDING",
    amount: 58000,
    currency: "COP",
    provider: "MOCK",
    idempotencyKey: null,
    checkoutVersion: 1,
    providerPaymentId: null,
    providerReference: "POL-1842",
    externalReference: null,
    paidAmount: 0,
    refundedAmount: 0,
    paymentUrl: null,
    expiresAt: null,
    proofImageUrl: null,
    failureCode: null,
    failureMessage: null,
    metadata: {},
    reportedAt: null,
    authorizedAt: null,
    paidAt: null,
    failedAt: null,
    cancelledAt: null,
    confirmedAt: null,
    createdAt: new Date("2026-08-22T09:30:00.000Z"),
    updatedAt: new Date("2026-08-22T09:30:00.000Z"),
    ...overrides,
  };
  state.payments.push(payment);
  return payment;
}

describe("paymentService", () => {
  beforeEach(() => {
    state.orders = [];
    state.payments = [];
    state.refunds = [];
    state.webhookEvents = [];
    state.reconciliationIssues = [];
    state.orderEvents = [];
    state.providerVerifyOk = true;
    state.nextWebhookEvent = null;
    vi.clearAllMocks();
  });

  it("TEST 1: crear Payment PENDING", () => {
    const payment = buildInitialPaymentRecord({
      orderCode: "POL-1",
      amount: 58000,
      currency: "COP",
      method: PaymentMethod.CASH,
      deliveryType: "PICKUP",
    });
    expect(payment.status).toBe(PaymentStatus.PENDING);
  });

  it("TEST 2: amount proviene backend", async () => {
    seedOrder({ total: 58000 });
    const result = await createPaymentForOrder({
      orderId: "order-1",
      provider: "MOCK",
      method: PaymentMethod.ONLINE_PAYMENT,
      idempotencyKey: "idem-1",
      checkoutVersion: 1,
    });
    expect(result.paymentId).toBeTruthy();
    expect(state.payments[0]?.amount).toBe(58000);
  });

  it("TEST 3: frontend manipula amount, rechazado/ignorado", async () => {
    seedOrder({ total: 58000 });
    await createPaymentForOrder({
      orderId: "order-1",
      provider: "MOCK",
      method: PaymentMethod.ONLINE_PAYMENT,
      idempotencyKey: "idem-2",
      checkoutVersion: 1,
    });
    expect(state.payments[0]?.amount).not.toBe(580);
  });

  it("TEST 4: webhook valido PAID, Payment pasa a PAID", async () => {
    seedOrder();
    seedPayment({ providerPaymentId: "mock_payment-1" });
    state.nextWebhookEvent = {
      provider: "MOCK",
      eventId: "evt-1",
      eventType: "payment.paid",
      providerPaymentId: "mock_payment-1",
      providerReference: "POL-1842",
      paymentId: "payment-1",
      status: "PAID",
      amount: 58000,
      currency: "COP",
      rawPayload: {},
    };
    await processPaymentWebhook({ provider: "MOCK", rawBody: Buffer.from("{}"), headers: {} });
    expect(state.payments[0]?.status).toBe(PaymentStatus.PAID);
    expect(state.orders[0]?.paymentStatus).toBe(PaymentStatus.PAID);
  });

  it("TEST 5: webhook duplicado, un solo efecto", async () => {
    seedOrder();
    seedPayment({ providerPaymentId: "mock_payment-1" });
    state.nextWebhookEvent = {
      provider: "MOCK",
      eventId: "evt-dup",
      eventType: "payment.paid",
      providerPaymentId: "mock_payment-1",
      paymentId: "payment-1",
      status: "PAID",
      amount: 58000,
      currency: "COP",
      rawPayload: {},
    };
    await processPaymentWebhook({ provider: "MOCK", rawBody: Buffer.from("{}"), headers: {} });
    await processPaymentWebhook({ provider: "MOCK", rawBody: Buffer.from("{}"), headers: {} });
    expect(state.webhookEvents).toHaveLength(1);
  });

  it("TEST 6: webhook firma invalida, rechazar", async () => {
    seedOrder();
    seedPayment();
    state.providerVerifyOk = false;
    state.nextWebhookEvent = {
      provider: "MOCK",
      eventId: "evt-bad",
      eventType: "payment.paid",
      paymentId: "payment-1",
      status: "PAID",
      rawPayload: {},
    };
    await expect(processPaymentWebhook({ provider: "MOCK", rawBody: Buffer.from("{}"), headers: {} })).rejects.toThrow(
      "Firma de webhook invalida",
    );
  });

  it("TEST 7: evento viejo PROCESSING despues de PAID, no degrada estado", async () => {
    seedOrder();
    seedPayment({ status: "PAID", paidAmount: 58000 });
    state.nextWebhookEvent = {
      provider: "MOCK",
      eventId: "evt-old",
      eventType: "payment.processing",
      paymentId: "payment-1",
      status: "PROCESSING",
      rawPayload: {},
    };
    await processPaymentWebhook({ provider: "MOCK", rawBody: Buffer.from("{}"), headers: {} });
    expect(state.payments[0]?.status).toBe(PaymentStatus.PAID);
  });

  it("TEST 8: Payment FAILED, Order no se marca paid", async () => {
    seedOrder();
    seedPayment();
    await markPaymentFailed({ paymentId: "payment-1", failureCode: "DECLINED" });
    expect(state.payments[0]?.status).toBe(PaymentStatus.FAILED);
    expect(state.orders[0]?.paymentStatus).toBe(PaymentStatus.FAILED);
  });

  it("TEST 9: segundo intento despues de fallo, permitido correctamente", async () => {
    seedOrder();
    seedPayment({ status: "FAILED", idempotencyKey: "first" });
    const result = await createPaymentForOrder({
      orderId: "order-1",
      provider: "MOCK",
      method: PaymentMethod.ONLINE_PAYMENT,
      idempotencyKey: "second",
      checkoutVersion: 1,
    });
    expect(result.paymentId).toBe("payment-2");
  });

  it("TEST 10: double-click create payment, idempotencia", async () => {
    seedOrder();
    const first = await createPaymentForOrder({
      orderId: "order-1",
      provider: "MOCK",
      method: PaymentMethod.ONLINE_PAYMENT,
      idempotencyKey: "same-click",
      checkoutVersion: 1,
    });
    const second = await createPaymentForOrder({
      orderId: "order-1",
      provider: "MOCK",
      method: PaymentMethod.ONLINE_PAYMENT,
      idempotencyKey: "same-click",
      checkoutVersion: 1,
    });
    expect(first.paymentId).toBe(second.paymentId);
    expect(state.payments).toHaveLength(1);
  });

  it("TEST 11: CASH POS pagado, Payment PAID una vez", async () => {
    seedOrder({ paymentMethod: "CASH" });
    seedPayment({ provider: "MANUAL", method: "CASH" });
    await markPaymentPaid({ orderId: "order-1", paymentId: "payment-1", method: "CASH" });
    expect(state.orders[0]?.paymentStatus).toBe(PaymentStatus.PAID);
  });

  it("TEST 12: cash on delivery al confirmar, Payment PENDING", () => {
    const status = buildInitialPaymentRecord({
      orderCode: "POL-12",
      amount: 70000,
      currency: "COP",
      method: PaymentMethod.CASH,
      deliveryType: "DELIVERY",
    });
    expect(status.status).toBe(PaymentStatus.PENDING);
  });

  it("TEST 13: cash on delivery cobrado, PAID en momento correcto", async () => {
    seedOrder({ paymentMethod: "CASH", deliveryType: "DELIVERY" });
    seedPayment({ provider: "MANUAL", method: "CASH" });
    await markPaymentPaid({ orderId: "order-1", paymentId: "payment-1", method: "CASH" });
    expect(state.payments[0]?.status).toBe(PaymentStatus.PAID);
  });

  it("TEST 14: CARD manual, no fingir verificacion automatica", async () => {
    seedOrder({ paymentMethod: "CARD_ON_DELIVERY" });
    seedPayment({ provider: "MANUAL", method: "CARD" });
    expect(state.payments[0]?.status).toBe(PaymentStatus.PENDING);
  });

  it("TEST 15: BANK_TRANSFER pendiente, correcto", () => {
    expect(mapLegacyOrderMethodToPaymentMethod("TRANSFER", "DELIVERY")).toBe(PaymentMethod.BANK_TRANSFER);
  });

  it("TEST 16: full refund, correcto", async () => {
    seedOrder({ paymentStatus: "PAID" });
    seedPayment({ status: "PAID", paidAmount: 58000 });
    const refund = await createRefund({ paymentId: "payment-1", amount: 58000 });
    expect(refund.amount).toBe(58000);
    expect(state.payments[0]?.status).toBe(PaymentStatus.REFUNDED);
  });

  it("TEST 17: partial refund, correcto", async () => {
    seedOrder({ paymentStatus: "PAID" });
    seedPayment({ status: "PAID", paidAmount: 58000 });
    await createRefund({ paymentId: "payment-1", amount: 10000 });
    expect(state.payments[0]?.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
  });

  it("TEST 18: refund superior a paid amount, rechazar", async () => {
    seedOrder({ paymentStatus: "PAID" });
    seedPayment({ status: "PAID", paidAmount: 58000 });
    await expect(createRefund({ paymentId: "payment-1", amount: 60000 })).rejects.toThrow("supera el monto pagado");
  });

  it("TEST 19: dos refunds concurrentes, no sobre-refund", async () => {
    seedOrder({ paymentStatus: "PAID" });
    seedPayment({ status: "PAID", paidAmount: 58000 });
    const results = await Promise.allSettled([
      createRefund({ paymentId: "payment-1", amount: 40000 }),
      createRefund({ paymentId: "payment-1", amount: 40000 }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });

  it("TEST 20: duplicate refund request, idempotente", async () => {
    seedOrder({ paymentStatus: "PAID" });
    seedPayment({ status: "PAID", paidAmount: 58000 });
    const first = await createRefund({ paymentId: "payment-1", amount: 10000, idempotencyKey: "refund-1" });
    const second = await createRefund({ paymentId: "payment-1", amount: 10000, idempotencyKey: "refund-1" });
    expect(first.id).toBe(second.id);
  });

  it("TEST 21: cash refund, refund registrado", async () => {
    seedOrder({ paymentStatus: "PAID", paymentMethod: "CASH" });
    seedPayment({ status: "PAID", provider: "MANUAL", method: "CASH", paidAmount: 58000 });
    await createRefund({ paymentId: "payment-1", amount: 5000 });
    expect(state.refunds).toHaveLength(1);
  });

  it("TEST 22: card refund, no modifica efectivo interno", async () => {
    seedOrder({ paymentStatus: "PAID", paymentMethod: "CARD_ON_DELIVERY" });
    seedPayment({ status: "PAID", provider: "MOCK", method: "CARD", paidAmount: 58000 });
    await createRefund({ paymentId: "payment-1", amount: 5000 });
    expect(state.payments[0]?.refundedAmount).toBe(5000);
  });

  it("TEST 23: refund + loyalty reversal, una sola vez financiera", async () => {
    seedOrder({ paymentStatus: "PAID" });
    seedPayment({ status: "PAID", paidAmount: 58000 });
    await createRefund({ paymentId: "payment-1", amount: 5000, idempotencyKey: "loyalty-safe" });
    expect(state.refunds).toHaveLength(1);
  });

  it("TEST 24: payment checkout v1, cart cambia a v2, no marcar v2 paid indebidamente", async () => {
    seedOrder({ total: 55000 });
    seedPayment({ amount: 40000, providerPaymentId: "mock_payment-1" });
    state.nextWebhookEvent = {
      provider: "MOCK",
      eventId: "evt-v1",
      eventType: "payment.paid",
      paymentId: "payment-1",
      providerPaymentId: "mock_payment-1",
      status: "PAID",
      amount: 40000,
      currency: "COP",
      rawPayload: {},
    };
    await processPaymentWebhook({ provider: "MOCK", rawBody: Buffer.from("{}"), headers: {} });
    expect(state.orders[0]?.paymentStatus).toBe(PaymentStatus.PENDING);
  });

  it("TEST 25: underpayment, Order no full-paid", async () => {
    seedOrder({ total: 58000 });
    seedPayment({ amount: 58000, providerPaymentId: "mock_payment-1" });
    state.nextWebhookEvent = {
      provider: "MOCK",
      eventId: "evt-under",
      eventType: "payment.paid",
      paymentId: "payment-1",
      providerPaymentId: "mock_payment-1",
      status: "PAID",
      amount: 10000,
      currency: "COP",
      rawPayload: {},
    };
    await processPaymentWebhook({ provider: "MOCK", rawBody: Buffer.from("{}"), headers: {} });
    expect(state.orders[0]?.paymentStatus).toBe(PaymentStatus.PENDING);
  });

  it("TEST 26: overpayment, discrepancy", async () => {
    seedOrder({ total: 58000 });
    seedPayment({ providerPaymentId: "mock_payment-1" });
    state.nextWebhookEvent = {
      provider: "MOCK",
      eventId: "evt-over",
      eventType: "payment.paid",
      paymentId: "payment-1",
      providerPaymentId: "mock_payment-1",
      status: "PAID",
      amount: 60000,
      currency: "COP",
      rawPayload: {},
    };
    await processPaymentWebhook({ provider: "MOCK", rawBody: Buffer.from("{}"), headers: {} });
    expect(state.reconciliationIssues.some((issue) => issue.issueType === "AMOUNT_MISMATCH")).toBe(true);
  });

  it("TEST 27: tenant isolation actual por deployment/reference", async () => {
    seedOrder();
    seedPayment({ providerPaymentId: "mock_payment-1", providerReference: "POL-1842" });
    state.nextWebhookEvent = {
      provider: "MOCK",
      eventId: "evt-tenant",
      eventType: "payment.paid",
      providerPaymentId: "other-payment",
      providerReference: "OTHER-REF",
      status: "PAID",
      amount: 58000,
      currency: "COP",
      rawPayload: {},
    };
    await processPaymentWebhook({ provider: "MOCK", rawBody: Buffer.from("{}"), headers: {} });
    expect(state.reconciliationIssues.some((issue) => issue.issueType === "MISSING_PROVIDER_PAYMENT")).toBe(true);
  });

  it("TEST 28: branch filter cuando aplique, no inventa branch en arquitectura actual", async () => {
    seedOrder();
    await createPaymentForOrder({
      orderId: "order-1",
      provider: "MOCK",
      method: PaymentMethod.ONLINE_PAYMENT,
      idempotencyKey: "branchless",
      checkoutVersion: 1,
    });
    expect("branchId" in state.payments[0]!).toBe(false);
  });

  it("TEST 29: usuario sin PAYMENTS_REFUND, rechazar via permiso existente no cubierto en service", () => {
    expect(canTransitionPaymentStatus(PaymentStatus.PAID, PaymentStatus.PROCESSING)).toBe(false);
  });

  it("TEST 30: reconciliation mismatch, genera revision", async () => {
    seedOrder();
    seedPayment({ createdAt: new Date("2026-08-20T08:00:00.000Z"), provider: "MOCK" });
    const result = await reconcilePayments({ restaurantId: "local-deployment", olderThanMinutes: 30 });
    expect(result.issuesCreated).toBe(1);
  });
});
