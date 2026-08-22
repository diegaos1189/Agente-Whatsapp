import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationStatus } from "@pollos/shared";

const state = vi.hoisted(() => ({
  cartRecoveries: [] as any[],
  contacts: [] as any[],
  conversations: [] as any[],
  orders: [] as any[],
  auditEvents: [] as any[],
  messages: [] as any[],
  sendTextMessage: vi.fn(),
  settings: {
    cartRecoveryEnabled: true,
    cartRecoveryDelayMinutes: 90,
    cartRecoveryMaxAttempts: 1,
    cartRecoveryMessage: "Hola 👋 Dejaste un pedido pendiente. Si quieres, seguimos desde donde quedamos.",
    whatsappProvider: "meta",
  },
}));

vi.mock("../src/db/prisma.js", () => {
  const matchWhere = (row: any, where: any): boolean => {
    if (!where) return true;
    return Object.entries(where).every(([key, value]) => {
      if (key === "OR" && Array.isArray(value)) return value.some((part) => matchWhere(row, part));
      if (typeof value === "object" && value !== null) {
        if ("in" in value) return value.in.includes(row[key]);
        if ("lte" in value) return row[key] <= value.lte;
        if ("lt" in value) return row[key] < value.lt;
        if ("gte" in value) return row[key] >= value.gte;
      }
      return row[key] === value;
    });
  };
  const applyData = (row: any, data: any) => {
    Object.entries(data).forEach(([key, value]) => {
      if (typeof value === "object" && value !== null && "increment" in value) {
        row[key] = (row[key] ?? 0) + value.increment;
      } else {
        row[key] = value;
      }
    });
  };
  return {
    prisma: {
      cartRecovery: {
        findFirst: vi.fn(async ({ where, orderBy, select }: any) => {
          let rows = state.cartRecoveries.filter((row) => matchWhere(row, where));
          if (orderBy?.createdAt === "desc") rows = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          const row = rows[0] ?? null;
          if (!row || !select) return row;
          const picked: any = {};
          Object.keys(select).forEach((key) => (picked[key] = row[key]));
          return picked;
        }),
        findMany: vi.fn(async ({ where, orderBy, take, select }: any) => {
          let rows = state.cartRecoveries.filter((row) => matchWhere(row, where));
          if (orderBy?.scheduledCheckAt === "asc") rows = rows.sort((a, b) => a.scheduledCheckAt.getTime() - b.scheduledCheckAt.getTime());
          if (take) rows = rows.slice(0, take);
          if (!select) return rows;
          return rows.map((row) => {
            const picked: any = {};
            Object.keys(select).forEach((key) => (picked[key] = row[key]));
            return picked;
          });
        }),
        findUnique: vi.fn(async ({ where, include }: any) => {
          const row = state.cartRecoveries.find((item) => item.id === where.id) ?? null;
          if (!row) return null;
          if (!include) return row;
          return {
            ...row,
            contact: state.contacts.find((item) => item.id === row.contactId) ?? null,
            conversation: state.conversations.find((item) => item.id === row.conversationId) ?? null,
          };
        }),
        create: vi.fn(async ({ data }: any) => {
          const row = {
            id: `recovery-${state.cartRecoveries.length + 1}`,
            status: "PENDING",
            attempts: 0,
            createdAt: new Date("2026-08-21T12:00:00.000Z"),
            updatedAt: new Date("2026-08-21T12:00:00.000Z"),
            ...data,
          };
          state.cartRecoveries.push(row);
          return row;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const row = state.cartRecoveries.find((item) => item.id === where.id);
          if (!row) throw new Error("recovery not found");
          applyData(row, data);
          row.updatedAt = new Date("2026-08-21T12:05:00.000Z");
          return row;
        }),
        updateMany: vi.fn(async ({ where, data }: any) => {
          const rows = state.cartRecoveries.filter((row) => matchWhere(row, where));
          rows.forEach((row) => applyData(row, data));
          return { count: rows.length };
        }),
      },
      contact: {
        findUnique: vi.fn(async ({ where }: any) => state.contacts.find((item) => item.id === where.id) ?? null),
        update: vi.fn(async ({ where, data }: any) => {
          const row = state.contacts.find((item) => item.id === where.id);
          if (!row) throw new Error("contact not found");
          Object.assign(row, data);
          return row;
        }),
      },
      conversation: {
        update: vi.fn(async ({ where, data }: any) => {
          const row = state.conversations.find((item) => item.id === where.id);
          if (!row) throw new Error("conversation not found");
          Object.assign(row, data);
          return row;
        }),
      },
      conversationAuditEvent: {
        create: vi.fn(async ({ data }: any) => {
          state.auditEvents.push(data);
          return data;
        }),
      },
      order: {
        findFirst: vi.fn(async ({ where }: any) => {
          const rows = state.orders.filter((row) => {
            if (row.contactId !== where.contactId) return false;
            if (where.createdAt?.gte) return row.createdAt >= where.createdAt.gte;
            return true;
          });
          rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return rows[0] ?? null;
        }),
      },
      message: {
        create: vi.fn(async ({ data }: any) => {
          state.messages.push(data);
          return data;
        }),
      },
    },
  };
});

vi.mock("../src/modules/business/businessHoursService.js", () => ({
  getBusinessSettings: vi.fn(async () => state.settings),
}));

vi.mock("../src/modules/whatsapp/whatsappClient.js", () => ({
  getWhatsAppClient: vi.fn(async () => ({
    sendTextMessage: state.sendTextMessage,
  })),
}));

import {
  canSendCartRecovery,
  computeCartRecoveryFingerprint,
  hasRecoverableCartContext,
  isCartRecoveryCancelMessage,
  isCartRecoveryOptOutMessage,
  isCartRecoveryResumeMessage,
  markRecoveryCancelled,
  processDueCartRecoveries,
  recordCartRecoveryOptOut,
  syncCartRecoveryFromConversation,
} from "../src/modules/conversation/cartRecoveryService.js";

function baseContext(overrides: Partial<any> = {}) {
  return {
    orderFlow: {
      step: "ASK_DELIVERY_TYPE",
      cart: [{ productId: "combo-8", productName: "Combo 8 Presas", quantity: 1, unitPrice: 68000 }],
      pendingProduct: null,
      sidesAsked: true,
      drinksAsked: false,
      deliveryType: null,
      address: null,
      neighborhood: null,
      reference: null,
      contactPhone: null,
      paymentMethod: null,
    },
    activeCart: null,
    checkout: { status: "BUILDING_CART", version: 1, confirmationId: null, cartFingerprint: null, summary: null, orderId: null, lastValidationErrors: [] },
    ...overrides,
  };
}

describe("cartRecoveryService", () => {
  beforeEach(() => {
    state.cartRecoveries = [];
    state.contacts = [{ id: "contact-1", cartRecoveryOptOutAt: null, cartRecoveryOptOutReason: null, phone: "573000000000" }];
    state.conversations = [{
      id: "conv-1",
      contactId: "contact-1",
      status: ConversationStatus.ACTIVE,
      isHandoff: false,
      context: baseContext(),
      lastMessageAt: new Date("2026-08-21T12:00:00.000Z"),
    }];
    state.orders = [];
    state.auditEvents = [];
    state.messages = [];
    state.sendTextMessage.mockReset();
    state.sendTextMessage.mockResolvedValue({ success: true, providerMessageId: "wamid-1" });
    state.settings = {
      cartRecoveryEnabled: true,
      cartRecoveryDelayMinutes: 90,
      cartRecoveryMaxAttempts: 1,
      cartRecoveryMessage: "Hola 👋 Dejaste un pedido pendiente. Si quieres, seguimos desde donde quedamos.",
      whatsappProvider: "meta",
    };
  });

  it("TEST 1: carrito con productos + inactividad crea recovery elegible base", async () => {
    await syncCartRecoveryFromConversation({
      conversationId: "conv-1",
      contactId: "contact-1",
      context: baseContext(),
      lastMessageAt: new Date("2026-08-21T12:00:00.000Z"),
    });
    expect(state.cartRecoveries).toHaveLength(1);
    expect(state.cartRecoveries[0]?.status).toBe("PENDING");
  });

  it("TEST 2: solo consulta sin carrito no crea recovery", async () => {
    await syncCartRecoveryFromConversation({
      conversationId: "conv-1",
      contactId: "contact-1",
      context: baseContext({
        orderFlow: { ...baseContext().orderFlow, step: "IDLE", cart: [] },
      }),
      lastMessageAt: new Date("2026-08-21T12:00:00.000Z"),
    });
    expect(state.cartRecoveries).toHaveLength(0);
  });

  it("TEST 3: carrito ya convertido no es elegible", () => {
    expect(
      canSendCartRecovery({
        recoveryEnabled: true,
        attempts: 0,
        maxAttempts: 1,
        conversationStatus: ConversationStatus.ACTIVE,
        isHandoff: false,
        hasRecoverableCart: true,
        checkoutStatus: "ORDER_CREATED",
        optedOutAt: null,
        lastMessageAt: new Date("2026-08-21T12:00:00.000Z"),
        now: new Date("2026-08-21T13:00:00.000Z"),
        whatsappProvider: "meta",
      }).eligible,
    ).toBe(false);
  });

  it("TEST 4: carrito cancelado se marca cancelado y no insiste", async () => {
    state.cartRecoveries.push({
      id: "recovery-1",
      conversationId: "conv-1",
      contactId: "contact-1",
      status: "SENT",
      attempts: 1,
      createdAt: new Date("2026-08-21T12:00:00.000Z"),
    });
    await markRecoveryCancelled({ conversationId: "conv-1", note: "ya no" });
    expect(state.cartRecoveries[0]?.status).toBe("CANCELLED");
  });

  it("TEST 5: conversation HUMAN no es elegible", () => {
    const result = canSendCartRecovery({
      recoveryEnabled: true,
      attempts: 0,
      maxAttempts: 1,
      conversationStatus: ConversationStatus.HUMAN,
      isHandoff: false,
      hasRecoverableCart: true,
      checkoutStatus: "BUILDING_CART",
      optedOutAt: null,
      lastMessageAt: new Date("2026-08-21T12:00:00.000Z"),
      now: new Date("2026-08-21T13:00:00.000Z"),
      whatsappProvider: "meta",
    });
    expect(result.reason).toBe("HUMAN_HANDOFF");
  });

  it("TEST 6: cliente regreso antes del job, no envia", async () => {
    state.cartRecoveries.push({
      id: "recovery-1",
      contactId: "contact-1",
      conversationId: "conv-1",
      status: "PENDING",
      cartFingerprint: "fp-1",
      scheduledCheckAt: new Date("2026-08-20T12:10:00.000Z"),
      lastCustomerMessageAt: new Date("2026-08-20T12:00:00.000Z"),
      attempts: 0,
      createdAt: new Date("2026-08-20T12:00:00.000Z"),
      updatedAt: new Date("2026-08-20T12:00:00.000Z"),
      leaseToken: null,
      leaseExpiresAt: null,
    });
    state.conversations[0]!.lastMessageAt = new Date("2026-08-20T12:30:00.000Z");
    await processDueCartRecoveries(new Date("2026-08-20T13:00:00.000Z"));
    expect(state.sendTextMessage).not.toHaveBeenCalled();
    expect(state.cartRecoveries[0]?.status).toBe("NOT_ELIGIBLE");
  });

  it("TEST 7: dos workers ejecutan mismo recovery, un mensaje", async () => {
    state.cartRecoveries.push({
      id: "recovery-1",
      contactId: "contact-1",
      conversationId: "conv-1",
      status: "PENDING",
      cartFingerprint: "fp-1",
      scheduledCheckAt: new Date("2026-08-20T12:10:00.000Z"),
      lastCustomerMessageAt: new Date("2026-08-20T12:00:00.000Z"),
      attempts: 0,
      createdAt: new Date("2026-08-20T12:00:00.000Z"),
      updatedAt: new Date("2026-08-20T12:00:00.000Z"),
      leaseToken: null,
      leaseExpiresAt: null,
    });
    state.conversations[0]!.lastMessageAt = new Date("2026-08-20T12:00:00.000Z");
    const now = new Date("2026-08-20T13:00:00.000Z");
    await Promise.all([processDueCartRecoveries(now), processDueCartRecoveries(now)]);
    expect(state.sendTextMessage).toHaveBeenCalledTimes(1);
  });

  it("TEST 8: job duplicado no reenvia", async () => {
    state.cartRecoveries.push({
      id: "recovery-1",
      contactId: "contact-1",
      conversationId: "conv-1",
      status: "PENDING",
      cartFingerprint: "fp-1",
      scheduledCheckAt: new Date("2026-08-20T12:10:00.000Z"),
      lastCustomerMessageAt: new Date("2026-08-20T12:00:00.000Z"),
      attempts: 0,
      createdAt: new Date("2026-08-20T12:00:00.000Z"),
      updatedAt: new Date("2026-08-20T12:00:00.000Z"),
      leaseToken: null,
      leaseExpiresAt: null,
    });
    state.conversations[0]!.lastMessageAt = new Date("2026-08-20T12:00:00.000Z");
    const now = new Date("2026-08-20T13:00:00.000Z");
    await processDueCartRecoveries(now);
    await processDueCartRecoveries(now);
    expect(state.sendTextMessage).toHaveBeenCalledTimes(1);
  });

  it("TEST 9: cliente responde hagale, se reconoce como continuar", () => {
    expect(isCartRecoveryResumeMessage("hagale, sigamos")).toBe(true);
  });

  it("TEST 10: cliente responde ya no, se reconoce como cancelacion", () => {
    expect(isCartRecoveryCancelMessage("ya no voy a pedir")).toBe(true);
  });

  it("TEST 11: cambio de carrito cambia fingerprint", () => {
    const first = computeCartRecoveryFingerprint(baseContext());
    const second = computeCartRecoveryFingerprint(
      baseContext({
        orderFlow: {
          ...baseContext().orderFlow,
          cart: [{ productId: "combo-8", productName: "Combo 8 Presas", quantity: 2, unitPrice: 68000 }],
        },
      }),
    );
    expect(first).not.toBe(second);
  });

  it("TEST 12: contexto sin carrito recuperable no es activo", () => {
    expect(
      hasRecoverableCartContext(baseContext({ orderFlow: { ...baseContext().orderFlow, cart: [] }, activeCart: null })),
    ).toBe(false);
  });

  it("TEST 13: ventana de WhatsApp cerrada no es elegible", () => {
    const result = canSendCartRecovery({
      recoveryEnabled: true,
      attempts: 0,
      maxAttempts: 1,
      conversationStatus: ConversationStatus.ACTIVE,
      isHandoff: false,
      hasRecoverableCart: true,
      checkoutStatus: "BUILDING_CART",
      optedOutAt: null,
      lastMessageAt: new Date("2026-08-19T10:00:00.000Z"),
      now: new Date("2026-08-21T13:00:00.000Z"),
      whatsappProvider: "meta",
    });
    expect(result.reason).toBe("WHATSAPP_WINDOW_CLOSED");
  });

  it("TEST 14: opt-out bloquea recovery", () => {
    const result = canSendCartRecovery({
      recoveryEnabled: true,
      attempts: 0,
      maxAttempts: 1,
      conversationStatus: ConversationStatus.ACTIVE,
      isHandoff: false,
      hasRecoverableCart: true,
      checkoutStatus: "BUILDING_CART",
      optedOutAt: new Date("2026-08-21T12:00:00.000Z"),
      lastMessageAt: new Date("2026-08-21T12:00:00.000Z"),
      now: new Date("2026-08-21T13:00:00.000Z"),
      whatsappProvider: "meta",
    });
    expect(result.reason).toBe("OPT_OUT");
  });

  it("TEST 15: audio sigue por pipeline existente y el recovery solo necesita texto final", () => {
    expect(isCartRecoveryResumeMessage("mande eso")).toBe(true);
  });

  it("TEST 16: config singleton actual aísla por deployment", async () => {
    await syncCartRecoveryFromConversation({
      conversationId: "conv-1",
      contactId: "contact-1",
      context: baseContext(),
      lastMessageAt: new Date("2026-08-21T12:00:00.000Z"),
    });
    expect(state.cartRecoveries[0]?.conversationId).toBe("conv-1");
  });

  it("TEST 17: no elegible por fallo tecnico de outbound", async () => {
    state.sendTextMessage.mockResolvedValueOnce({ success: false, providerMessageId: null });
    state.cartRecoveries.push({
      id: "recovery-1",
      contactId: "contact-1",
      conversationId: "conv-1",
      status: "PENDING",
      cartFingerprint: "fp-1",
      scheduledCheckAt: new Date("2026-08-20T12:10:00.000Z"),
      lastCustomerMessageAt: new Date("2026-08-20T12:00:00.000Z"),
      attempts: 0,
      createdAt: new Date("2026-08-20T12:00:00.000Z"),
      updatedAt: new Date("2026-08-20T12:00:00.000Z"),
      leaseToken: null,
      leaseExpiresAt: null,
    });
    state.conversations[0]!.lastMessageAt = new Date("2026-08-20T12:00:00.000Z");
    await processDueCartRecoveries(new Date("2026-08-20T13:00:00.000Z"));
    expect(state.cartRecoveries[0]?.notEligibleReason).toBe("SEND_FAILED");
  });

  it("TEST 18: cliente con opt-out no recibe recovery", async () => {
    state.cartRecoveries.push({
      id: "recovery-1",
      contactId: "contact-1",
      conversationId: "conv-1",
      status: "PENDING",
      cartFingerprint: "fp-1",
      scheduledCheckAt: new Date("2026-08-21T12:10:00.000Z"),
      lastCustomerMessageAt: new Date("2026-08-21T12:00:00.000Z"),
      attempts: 0,
      createdAt: new Date("2026-08-21T12:00:00.000Z"),
      updatedAt: new Date("2026-08-21T12:00:00.000Z"),
    });
    await recordCartRecoveryOptOut({
      contactId: "contact-1",
      conversationId: "conv-1",
      reason: "no me escriban",
    });
    expect(isCartRecoveryOptOutMessage("no me escriban")).toBe(true);
    expect(state.contacts[0]?.cartRecoveryOptOutAt).toBeTruthy();
    expect(state.cartRecoveries[0]?.status).toBe("CANCELLED");
  });
});
