import { describe, expect, it, vi } from "vitest";
import { createIncomingWhatsAppMessageIdempotencyService } from "../src/modules/whatsapp/incomingWhatsAppMessageIdempotencyService.js";

const sampleMessage = {
  waMessageId: "wamid.test-123",
  fromPhone: "573001112233",
  inboundType: "TEXT",
  providerTimestamp: "1710000000",
};

describe("incomingWhatsAppMessageIdempotencyService", () => {
  it("bloquea duplicados dentro de la misma instancia sin volver a consultar el store", async () => {
    const store = { claim: vi.fn().mockResolvedValue(true) };
    const service = createIncomingWhatsAppMessageIdempotencyService(store);

    await expect(service.claim(sampleMessage)).resolves.toBe(true);
    await expect(service.claim(sampleMessage)).resolves.toBe(false);
    expect(store.claim).toHaveBeenCalledTimes(1);
  });

  it("bloquea un retry del mismo waMessageId incluso si el proceso se reinicia", async () => {
    const claimedIds = new Set<string>();
    const persistentStore = {
      async claim(input: { waMessageId: string }) {
        if (claimedIds.has(input.waMessageId)) return false;
        claimedIds.add(input.waMessageId);
        return true;
      },
    };

    const processA = createIncomingWhatsAppMessageIdempotencyService(persistentStore);
    const processB = createIncomingWhatsAppMessageIdempotencyService(persistentStore);

    await expect(processA.claim(sampleMessage)).resolves.toBe(true);
    await expect(processB.claim(sampleMessage)).resolves.toBe(false);
  });

  it("si el store persistente falla, conserva fallback al comportamiento legado en memoria", async () => {
    const store = { claim: vi.fn().mockRejectedValue(new Error("db down")) };
    const service = createIncomingWhatsAppMessageIdempotencyService(store);

    await expect(service.claim(sampleMessage)).resolves.toBe(true);
    await expect(service.claim(sampleMessage)).resolves.toBe(false);
    expect(store.claim).toHaveBeenCalledTimes(1);
  });
});
