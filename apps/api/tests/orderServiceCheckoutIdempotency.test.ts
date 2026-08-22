import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { OrderStatus } from "@pollos/shared";

const prismaMock = vi.hoisted(() => ({
  order: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const n8nMock = vi.hoisted(() => ({
  notifyOrderCreated: vi.fn(),
  notifyOperator: vi.fn(),
}));

vi.mock("../src/db/prisma.js", () => ({
  prisma: prismaMock,
}));

vi.mock("../src/modules/n8n/n8nClient.js", () => ({
  n8nClient: n8nMock,
}));

import { createOrder } from "../src/modules/orders/orderService.js";

function buildOrderPayload() {
  return {
    id: "order-1",
    code: "POL-TEST-001",
    confirmationId: "checkout-1",
    contactId: "contact-1",
    status: OrderStatus.RECEIVED,
    deliveryType: "PICKUP",
    paymentMethod: "CASH",
    paymentStatus: "PENDING",
    total: 52000,
    deliveryFee: 0,
    address: null,
    neighborhood: null,
    reference: null,
    contactPhone: "3000000000",
    scheduledFor: null,
    flaggedForReview: false,
    flagNote: null,
    createdAt: new Date("2026-08-21T15:00:00-05:00"),
    updatedAt: new Date("2026-08-21T15:00:00-05:00"),
    payments: [
      {
        id: "payment-1",
        orderId: "order-1",
        method: "CASH",
        status: "PENDING",
        amount: 52000,
        currency: "COP",
        provider: "MANUAL",
        idempotencyKey: null,
        checkoutVersion: null,
        providerPaymentId: null,
        providerReference: "POL-TEST-001",
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
        createdAt: new Date("2026-08-21T15:00:00-05:00"),
        updatedAt: new Date("2026-08-21T15:00:00-05:00"),
      },
    ],
    items: [
      {
        id: "item-1",
        orderId: "order-1",
        productId: "pollo",
        productName: "Pollo Frito 8 piezas",
        quantity: 1,
        unitPrice: 52000,
        notes: "sin ensalada",
        product: null,
      },
    ],
    events: [],
  };
}

describe("createOrder confirmation idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.order.findUnique.mockResolvedValue(null);
    prismaMock.order.findMany.mockResolvedValue([]);
  });

  it("crea un pedido una sola vez para una confirmacion valida", async () => {
    const orderRecord = buildOrderPayload();
    prismaMock.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) =>
      cb({
        order: {
          updateMany: vi.fn(),
          create: vi.fn().mockResolvedValue(orderRecord),
        },
      }),
    );

    const result = await createOrder({
      confirmationId: "checkout-1",
      contactId: "contact-1",
      phone: "3000000000",
      customerName: "Diego",
      items: [{ productId: "pollo", productName: "Pollo Frito 8 piezas", quantity: 1, unitPrice: 52000, notes: "sin ensalada" }],
      deliveryType: "PICKUP",
      paymentMethod: "CASH",
      deliveryFee: 0,
      total: 52000,
    });

    expect(result.createdNow).toBe(true);
    expect(result.order.code).toBe(orderRecord.code);
    expect(result.order.items[0]?.notes).toBe("sin ensalada");
    expect(n8nMock.notifyOrderCreated).toHaveBeenCalledTimes(1);
    expect(n8nMock.notifyOperator).toHaveBeenCalledTimes(1);
  });

  it("reutiliza la orden existente si llega la misma confirmacion dos veces", async () => {
    const existing = buildOrderPayload();
    prismaMock.order.findUnique.mockResolvedValue(existing);

    const result = await createOrder({
      confirmationId: "checkout-1",
      contactId: "contact-1",
      phone: "3000000000",
      customerName: "Diego",
      items: [{ productId: "pollo", productName: "Pollo Frito 8 piezas", quantity: 1, unitPrice: 52000 }],
      deliveryType: "PICKUP",
      paymentMethod: "CASH",
      deliveryFee: 0,
      total: 52000,
    });

    expect(result.createdNow).toBe(false);
    expect(result.order.id).toBe(existing.id);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(n8nMock.notifyOrderCreated).not.toHaveBeenCalled();
  });

  it("tolera carrera entre dos intentos simultaneos via unique constraint", async () => {
    const existing = buildOrderPayload();
    prismaMock.order.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    prismaMock.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "5.22.0",
      }),
    );

    const result = await createOrder({
      confirmationId: "checkout-1",
      contactId: "contact-1",
      phone: "3000000000",
      customerName: "Diego",
      items: [{ productId: "pollo", productName: "Pollo Frito 8 piezas", quantity: 1, unitPrice: 52000 }],
      deliveryType: "PICKUP",
      paymentMethod: "CASH",
      deliveryFee: 0,
      total: 52000,
    });

    expect(result.createdNow).toBe(false);
    expect(result.order.id).toBe(existing.id);
    expect(n8nMock.notifyOrderCreated).not.toHaveBeenCalled();
  });

  it("no notifica confirmacion falsa si la transaccion falla", async () => {
    prismaMock.$transaction.mockRejectedValueOnce(new Error("db down"));

    await expect(
      createOrder({
        confirmationId: "checkout-1",
        contactId: "contact-1",
        phone: "3000000000",
        customerName: "Diego",
        items: [{ productId: "pollo", productName: "Pollo Frito 8 piezas", quantity: 1, unitPrice: 52000 }],
        deliveryType: "PICKUP",
        paymentMethod: "CASH",
        deliveryFee: 0,
        total: 52000,
      }),
    ).rejects.toThrow("db down");

    expect(n8nMock.notifyOrderCreated).not.toHaveBeenCalled();
    expect(n8nMock.notifyOperator).not.toHaveBeenCalled();
  });
});
