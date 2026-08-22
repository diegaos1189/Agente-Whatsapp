import { beforeEach, describe, expect, it, vi } from "vitest";

const orderServiceMocks = vi.hoisted(() => ({
  estimateDeliveryMinutes: vi.fn(),
  getActiveOrdersForContact: vi.fn(),
  getOrderByCodeForContact: vi.fn(),
  getOrderByIdForContact: vi.fn(),
  getRecentOrdersForContact: vi.fn(),
}));

vi.mock("../src/modules/orders/orderService.js", () => ({
  estimateDeliveryMinutes: orderServiceMocks.estimateDeliveryMinutes,
  getActiveOrdersForContact: orderServiceMocks.getActiveOrdersForContact,
  getOrderByCodeForContact: orderServiceMocks.getOrderByCodeForContact,
  getOrderByIdForContact: orderServiceMocks.getOrderByIdForContact,
  getRecentOrdersForContact: orderServiceMocks.getRecentOrdersForContact,
}));

import {
  looksLikeOrderStatusFollowUp,
  resolveDeliveredConflict,
  resolveOrderStatusQuery,
} from "../src/modules/conversation/orderStatusService.js";

function buildOrder(overrides: Partial<any> = {}) {
  return {
    id: overrides.id ?? "order-1",
    code: overrides.code ?? "POL-001",
    contactId: overrides.contactId ?? "contact-1",
    status: overrides.status ?? "RECEIVED",
    deliveryType: overrides.deliveryType ?? "DELIVERY",
    paymentMethod: overrides.paymentMethod ?? "CASH",
    paymentStatus: overrides.paymentStatus ?? "PENDING",
    total: overrides.total ?? 45000,
    deliveryFee: overrides.deliveryFee ?? 5000,
    address: overrides.address ?? "Cra 50 #20-30",
    neighborhood: overrides.neighborhood ?? "Laureles",
    reference: overrides.reference ?? "Apto 2",
    contactPhone: overrides.contactPhone ?? "3000000000",
    flaggedForReview: false,
    flagNote: null,
    createdAt: overrides.createdAt ?? new Date("2026-08-21T19:40:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-08-21T19:40:00.000Z"),
    items: overrides.items ?? [],
    events: overrides.events ?? [],
  };
}

const settings = {
  estimatedPrepMinutes: 30,
};

describe("orderStatusService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orderServiceMocks.estimateDeliveryMinutes.mockResolvedValue(30);
    orderServiceMocks.getActiveOrdersForContact.mockResolvedValue([]);
    orderServiceMocks.getOrderByCodeForContact.mockResolvedValue(null);
    orderServiceMocks.getOrderByIdForContact.mockResolvedValue(null);
    orderServiceMocks.getRecentOrdersForContact.mockResolvedValue([]);
  });

  it("TEST 1: resuelve automaticamente un pedido activo unico", async () => {
    orderServiceMocks.getActiveOrdersForContact.mockResolvedValue([buildOrder()]);

    const result = await resolveOrderStatusQuery({
      contactId: "contact-1",
      text: "donde esta mi pedido",
      settings,
    });

    expect(result.kind).toBe("FOUND");
    if (result.kind === "FOUND") {
      expect(result.order.code).toBe("POL-001");
      expect(result.orderTracking.lastReferencedOrderId).toBe("order-1");
    }
  });

  it("TEST 2: si hay dos pedidos activos pide aclaracion", async () => {
    orderServiceMocks.getActiveOrdersForContact.mockResolvedValue([
      buildOrder({ id: "a", code: "POL-A" }),
      buildOrder({ id: "b", code: "POL-B", status: "READY" }),
    ]);

    const result = await resolveOrderStatusQuery({
      contactId: "contact-1",
      text: "como va mi pedido",
      settings,
    });

    expect(result.kind).toBe("MULTIPLE_ACTIVE");
    expect(result.facts.join(" ")).toContain("POL-A");
    expect(result.facts.join(" ")).toContain("POL-B");
  });

  it("TEST 3: RECEIVED responde preparacion real", async () => {
    orderServiceMocks.getActiveOrdersForContact.mockResolvedValue([buildOrder({ status: "RECEIVED" })]);

    const result = await resolveOrderStatusQuery({
      contactId: "contact-1",
      text: "donde va",
      settings,
    });

    expect(result.kind).toBe("FOUND");
    if (result.kind === "FOUND") {
      expect(result.facts[0]).toContain("esta en preparacion");
    }
  });

  it("TEST 4: READY + PICKUP indica listo para recoger", async () => {
    orderServiceMocks.getActiveOrdersForContact.mockResolvedValue([
      buildOrder({ status: "READY", deliveryType: "PICKUP" }),
    ]);

    const result = await resolveOrderStatusQuery({
      contactId: "contact-1",
      text: "ya puedo pasar",
      settings,
    });

    expect(result.kind).toBe("FOUND");
    if (result.kind === "FOUND") {
      expect(result.facts[0]).toContain("listo para recoger");
    }
  });

  it("TEST 5: READY + DELIVERY no dice que ya salio", async () => {
    orderServiceMocks.getActiveOrdersForContact.mockResolvedValue([
      buildOrder({ status: "READY", deliveryType: "DELIVERY" }),
    ]);

    const result = await resolveOrderStatusQuery({
      contactId: "contact-1",
      text: "ya salio",
      settings,
    });

    expect(result.kind).toBe("FOUND");
    if (result.kind === "FOUND") {
      expect(result.facts[0]).toContain("esperando despacho");
      expect(result.facts[0]).not.toContain("ya salio");
    }
  });

  it("TEST 6: ON_THE_WAY indica despacho real", async () => {
    orderServiceMocks.getActiveOrdersForContact.mockResolvedValue([
      buildOrder({ status: "ON_THE_WAY", deliveryType: "DELIVERY" }),
    ]);

    const result = await resolveOrderStatusQuery({
      contactId: "contact-1",
      text: "ya viene",
      settings,
    });

    expect(result.kind).toBe("FOUND");
    if (result.kind === "FOUND") {
      expect(result.facts[0]).toContain("ya salio para entrega");
    }
  });

  it("TEST 7: DELIVERED indica entregado", async () => {
    orderServiceMocks.getRecentOrdersForContact.mockResolvedValue([buildOrder({ status: "DELIVERED" })]);

    const result = await resolveOrderStatusQuery({
      contactId: "contact-1",
      text: "que paso con mi pedido de ayer",
      settings,
    });

    expect(result.kind).toBe("FOUND");
    if (result.kind === "FOUND") {
      expect(result.facts[0]).toContain("aparece como entregado");
    }
  });

  it("TEST 8: CANCELLED indica cancelado", async () => {
    orderServiceMocks.getRecentOrdersForContact.mockResolvedValue([buildOrder({ status: "CANCELLED" })]);

    const result = await resolveOrderStatusQuery({
      contactId: "contact-1",
      text: "que paso con el pedido de ayer",
      settings,
    });

    expect(result.kind).toBe("FOUND");
    if (result.kind === "FOUND") {
      expect(result.facts[0]).toContain("fue cancelado");
    }
  });

  it("TEST 9: un codigo de otro cliente no se resuelve", async () => {
    orderServiceMocks.getOrderByCodeForContact.mockResolvedValue(null);

    const result = await resolveOrderStatusQuery({
      contactId: "contact-1",
      text: "mi pedido POL-OTRO",
      settings,
    });

    expect(result.kind).toBe("NOT_FOUND");
  });

  it("TEST 10: reutiliza lastReferencedOrderId para follow-up contextual", async () => {
    orderServiceMocks.getOrderByIdForContact.mockResolvedValue(buildOrder({ id: "tracked-1", code: "POL-TRACKED" }));

    const result = await resolveOrderStatusQuery({
      contactId: "contact-1",
      text: "y ahora",
      settings,
      reference: { lastReferencedOrderId: "tracked-1", lastReferencedOrderCode: "POL-TRACKED" },
    });

    expect(result.kind).toBe("FOUND");
    if (result.kind === "FOUND") {
      expect(result.order.code).toBe("POL-TRACKED");
    }
  });

  it("TEST 11: si no hay ETA real disponible no inventa tiempo", async () => {
    orderServiceMocks.getActiveOrdersForContact.mockResolvedValue([
      buildOrder({ status: "READY", deliveryType: "DELIVERY" }),
    ]);

    const result = await resolveOrderStatusQuery({
      contactId: "contact-1",
      text: "cuanto falta",
      settings,
      mode: "ETA",
    });

    expect(result.kind).toBe("FOUND");
    if (result.kind === "FOUND") {
      expect(result.facts.join(" ")).toContain("No tengo un tiempo exacto actualizado");
    }
  });

  it("TEST 12: con estimacion disponible usa el dato real del backend", async () => {
    orderServiceMocks.getActiveOrdersForContact.mockResolvedValue([
      buildOrder({ status: "RECEIVED", deliveryType: "DELIVERY", createdAt: new Date("2026-08-21T19:50:00.000Z") }),
    ]);
    orderServiceMocks.estimateDeliveryMinutes.mockResolvedValue(30);

    const result = await resolveOrderStatusQuery({
      contactId: "contact-1",
      text: "cuanto falta",
      settings,
      mode: "ETA",
      now: new Date("2026-08-21T20:10:00.000Z"),
    });

    expect(result.kind).toBe("FOUND");
    if (result.kind === "FOUND") {
      expect(result.estimatedRemainingMinutes).toBe(10);
      expect(result.facts.join(" ")).toContain("10 minutos");
    }
  });

  it("TEST 13: si el pedido esta retrasado activa handoff", async () => {
    orderServiceMocks.getActiveOrdersForContact.mockResolvedValue([
      buildOrder({ status: "RECEIVED", deliveryType: "PICKUP", createdAt: new Date("2026-08-21T19:20:00.000Z") }),
    ]);

    const result = await resolveOrderStatusQuery({
      contactId: "contact-1",
      text: "llevo mucho esperando",
      settings,
      now: new Date("2026-08-21T20:10:00.000Z"),
    });

    expect(result.kind).toBe("FOUND");
    if (result.kind === "FOUND") {
      expect(result.isDelayed).toBe(true);
      expect(result.shouldHandoff).toBe(true);
      expect(result.facts.join(" ")).toContain("paso el tiempo estimado");
    }
  });

  it("TEST 14: si aparece DELIVERED y el cliente dice que no llego, genera handoff", async () => {
    orderServiceMocks.getOrderByIdForContact.mockResolvedValue(
      buildOrder({ id: "order-delivered", code: "POL-DEL", status: "DELIVERED" }),
    );

    const result = await resolveDeliveredConflict({
      contactId: "contact-1",
      text: "no me llego",
      reference: { lastReferencedOrderId: "order-delivered", lastReferencedOrderCode: "POL-DEL" },
    });

    expect(result.shouldHandoff).toBe(true);
    expect(result.facts.join(" ")).toContain("aparece como entregado");
  });

  it("TEST 15: detecta follow-ups cortos de estado", () => {
    expect(looksLikeOrderStatusFollowUp("y ahora")).toBe(true);
    expect(looksLikeOrderStatusFollowUp("ya salio?")).toBe(true);
    expect(looksLikeOrderStatusFollowUp("quiero un combo")).toBe(false);
  });
});
