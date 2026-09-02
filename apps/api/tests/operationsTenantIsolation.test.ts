import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Aislamiento de la OPERACION entre restaurantes (multi-tenant, fase 2).
//
// Hermano de catalogTenantIsolation.test.ts, que cubre el catalogo. Aca se ejercitan las
// queries reales de pedidos, conversaciones, promociones y FAQs contra un prisma en memoria:
// lo que se prueba es que un negocio no vea ni pueda tocar la operacion de otro, aunque el
// request traiga el id exacto de un pedido o un chat ajeno.
//
// Tambien cubre el corte que NO depende del header: un usuario atado a un restaurante queda
// encerrado ahi aunque mande a mano el header de otro.

interface Row {
  id: string;
  restaurantId: string;
  [key: string]: unknown;
}

const state: {
  restaurants: Array<{ id: string }>;
  contacts: Row[];
  conversations: Row[];
  orders: Row[];
  promotions: Row[];
  faqs: Row[];
  nextId: number;
} = { restaurants: [], contacts: [], conversations: [], orders: [], promotions: [], faqs: [], nextId: 1 };

/** Aplica un `where` plano de Prisma (igualdad simple, que es lo que usan estas rutas). */
function matches(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object") {
      const clause = value as Record<string, unknown>;
      if ("in" in clause) return (clause.in as unknown[]).includes(row[key]);
      if ("not" in clause) return row[key] !== clause.not;
    }
    return row[key] === value;
  });
}

function collectionApi(bucket: () => Row[], setBucket: (rows: Row[]) => void, prefix: string) {
  return {
    findMany: vi.fn(async ({ where }: any) => bucket().filter((row) => matches(row, where))),
    findFirst: vi.fn(async ({ where }: any) => bucket().find((row) => matches(row, where)) ?? null),
    // Presente a proposito aunque las rutas ya no deban usarlo: si alguna vuelve a findUnique
    // (sin restaurantId), el mock devuelve la fila ajena y el test falla por la fuga real.
    findUnique: vi.fn(async ({ where }: any) => bucket().find((row) => row.id === where.id) ?? null),
    count: vi.fn(async ({ where }: any) => bucket().filter((row) => matches(row, where)).length),
    create: vi.fn(async ({ data }: any) => {
      const row = { id: `${prefix}-${state.nextId++}`, ...data } as Row;
      setBucket([...bucket(), row]);
      return row;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = bucket().find((item) => item.id === where.id)!;
      Object.assign(row, data);
      return row;
    }),
    delete: vi.fn(async ({ where }: any) => {
      setBucket(bucket().filter((row) => row.id !== where.id));
      return { ok: true };
    }),
  };
}

vi.mock("../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ({ info: vi.fn(), error: vi.fn() }) },
}));

vi.mock("../src/db/prisma.js", () => ({
  prisma: {
    platformRestaurant: {
      findUnique: vi.fn(async ({ where }: any) => state.restaurants.find((r) => r.id === where.id) ?? null),
    },
    order: {
      ...collectionApi(() => state.orders, (rows) => (state.orders = rows), "order"),
      findMany: vi.fn(async ({ where }: any) =>
        state.orders
          .filter((row) => matches(row, where))
          .map((row) => ({
            ...row,
            items: [],
            events: [],
            payments: [],
            contact: state.contacts.find((c) => c.id === row.contactId) ?? { name: null, phone: "" },
          })),
      ),
      findFirst: vi.fn(async ({ where }: any) => {
        const row = state.orders.find((item) => matches(item, where));
        if (!row) return null;
        return {
          ...row,
          items: [],
          events: [],
          payments: [],
          contact: state.contacts.find((c) => c.id === row.contactId) ?? { name: null, phone: "" },
        };
      }),
    },
    conversation: {
      ...collectionApi(() => state.conversations, (rows) => (state.conversations = rows), "conv"),
      findMany: vi.fn(async ({ where }: any) =>
        state.conversations
          .filter((row) => matches(row, where))
          .map((row) => ({
            ...row,
            messages: [],
            assignedAdminUser: null,
            contact: state.contacts.find((c) => c.id === row.contactId) ?? { name: null, phone: "" },
          })),
      ),
      findFirst: vi.fn(async ({ where }: any) => {
        const row = state.conversations.find((item) => matches(item, { id: where.id, restaurantId: where.restaurantId }));
        if (!row) return null;
        return {
          ...row,
          assignedAdminUser: null,
          contact: state.contacts.find((c) => c.id === row.contactId) ?? { name: null, phone: "" },
        };
      }),
    },
    promotion: collectionApi(() => state.promotions, (rows) => (state.promotions = rows), "promo"),
    faq: collectionApi(() => state.faqs, (rows) => (state.faqs = rows), "faq"),
    contact: collectionApi(() => state.contacts, (rows) => (state.contacts = rows), "contact"),
    product: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    category: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
  },
}));

vi.mock("../src/modules/business/businessHoursService.js", () => ({
  getBusinessSettings: vi.fn(async (restaurantId = "local-deployment") => ({
    restaurantId,
    currency: "COP",
    estimatedPrepMinutes: 30,
    deliveryFee: 0,
  })),
}));

vi.mock("../src/modules/conversation/conversationService.js", () => ({
  notifyOrderStatusChange: vi.fn(async () => {}),
  notifyManualOrderConfirmation: vi.fn(async () => {}),
  notifyOrderCorrection: vi.fn(async () => {}),
  notifyPaymentConfirmed: vi.fn(async () => {}),
}));

const { orderRoutes } = await import("../src/routes/orders.js");
const { conversationRoutes } = await import("../src/routes/conversations.js");
const { faqRoutes } = await import("../src/routes/faqs.js");

function buildTestApp() {
  const app = Fastify();
  app.register(orderRoutes);
  app.register(conversationRoutes);
  app.register(faqRoutes);
  return app;
}

/**
 * Request del panel. `restaurantId` es el header que manda el navegador (el panel abierto);
 * `actorRestaurantId` es el restaurante al que pertenece el usuario segun su sesion firmada.
 */
function adminHeaders(restaurantId?: string, actorRestaurantId?: string): Record<string, string> {
  return {
    "x-admin-user-id": "u1",
    "x-admin-username": "admin",
    "x-admin-role": "ADMIN",
    "x-admin-permissions": "",
    ...(restaurantId ? { "x-restaurant-id": restaurantId } : {}),
    ...(actorRestaurantId ? { "x-admin-restaurant-id": actorRestaurantId } : {}),
  };
}

beforeEach(() => {
  state.restaurants = [{ id: "local-deployment" }, { id: "rest-b" }];
  state.contacts = [
    { id: "contact-local", restaurantId: "local-deployment", phone: "573001112233", name: "Cliente local" },
    { id: "contact-b", restaurantId: "rest-b", phone: "573001112233", name: "Cliente de B" },
  ];
  const conversationDefaults = {
    status: "ACTIVE",
    isHandoff: false,
    handoffReason: null,
    assignedAdminUserId: null,
    takenAt: null,
    context: {},
    lastMessageAt: new Date("2026-09-01T10:00:00.000Z"),
    createdAt: new Date("2026-09-01T09:00:00.000Z"),
  };
  state.conversations = [
    { id: "conv-local", restaurantId: "local-deployment", contactId: "contact-local", ...conversationDefaults },
    { id: "conv-b", restaurantId: "rest-b", contactId: "contact-b", ...conversationDefaults },
  ];
  state.orders = [
    { id: "order-local", restaurantId: "local-deployment", contactId: "contact-local", code: "POL-LOCAL", status: "RECEIVED", deliveryType: "PICKUP", total: 10000, deliveryFee: 0, paymentMethod: "CASH", paymentStatus: "PENDING", flaggedForReview: false, createdAt: new Date(), updatedAt: new Date() },
    { id: "order-b", restaurantId: "rest-b", contactId: "contact-b", code: "POL-B", status: "RECEIVED", deliveryType: "PICKUP", total: 20000, deliveryFee: 0, paymentMethod: "CASH", paymentStatus: "PENDING", flaggedForReview: false, createdAt: new Date(), updatedAt: new Date() },
  ];
  state.promotions = [
    { id: "promo-local", restaurantId: "local-deployment", title: "2x1 local", description: "", isActive: true, daysOfWeek: [] },
    { id: "promo-b", restaurantId: "rest-b", title: "2x1 de B", description: "", isActive: true, daysOfWeek: [] },
  ];
  state.faqs = [
    { id: "faq-local", restaurantId: "local-deployment", question: "¿Hacen domicilios?", answer: "Si", isActive: true },
    { id: "faq-b", restaurantId: "rest-b", question: "¿Hacen domicilios?", answer: "No", isActive: true },
  ];
  state.nextId = 1;
});

describe("aislamiento de la operacion entre restaurantes", () => {
  it("cada restaurante ve solo sus pedidos, y sin header se asume el local", async () => {
    const app = buildTestApp();

    const local = await app.inject({ method: "GET", url: "/api/orders", headers: adminHeaders("local-deployment") });
    const b = await app.inject({ method: "GET", url: "/api/orders", headers: adminHeaders("rest-b") });
    const noHeader = await app.inject({ method: "GET", url: "/api/orders", headers: adminHeaders() });

    const codes = (raw: string) => JSON.parse(raw).map((o: any) => o.code);
    expect(codes(local.body)).toEqual(["POL-LOCAL"]);
    expect(codes(b.body)).toEqual(["POL-B"]);
    // El panel de siempre no manda header: tiene que seguir viendo el local.
    expect(codes(noHeader.body)).toEqual(["POL-LOCAL"]);
  });

  it("no deja abrir ni mover un pedido de otro restaurante aunque se sepa su id", async () => {
    const app = buildTestApp();

    const read = await app.inject({ method: "GET", url: "/api/orders/order-local", headers: adminHeaders("rest-b") });
    const move = await app.inject({
      method: "PATCH",
      url: "/api/orders/order-local/status",
      headers: adminHeaders("rest-b"),
      payload: { status: "READY" },
    });

    expect(read.statusCode).toBe(404);
    expect(move.statusCode).toBe(404);
    expect(state.orders.find((o) => o.id === "order-local")).toMatchObject({ status: "RECEIVED" });
  });

  it("cada restaurante ve solo sus conversaciones y no puede abrir el chat de otro", async () => {
    const app = buildTestApp();

    const list = await app.inject({ method: "GET", url: "/api/conversations", headers: adminHeaders("rest-b") });
    const foreign = await app.inject({ method: "GET", url: "/api/conversations/conv-local", headers: adminHeaders("rest-b") });

    expect(list.statusCode, list.body).toBe(200);
    expect(JSON.parse(list.body).map((c: any) => c.id)).toEqual(["conv-b"]);
    expect(foreign.statusCode).toBe(404);
  });

  it("las FAQ se crean en el restaurante del request y no se pueden editar cruzadas", async () => {
    const app = buildTestApp();

    const created = await app.inject({
      method: "POST",
      url: "/api/faqs",
      headers: adminHeaders("rest-b"),
      payload: { question: "¿Aceptan tarjeta?", answer: "Si" },
    });
    const foreignEdit = await app.inject({
      method: "PATCH",
      url: "/api/faqs/faq-local",
      headers: adminHeaders("rest-b"),
      payload: { answer: "Editado por otro negocio" },
    });

    expect(JSON.parse(created.body)).toMatchObject({ restaurantId: "rest-b" });
    expect(foreignEdit.statusCode).toBe(404);
    expect(state.faqs.find((f) => f.id === "faq-local")).toMatchObject({ answer: "Si" });
  });

  it("un usuario atado a un restaurante no puede pedir los datos de otro cambiando el header", async () => {
    const app = buildTestApp();

    // El usuario es de rest-b y pide explicitamente el restaurante local.
    const spoofed = await app.inject({
      method: "GET",
      url: "/api/orders",
      headers: adminHeaders("local-deployment", "rest-b"),
    });

    expect(spoofed.statusCode).toBe(403);
  });

  it("un usuario atado a un restaurante ve el suyo aunque no mande header", async () => {
    const app = buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/orders",
      headers: adminHeaders(undefined, "rest-b"),
    });

    // Sin header, un usuario de plataforma caeria al local; este cae al suyo.
    expect(JSON.parse(response.body).map((o: any) => o.code)).toEqual(["POL-B"]);
  });

  it("rechaza un header que no corresponde a ningun restaurante", async () => {
    const app = buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/orders",
      headers: adminHeaders("restaurante-que-no-existe"),
    });

    expect(response.statusCode).toBe(404);
  });
});
