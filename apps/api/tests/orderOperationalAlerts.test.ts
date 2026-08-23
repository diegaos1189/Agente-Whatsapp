import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrderStatus } from "@pollos/shared";

const prismaMock = vi.hoisted(() => ({
  order: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  orderEvent: {
    create: vi.fn(),
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

import { auditOrdersForOperationalRisk, evaluateOrderOperationalAlert } from "../src/modules/orders/orderService.js";

function buildOrder(overrides: Partial<any> = {}) {
  return {
    id: overrides.id ?? "order-1",
    code: overrides.code ?? "POL-001",
    confirmationId: null,
    contactId: overrides.contactId ?? "contact-1",
    status: overrides.status ?? OrderStatus.RECEIVED,
    deliveryType: overrides.deliveryType ?? "DELIVERY",
    paymentMethod: overrides.paymentMethod ?? "CASH",
    paymentStatus: overrides.paymentStatus ?? "PENDING",
    total: overrides.total ?? 45000,
    deliveryFee: overrides.deliveryFee ?? 5000,
    address: overrides.address ?? "Cra 50 #20-30",
    neighborhood: overrides.neighborhood ?? "Laureles",
    reference: overrides.reference ?? "Casa azul",
    contactPhone: overrides.contactPhone ?? "3000000000",
    flaggedForReview: overrides.flaggedForReview ?? false,
    flagNote: overrides.flagNote ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-08-23T18:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-08-23T18:00:00.000Z"),
    items: overrides.items ?? [],
    payments: overrides.payments ?? [],
    events: overrides.events ?? [],
  };
}

describe("order operational alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.order.findMany.mockResolvedValue([]);
    prismaMock.order.update.mockResolvedValue(null);
    prismaMock.orderEvent.create.mockResolvedValue(null);
  });

  it("detecta pedido esperando pago demasiado tiempo", () => {
    const order = buildOrder({
      status: OrderStatus.AWAITING_PAYMENT,
      createdAt: new Date("2026-08-23T17:30:00.000Z"),
    });

    const alert = evaluateOrderOperationalAlert({
      order,
      estimatedPrepMinutes: 30,
      now: new Date("2026-08-23T18:00:00.000Z"),
    });

    expect(alert?.reason).toBe("AWAITING_PAYMENT_STALE");
  });

  it("detecta pedido en preparacion retrasado", () => {
    const order = buildOrder({
      status: OrderStatus.RECEIVED,
      createdAt: new Date("2026-08-23T17:00:00.000Z"),
    });

    const alert = evaluateOrderOperationalAlert({
      order,
      estimatedPrepMinutes: 30,
      now: new Date("2026-08-23T18:00:00.000Z"),
    });

    expect(alert?.reason).toBe("RECEIVED_STALE");
    expect(alert?.delayMinutes).toBeGreaterThan(0);
  });

  it("detecta pedido listo para recoger estancado", () => {
    const order = buildOrder({
      status: OrderStatus.READY,
      deliveryType: "PICKUP",
      createdAt: new Date("2026-08-23T17:00:00.000Z"),
      updatedAt: new Date("2026-08-23T17:10:00.000Z"),
      events: [{ status: OrderStatus.READY, createdAt: new Date("2026-08-23T17:20:00.000Z") }],
    });

    const alert = evaluateOrderOperationalAlert({
      order,
      estimatedPrepMinutes: 30,
      now: new Date("2026-08-23T18:00:00.000Z"),
    });

    expect(alert?.reason).toBe("READY_FOR_PICKUP_STALE");
  });

  it("audita y marca pedidos en riesgo en base de datos", async () => {
    prismaMock.order.findMany.mockResolvedValue([
      buildOrder({
        id: "risk-1",
        status: OrderStatus.RECEIVED,
        createdAt: new Date("2026-08-23T17:00:00.000Z"),
      }),
    ]);

    const result = await auditOrdersForOperationalRisk({
      estimatedPrepMinutes: 30,
      now: new Date("2026-08-23T18:00:00.000Z"),
    });

    expect(result.flagged).toBe(1);
    expect(prismaMock.order.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.orderEvent.create).toHaveBeenCalledTimes(1);
  });
});
