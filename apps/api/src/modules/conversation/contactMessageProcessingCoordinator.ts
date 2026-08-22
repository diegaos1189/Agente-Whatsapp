import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { logger } from "../../utils/logger.js";

const LEASE_TTL_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const ACQUIRE_RETRY_MS = 250;
const ACQUIRE_TIMEOUT_MS = 90_000;
const MAX_ERROR_LENGTH = 1000;
// Prisma Client runtime ya expone estos delegates despues de `prisma generate`, pero en este
// workspace TypeScript no los infiere bien de `prisma` al compilar el servicio. Ajuste local
// y acotado para usar los modelos nuevos sin cambiar el cliente compartido.
const db = prisma as typeof prisma & {
  inboundWhatsAppMessage: any;
  contactMessageProcessingLease: any;
};

export interface QueuedInboundMessage {
  id: bigint;
  waMessageId: string;
  contactId: string;
  fromPhone: string;
  customerName: string | null;
  inboundType: "TEXT" | "IMAGE" | "AUDIO" | "UNKNOWN";
  text: string | null;
  mediaId: string | null;
  providerTimestamp: string | null;
  attempts: number;
  createdAt: Date;
}

interface ContactLeaseStore {
  enqueueIncomingMessage(input: {
    waMessageId: string;
    contactId: string;
    fromPhone: string;
    customerName: string | null;
    inboundType: QueuedInboundMessage["inboundType"];
    text: string | null;
    mediaId: string | null;
    providerTimestamp: string | null;
  }): Promise<boolean>;
  tryAcquireLease(input: {
    contactId: string;
    leaseToken: string;
    processingState: string;
    currentMessageId: bigint | null;
    now: Date;
    leaseExpiresAt: Date;
  }): Promise<boolean>;
  renewLease(input: {
    contactId: string;
    leaseToken: string;
    processingState: string;
    currentMessageId: bigint | null;
    leaseExpiresAt: Date;
    heartbeatAt: Date;
  }): Promise<void>;
  releaseLease(input: { contactId: string; leaseToken: string; finishedAt: Date }): Promise<void>;
  claimNextQueuedMessage(input: { contactId: string; now: Date; leaseExpiresAt: Date }): Promise<QueuedInboundMessage | null>;
  markQueuedMessageProcessed(input: { id: bigint; processedAt: Date }): Promise<void>;
  markQueuedMessageFailed(input: { id: bigint; error: string }): Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}

function mapInboundType(type: string): QueuedInboundMessage["inboundType"] {
  return type === "TEXT" || type === "IMAGE" || type === "AUDIO" || type === "UNKNOWN" ? type : "UNKNOWN";
}

export function createContactMessageProcessingCoordinator(
  store: ContactLeaseStore,
  deps?: { sleep?: (ms: number) => Promise<void>; now?: () => Date; uuid?: () => string },
) {
  const sleepFn = deps?.sleep ?? sleep;
  const nowFn = deps?.now ?? (() => new Date());
  const uuidFn = deps?.uuid ?? randomUUID;

  async function withLease<T>(
    params: {
      contactId: string;
      processingState: string;
      currentMessageId?: bigint | null;
      waitForLease: boolean;
    },
    task: (leaseToken: string) => Promise<T>,
  ): Promise<T | null> {
    const leaseToken = uuidFn();
    const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;

    while (true) {
      const now = nowFn();
      const leaseExpiresAt = new Date(now.getTime() + LEASE_TTL_MS);
      const acquired = await store.tryAcquireLease({
        contactId: params.contactId,
        leaseToken,
        processingState: params.processingState,
        currentMessageId: params.currentMessageId ?? null,
        now,
        leaseExpiresAt,
      });

      if (acquired) {
        let heartbeat: NodeJS.Timeout | null = null;
        try {
          heartbeat = setInterval(() => {
            const heartbeatAt = nowFn();
            void store
              .renewLease({
                contactId: params.contactId,
                leaseToken,
                processingState: params.processingState,
                currentMessageId: params.currentMessageId ?? null,
                leaseExpiresAt: new Date(heartbeatAt.getTime() + LEASE_TTL_MS),
                heartbeatAt,
              })
              .catch((error) => {
                logger.warn(
                  { err: error, contactId: params.contactId, processingState: params.processingState },
                  "Fallo renovando lease serializado por contacto",
                );
              });
          }, HEARTBEAT_INTERVAL_MS);

          return await task(leaseToken);
        } finally {
          if (heartbeat) clearInterval(heartbeat);
          await store.releaseLease({ contactId: params.contactId, leaseToken, finishedAt: nowFn() }).catch((error) => {
            logger.warn(
              { err: error, contactId: params.contactId, processingState: params.processingState },
              "Fallo liberando lease serializado por contacto",
            );
          });
        }
      }

      if (!params.waitForLease || Date.now() >= deadline) {
        return null;
      }

      await sleepFn(ACQUIRE_RETRY_MS);
    }
  }

  return {
    async enqueueIncomingMessage(input: {
      waMessageId: string;
      contactId: string;
      fromPhone: string;
      customerName: string | null;
      inboundType: QueuedInboundMessage["inboundType"];
      text: string | null;
      mediaId: string | null;
      providerTimestamp: string | null;
    }): Promise<boolean> {
      return store.enqueueIncomingMessage(input);
    },

    async drainIncomingMessages(contactId: string, processor: (message: QueuedInboundMessage) => Promise<void>): Promise<void> {
      await withLease(
        { contactId, processingState: "DRAINING_INBOUND_QUEUE", waitForLease: true },
        async () => {
          while (true) {
            const now = nowFn();
            const queued = await store.claimNextQueuedMessage({
              contactId,
              now,
              leaseExpiresAt: new Date(now.getTime() + LEASE_TTL_MS),
            });
            if (!queued) break;

            logger.info(
              { waMessageId: queued.waMessageId, contactId, attempt: queued.attempts, processingState: "PROCESSING" },
              "Inicio procesamiento serializado de mensaje entrante",
            );

            try {
              await processor(queued);
              await store.markQueuedMessageProcessed({ id: queued.id, processedAt: nowFn() });
              logger.info(
                { waMessageId: queued.waMessageId, contactId, attempt: queued.attempts, processingState: "PROCESSED" },
                "Mensaje entrante procesado en orden",
              );
            } catch (error) {
              await store.markQueuedMessageFailed({ id: queued.id, error: truncateError(error) });
              logger.error(
                { err: error, waMessageId: queued.waMessageId, contactId, attempt: queued.attempts, processingState: "FAILED" },
                "Error procesando mensaje serializado; queda reintentable",
              );
              break;
            }
          }
        },
      );
    },

    async runSerializedContactTask<T>(contactId: string, processingState: string, task: () => Promise<T>): Promise<T> {
      const result = await withLease({ contactId, processingState, waitForLease: true }, async () => task());
      if (result === null) {
        throw new Error(`No se pudo adquirir lease para ${processingState}`);
      }
      return result;
    },
  };
}

const prismaContactLeaseStore: ContactLeaseStore = {
  async enqueueIncomingMessage(input) {
    try {
      await db.inboundWhatsAppMessage.create({
        data: {
          waMessageId: input.waMessageId,
          contactId: input.contactId,
          fromPhone: input.fromPhone,
          customerName: input.customerName,
          inboundType: input.inboundType,
          text: input.text,
          mediaId: input.mediaId,
          providerTimestamp: input.providerTimestamp,
        },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return false;
      }
      throw error;
    }
  },

  async tryAcquireLease(input) {
    const updated = await db.contactMessageProcessingLease.updateMany({
      where: {
        contactId: input.contactId,
        OR: [{ leaseExpiresAt: { lt: input.now } }, { leaseToken: input.leaseToken }],
      },
      data: {
        leaseToken: input.leaseToken,
        leaseExpiresAt: input.leaseExpiresAt,
        processingState: input.processingState,
        currentMessageId: input.currentMessageId,
        lastHeartbeatAt: input.now,
      },
    });
    if (updated.count > 0) return true;

    try {
      await db.contactMessageProcessingLease.create({
        data: {
          contactId: input.contactId,
          leaseToken: input.leaseToken,
          leaseExpiresAt: input.leaseExpiresAt,
          processingState: input.processingState,
          currentMessageId: input.currentMessageId,
          lastHeartbeatAt: input.now,
        },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return false;
      }
      throw error;
    }
  },

  async renewLease(input) {
    await db.contactMessageProcessingLease.updateMany({
      where: { contactId: input.contactId, leaseToken: input.leaseToken },
      data: {
        leaseExpiresAt: input.leaseExpiresAt,
        processingState: input.processingState,
        currentMessageId: input.currentMessageId,
        lastHeartbeatAt: input.heartbeatAt,
      },
    });
  },

  async releaseLease(input) {
    await db.contactMessageProcessingLease.updateMany({
      where: { contactId: input.contactId, leaseToken: input.leaseToken },
      data: {
        leaseExpiresAt: input.finishedAt,
        processingState: "IDLE",
        currentMessageId: null,
        lastFinishedAt: input.finishedAt,
      },
    });
  },

  async claimNextQueuedMessage(input) {
    return prisma.$transaction(async (tx) => {
      const qtx = tx as typeof tx & {
        inboundWhatsAppMessage: any;
        contactMessageProcessingLease: any;
      };
      const next = await qtx.inboundWhatsAppMessage.findFirst({
        where: {
          contactId: input.contactId,
          OR: [
            { processingStatus: "PENDING" },
            { processingStatus: "FAILED" },
            { processingStatus: "PROCESSING", leaseExpiresAt: { lt: input.now } },
          ],
        },
        orderBy: { id: "asc" },
      });
      if (!next) return null;

      const updated = await qtx.inboundWhatsAppMessage.updateMany({
        where: {
          id: next.id,
          OR: [
            { processingStatus: "PENDING" },
            { processingStatus: "FAILED" },
            { processingStatus: "PROCESSING", leaseExpiresAt: { lt: input.now } },
          ],
        },
        data: {
          processingStatus: "PROCESSING",
          attempts: { increment: 1 },
          processingStartedAt: input.now,
          leaseExpiresAt: input.leaseExpiresAt,
          lastError: null,
        },
      });
      if (updated.count === 0) return null;

      await qtx.contactMessageProcessingLease.updateMany({
        where: { contactId: input.contactId },
        data: {
          processingState: "PROCESSING_MESSAGE",
          currentMessageId: next.id,
          leaseExpiresAt: input.leaseExpiresAt,
          lastHeartbeatAt: input.now,
        },
      });

      const claimed = await qtx.inboundWhatsAppMessage.findUniqueOrThrow({ where: { id: next.id } });
      return {
        id: claimed.id,
        waMessageId: claimed.waMessageId,
        contactId: claimed.contactId,
        fromPhone: claimed.fromPhone,
        customerName: claimed.customerName,
        inboundType: mapInboundType(claimed.inboundType),
        text: claimed.text,
        mediaId: claimed.mediaId,
        providerTimestamp: claimed.providerTimestamp,
        attempts: claimed.attempts,
        createdAt: claimed.createdAt,
      } satisfies QueuedInboundMessage;
    });
  },

  async markQueuedMessageProcessed(input) {
    await db.inboundWhatsAppMessage.update({
      where: { id: input.id },
      data: {
        processingStatus: "PROCESSED",
        processedAt: input.processedAt,
        leaseExpiresAt: null,
      },
    });
  },

  async markQueuedMessageFailed(input) {
    await db.inboundWhatsAppMessage.update({
      where: { id: input.id },
      data: {
        processingStatus: "FAILED",
        lastError: input.error,
        leaseExpiresAt: null,
      },
    });
  },
};

export const contactMessageProcessingCoordinator = createContactMessageProcessingCoordinator(prismaContactLeaseStore);
