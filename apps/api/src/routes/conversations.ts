import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { ConversationStatus, HandoffReason, MessageDirection, MessageType } from "@pollos/shared";
import type { ConversationDetailDTO, ConversationSummaryDTO, MessageDTO, PendingOrderDTO } from "@pollos/shared";
import { getWhatsAppClient } from "../modules/whatsapp/whatsappClient.js";
import {
  requestDeliveryAddressFromHuman,
  savePendingOrder,
  confirmPendingOrderWithAi,
} from "../modules/conversation/conversationService.js";
import { listAllProductsFlat, getEffectivePrice } from "../modules/products/productService.js";
import { canAdminReply, canAdminTakeConversation, isHumanHandoffStatus } from "../modules/conversation/conversationHandoff.js";

const pendingOrderEditSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string(),
      productName: z.string(),
      quantity: z.number().int().positive(),
      unitPrice: z.number().int().nonnegative(),
    }),
  ),
  deliveryType: z.enum(["DELIVERY", "PICKUP"]).nullable(),
  address: z.string().nullable().optional(),
  neighborhood: z.string().nullable().optional(),
  paymentMethod: z.enum(["CASH", "TRANSFER", "CARD_ON_DELIVERY"]).nullable(),
});

const actorSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  role: z.enum(["ADMIN", "STAFF"]),
  permissions: z.array(z.string()),
});

type AdminActor = z.infer<typeof actorSchema>;

function getAdminActor(request: FastifyRequest): AdminActor {
  const raw = {
    id: String(request.headers["x-admin-user-id"] ?? ""),
    username: String(request.headers["x-admin-username"] ?? ""),
    role: String(request.headers["x-admin-role"] ?? ""),
    permissions: String(request.headers["x-admin-permissions"] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  };
  return actorSchema.parse(raw);
}

function requireConversationPermission(actor: AdminActor): void {
  if (actor.role === "ADMIN") return;
  if (!actor.permissions.includes("conversations")) {
    throw new Error("No autorizado para operar conversaciones");
  }
}

async function createAuditEvent(params: {
  conversationId: string;
  actor: AdminActor | null;
  eventType: string;
  reason?: string | null;
  note?: string | null;
}) {
  await prisma.conversationAuditEvent.create({
    data: {
      conversationId: params.conversationId,
      adminUserId: params.actor?.id ?? null,
      eventType: params.eventType,
      reason: params.reason ?? null,
      note: params.note ?? null,
    },
  });
}

async function markOpenHandoffsResolved(conversationId: string, actorId: string | null) {
  await prisma.handoff.updateMany({
    where: { conversationId, resolvedAt: null },
    data: { resolvedAt: new Date(), resolvedByAdminUserId: actorId },
  });
}

/** Lee el carrito que la IA ya armo dentro del contexto de la conversacion (JSON), antes de
 * que exista un Order real - asi un humano en handoff ve de una vez lo que el cliente ya
 * pidio en vez de arrancar el pedido manual desde cero. */
function extractPendingOrder(context: unknown): PendingOrderDTO | null {
  if (!context || typeof context !== "object" || !("orderFlow" in context)) return null;
  const activeCart = (context as { activeCart?: unknown }).activeCart;
  if (activeCart && typeof activeCart === "object" && "items" in (activeCart as Record<string, unknown>)) {
    const items = ((activeCart as { items?: unknown[] }).items ?? []) as Array<{
      id: string;
      productId: string;
      productName: string;
      unitPrice: number;
      notes?: string[];
      components?: Array<{
        id: string;
        productId: string | null;
        productName: string;
        categoryName: string | null;
        quantity: number;
        unitPrice: number;
        source: "INCLUDED" | "ADDED";
        status: "ACTIVE" | "REMOVED";
      }>;
    }>;
    if (items.length === 0) return null;
    const flow = (context as { orderFlow?: unknown }).orderFlow as {
      deliveryType?: "DELIVERY" | "PICKUP" | null;
      address?: string | null;
      neighborhood?: string | null;
      paymentMethod?: "CASH" | "TRANSFER" | "CARD_ON_DELIVERY" | null;
    };
    return {
      cart: items.map((item) => ({
        itemId: item.id,
        productId: item.productId,
        productName: item.productName,
        quantity: 1,
        unitPrice: item.unitPrice,
        notes: item.notes?.join(", ") ?? null,
        components:
          item.components?.map((component) => ({
            componentId: component.id,
            productId: component.productId,
            productName: component.productName,
            categoryName: component.categoryName,
            quantity: component.quantity,
            unitPrice: component.unitPrice,
            source: component.source,
            status: component.status,
          })) ?? [],
      })),
      deliveryType: flow.deliveryType ?? null,
      address: flow.address ?? null,
      neighborhood: flow.neighborhood ?? null,
      paymentMethod: flow.paymentMethod ?? null,
    };
  }
  const orderFlow = (context as { orderFlow?: unknown }).orderFlow;
  if (!orderFlow || typeof orderFlow !== "object" || !("cart" in orderFlow)) return null;
  const flow = orderFlow as {
    cart?: Array<{ productId: string | null; productName: string; quantity: number; unitPrice: number }>;
    deliveryType?: "DELIVERY" | "PICKUP" | null;
    address?: string | null;
    neighborhood?: string | null;
    paymentMethod?: "CASH" | "TRANSFER" | "CARD_ON_DELIVERY" | null;
  };
  if (!flow.cart || flow.cart.length === 0) return null;
  return {
    cart: flow.cart,
    deliveryType: flow.deliveryType ?? null,
    address: flow.address ?? null,
    neighborhood: flow.neighborhood ?? null,
    paymentMethod: flow.paymentMethod ?? null,
  };
}

export async function conversationRoutes(app: FastifyInstance) {
  app.get("/api/conversations", async () => {
    const conversations = await prisma.conversation.findMany({
      where: { status: { not: ConversationStatus.CLOSED } },
      orderBy: { lastMessageAt: "desc" },
      include: {
        contact: true,
        assignedAdminUser: true,
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      take: 100,
    });

    const result: ConversationSummaryDTO[] = conversations.map((conversation) => ({
      id: conversation.id,
      contactId: conversation.contactId,
      customerName: conversation.contact.name,
      phone: conversation.contact.phone,
      status: conversation.status as ConversationSummaryDTO["status"],
      isHandoff: conversation.isHandoff,
      handoffReason: conversation.handoffReason,
      assignedAdminUserId: conversation.assignedAdminUserId,
      assignedAdminUsername: conversation.assignedAdminUser?.username ?? null,
      takenAt: conversation.takenAt?.toISOString() ?? null,
      lastMessagePreview: conversation.messages[0]?.body.slice(0, 140) ?? null,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      createdAt: conversation.createdAt.toISOString(),
    }));

    return result;
  });

  app.get("/api/conversations/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: { contact: true, assignedAdminUser: true },
    });
    if (!conversation) return reply.status(404).send({ error: "Conversacion no encontrada" });

    const result: ConversationDetailDTO = {
      id: conversation.id,
      contactId: conversation.contactId,
      customerName: conversation.contact.name,
      phone: conversation.contact.phone,
      status: conversation.status as ConversationDetailDTO["status"],
      isHandoff: conversation.isHandoff,
      handoffReason: conversation.handoffReason,
      assignedAdminUserId: conversation.assignedAdminUserId,
      assignedAdminUsername: conversation.assignedAdminUser?.username ?? null,
      takenAt: conversation.takenAt?.toISOString() ?? null,
      pendingOrder: extractPendingOrder(conversation.context),
    };
    return result;
  });

  app.get("/api/conversations/:id/messages", async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation) return reply.status(404).send({ error: "Conversacion no encontrada" });

    const messages = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: "asc" },
      include: { adminUser: true },
    });

    const result: MessageDTO[] = messages.map((message) => ({
      id: message.id,
      conversationId: message.conversationId,
      direction: message.direction as MessageDTO["direction"],
      type: message.type,
      senderType: (message.senderType as MessageDTO["senderType"]) ?? null,
      adminUserId: message.adminUserId,
      adminUsername: message.adminUser?.username ?? null,
      body: message.body,
      mediaUrl: message.mediaUrl,
      createdAt: message.createdAt.toISOString(),
    }));

    return result;
  });

  app.post("/api/conversations/:id/reply", async (request, reply) => {
    const actor = getAdminActor(request);
    requireConversationPermission(actor);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { body } = z.object({ body: z.string().min(1) }).parse(request.body);

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: { contact: true },
    });
    if (!conversation) return reply.status(404).send({ error: "Conversacion no encontrada" });
    if (!canAdminReply(conversation, actor.id)) {
      return reply.status(409).send({ error: "Debes tomar la conversacion antes de responder." });
    }

    const client = await getWhatsAppClient();
    const result = await client.sendTextMessage(conversation.contact.phone, body);
    if (!result.success) return reply.status(502).send({ error: "No se pudo enviar el mensaje por WhatsApp" });

    const message = await prisma.message.create({
      data: {
        conversationId: id,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEXT,
        senderType: "HUMAN",
        adminUserId: actor.id,
        body,
      },
    });
    await prisma.conversation.update({ where: { id }, data: { lastMessageAt: new Date() } });
    await createAuditEvent({ conversationId: id, actor, eventType: "HUMAN_MESSAGE_SENT", note: body.slice(0, 280) });

    return { id: message.id, createdAt: message.createdAt.toISOString() };
  });

  app.post("/api/conversations/:id/take", async (request, reply) => {
    const actor = getAdminActor(request);
    requireConversationPermission(actor);
    const { id } = z.object({ id: z.string() }).parse(request.params);

    const current = await prisma.conversation.findUnique({ where: { id } });
    if (!current) return reply.status(404).send({ error: "Conversacion no encontrada" });

    if (current.status === ConversationStatus.HUMAN && current.assignedAdminUserId === actor.id) {
      return { ok: true, status: current.status, assignedAdminUserId: actor.id };
    }

    if (!canAdminTakeConversation(current)) {
      return reply.status(409).send({ error: "La conversacion ya fue tomada o no esta esperando humano." });
    }

    const updated = await prisma.conversation.updateMany({
      where: { id, status: ConversationStatus.WAITING_HUMAN, assignedAdminUserId: null },
      data: {
        status: ConversationStatus.HUMAN,
        isHandoff: true,
        assignedAdminUserId: actor.id,
        takenAt: new Date(),
      },
    });

    if (updated.count !== 1) {
      return reply.status(409).send({ error: "Otro empleado tomo la conversacion antes." });
    }

    await createAuditEvent({ conversationId: id, actor, eventType: "CONVERSATION_TAKEN", reason: current.handoffReason });
    return { ok: true };
  });

  app.post("/api/conversations/:id/release", async (request, reply) => {
    const actor = getAdminActor(request);
    requireConversationPermission(actor);
    const { id } = z.object({ id: z.string() }).parse(request.params);

    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation) return reply.status(404).send({ error: "Conversacion no encontrada" });
    if (!canAdminReply(conversation, actor.id)) {
      return reply.status(409).send({ error: "Solo quien la tiene asignada puede soltar la conversacion." });
    }

    await prisma.conversation.update({
      where: { id },
      data: {
        status: ConversationStatus.WAITING_HUMAN,
        isHandoff: true,
        assignedAdminUserId: null,
        takenAt: null,
      },
    });
    await createAuditEvent({ conversationId: id, actor, eventType: "CONVERSATION_RELEASED", reason: conversation.handoffReason });
    return { ok: true };
  });

  app.post("/api/conversations/:id/return-to-bot", async (request, reply) => {
    const actor = getAdminActor(request);
    requireConversationPermission(actor);
    const { id } = z.object({ id: z.string() }).parse(request.params);

    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation) return reply.status(404).send({ error: "Conversacion no encontrada" });
    if (
      conversation.status === ConversationStatus.HUMAN &&
      conversation.assignedAdminUserId !== actor.id &&
      actor.role !== "ADMIN"
    ) {
      return reply.status(409).send({ error: "Solo quien la tiene asignada puede devolverla al bot." });
    }

    await prisma.conversation.update({
      where: { id },
      data: {
        status: ConversationStatus.ACTIVE,
        isHandoff: false,
        handoffReason: null,
        assignedAdminUserId: null,
        takenAt: null,
        failedAttempts: 0,
      },
    });
    await markOpenHandoffsResolved(id, actor.id);
    await createAuditEvent({ conversationId: id, actor, eventType: "RETURNED_TO_BOT" });
    return { ok: true };
  });

  app.post("/api/conversations/:id/request-address", async (request, reply) => {
    const actor = getAdminActor(request);
    requireConversationPermission(actor);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { items } = z
      .object({ items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive() })) })
      .parse(request.body);

    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation) return reply.status(404).send({ error: "Conversacion no encontrada" });

    const allProducts = await listAllProductsFlat();
    const cart = await Promise.all(
      items.map(async (item) => {
        const product = allProducts.find((candidate) => candidate.id === item.productId);
        return {
          productId: item.productId,
          productName: product?.name ?? "Producto",
          quantity: item.quantity,
          unitPrice: product ? await getEffectivePrice(product.id, product.price) : 0,
        };
      }),
    );

    try {
      const result = await requestDeliveryAddressFromHuman(id, cart);
      await createAuditEvent({ conversationId: id, actor, eventType: "HUMAN_REQUESTED_DELIVERY_ADDRESS" });
      return result;
    } catch (error) {
      return reply.status(502).send({ error: error instanceof Error ? error.message : "No se pudo enviar el mensaje" });
    }
  });

  app.post("/api/conversations/:id/save-pending-order", async (request, reply) => {
    const actor = getAdminActor(request);
    requireConversationPermission(actor);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = pendingOrderEditSchema.parse(request.body);

    try {
      await savePendingOrder(id, {
        cart: body.items,
        deliveryType: body.deliveryType,
        address: body.address ?? null,
        neighborhood: body.neighborhood ?? null,
        paymentMethod: body.paymentMethod,
      });
      await createAuditEvent({ conversationId: id, actor, eventType: "PENDING_ORDER_SAVED" });
      return { ok: true };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : "No se pudo guardar el pedido" });
    }
  });

  app.post("/api/conversations/:id/confirm-pending-order", async (request, reply) => {
    const actor = getAdminActor(request);
    requireConversationPermission(actor);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = pendingOrderEditSchema.parse(request.body);

    try {
      await confirmPendingOrderWithAi(id, {
        cart: body.items,
        deliveryType: body.deliveryType,
        address: body.address ?? null,
        neighborhood: body.neighborhood ?? null,
        paymentMethod: body.paymentMethod,
      });
      await createAuditEvent({ conversationId: id, actor, eventType: "PENDING_ORDER_CONFIRMED_WITH_AI" });
      return { ok: true };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : "No se pudo confirmar el pedido con el cliente" });
    }
  });

  app.post("/api/conversations/:id/escalate", async (request, reply) => {
    const actor = getAdminActor(request);
    requireConversationPermission(actor);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation) return reply.status(404).send({ error: "Conversacion no encontrada" });

    if (!isHumanHandoffStatus(conversation.status) && !conversation.isHandoff) {
      await prisma.conversation.update({
        where: { id },
        data: {
          isHandoff: true,
          handoffReason: HandoffReason.AGENT_MANUAL,
          status: ConversationStatus.WAITING_HUMAN,
          assignedAdminUserId: null,
          takenAt: null,
        },
      });
      await prisma.handoff.create({
        data: {
          conversationId: id,
          reason: HandoffReason.AGENT_MANUAL,
          note: "Escalado manualmente desde el panel",
          requestedByAdminUserId: actor.id,
        },
      });
      await createAuditEvent({
        conversationId: id,
        actor,
        eventType: "HANDOFF_REQUESTED",
        reason: HandoffReason.AGENT_MANUAL,
        note: "Escalado manualmente desde el panel",
      });
    }

    return { ok: true };
  });

  app.post("/api/conversations/:id/archive", async (request, reply) => {
    const actor = getAdminActor(request);
    requireConversationPermission(actor);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation) return reply.status(404).send({ error: "Conversacion no encontrada" });

    await prisma.conversation.update({
      where: { id },
      data: {
        status: ConversationStatus.CLOSED,
        isHandoff: false,
        assignedAdminUserId: null,
        takenAt: null,
      },
    });
    await markOpenHandoffsResolved(id, actor.id);
    await createAuditEvent({ conversationId: id, actor, eventType: "CONVERSATION_CLOSED", reason: conversation.handoffReason });
    return { ok: true };
  });

  app.post("/api/conversations/:id/resolve-handoff", async (request, reply) => {
    return app.inject({
      method: "POST",
      url: `/api/conversations/${(request.params as { id: string }).id}/return-to-bot`,
      headers: request.headers as Record<string, string>,
    }).then((injected) => reply.status(injected.statusCode).headers(injected.headers).send(injected.body));
  });
}
