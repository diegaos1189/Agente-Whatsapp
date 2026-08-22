import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { logger } from "../../utils/logger.js";

const DEDUPE_TTL_MS = 10 * 60 * 1000;

export interface IncomingWhatsAppMessageClaimInput {
  waMessageId: string;
  fromPhone: string;
  inboundType: string;
  providerTimestamp: string | null;
}

export interface IncomingWhatsAppMessageClaimStore {
  claim(input: IncomingWhatsAppMessageClaimInput): Promise<boolean>;
}

function cleanupSeenMessageIds(seenMessageIds: Map<string, number>, now: number) {
  for (const [id, seenAt] of seenMessageIds) {
    if (now - seenAt > DEDUPE_TTL_MS) {
      seenMessageIds.delete(id);
    }
  }
}

export function createIncomingWhatsAppMessageIdempotencyService(store: IncomingWhatsAppMessageClaimStore) {
  const seenMessageIds = new Map<string, number>();

  return {
    async claim(input: IncomingWhatsAppMessageClaimInput): Promise<boolean> {
      const now = Date.now();
      cleanupSeenMessageIds(seenMessageIds, now);

      if (seenMessageIds.has(input.waMessageId)) {
        return false;
      }

      try {
        const claimed = await store.claim(input);
        seenMessageIds.set(input.waMessageId, now);
        return claimed;
      } catch (error) {
        // Fallback deliberado: si el registro persistente falla de forma puntual, mantenemos
        // el comportamiento legado en memoria para no dejar de procesar mensajes validos.
        logger.warn(
          { err: error, waMessageId: input.waMessageId },
          "Fallo la idempotencia persistente; se usa fallback en memoria para este proceso",
        );
        seenMessageIds.set(input.waMessageId, now);
        return true;
      }
    },
  };
}

const prismaIncomingWhatsAppMessageClaimStore: IncomingWhatsAppMessageClaimStore = {
  async claim(input) {
    try {
      await prisma.processedWhatsAppMessage.create({
        data: {
          providerMessageId: input.waMessageId,
          fromPhone: input.fromPhone,
          inboundType: input.inboundType,
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
};

export const incomingWhatsAppMessageIdempotencyService = createIncomingWhatsAppMessageIdempotencyService(
  prismaIncomingWhatsAppMessageClaimStore,
);
