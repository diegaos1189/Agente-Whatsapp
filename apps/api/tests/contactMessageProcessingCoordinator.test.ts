import { describe, expect, it, vi } from "vitest";
import {
  createContactMessageProcessingCoordinator,
  type QueuedInboundMessage,
} from "../src/modules/conversation/contactMessageProcessingCoordinator.js";

type Lease = {
  contactId: string;
  leaseToken: string;
  leaseExpiresAt: Date;
  processingState: string;
  currentMessageId: bigint | null;
};

class FakeStore {
  public messages: Array<
    QueuedInboundMessage & {
      processingStatus: "PENDING" | "PROCESSING" | "PROCESSED" | "FAILED";
      leaseExpiresAt: Date | null;
      lastError: string | null;
      processedAt: Date | null;
    }
  > = [];

  public leases = new Map<string, Lease>();
  private nextId = 1n;

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
    if (this.messages.some((m) => m.waMessageId === input.waMessageId)) return false;
    this.messages.push({
      id: this.nextId++,
      waMessageId: input.waMessageId,
      contactId: input.contactId,
      fromPhone: input.fromPhone,
      customerName: input.customerName,
      inboundType: input.inboundType,
      text: input.text,
      mediaId: input.mediaId,
      providerTimestamp: input.providerTimestamp,
      attempts: 0,
      createdAt: new Date(),
      processingStatus: "PENDING",
      leaseExpiresAt: null,
      lastError: null,
      processedAt: null,
    });
    return true;
  }

  async tryAcquireLease(input: {
    contactId: string;
    leaseToken: string;
    processingState: string;
    currentMessageId: bigint | null;
    now: Date;
    leaseExpiresAt: Date;
  }): Promise<boolean> {
    const existing = this.leases.get(input.contactId);
    if (!existing || existing.leaseExpiresAt < input.now || existing.leaseToken === input.leaseToken) {
      this.leases.set(input.contactId, {
        contactId: input.contactId,
        leaseToken: input.leaseToken,
        leaseExpiresAt: input.leaseExpiresAt,
        processingState: input.processingState,
        currentMessageId: input.currentMessageId,
      });
      return true;
    }
    return false;
  }

  async renewLease(input: {
    contactId: string;
    leaseToken: string;
    processingState: string;
    currentMessageId: bigint | null;
    leaseExpiresAt: Date;
    heartbeatAt: Date;
  }): Promise<void> {
    const existing = this.leases.get(input.contactId);
    if (!existing || existing.leaseToken !== input.leaseToken) return;
    existing.leaseExpiresAt = input.leaseExpiresAt;
    existing.processingState = input.processingState;
    existing.currentMessageId = input.currentMessageId;
  }

  async releaseLease(input: { contactId: string; leaseToken: string; finishedAt: Date }): Promise<void> {
    const existing = this.leases.get(input.contactId);
    if (!existing || existing.leaseToken !== input.leaseToken) return;
    existing.leaseExpiresAt = input.finishedAt;
    existing.processingState = "IDLE";
    existing.currentMessageId = null;
  }

  async claimNextQueuedMessage(input: {
    contactId: string;
    now: Date;
    leaseExpiresAt: Date;
  }): Promise<QueuedInboundMessage | null> {
    const next = this.messages
      .filter(
        (m) =>
          m.contactId === input.contactId &&
          (m.processingStatus === "PENDING" ||
            m.processingStatus === "FAILED" ||
            (m.processingStatus === "PROCESSING" && m.leaseExpiresAt !== null && m.leaseExpiresAt < input.now)),
      )
      .sort((a, b) => Number(a.id - b.id))[0];

    if (!next) return null;

    next.processingStatus = "PROCESSING";
    next.attempts += 1;
    next.leaseExpiresAt = input.leaseExpiresAt;
    next.lastError = null;

    const lease = this.leases.get(input.contactId);
    if (lease) {
      lease.processingState = "PROCESSING_MESSAGE";
      lease.currentMessageId = next.id;
      lease.leaseExpiresAt = input.leaseExpiresAt;
    }

    return {
      id: next.id,
      waMessageId: next.waMessageId,
      contactId: next.contactId,
      fromPhone: next.fromPhone,
      customerName: next.customerName,
      inboundType: next.inboundType,
      text: next.text,
      mediaId: next.mediaId,
      providerTimestamp: next.providerTimestamp,
      attempts: next.attempts,
      createdAt: next.createdAt,
    };
  }

  async markQueuedMessageProcessed(input: { id: bigint; processedAt: Date }): Promise<void> {
    const msg = this.messages.find((m) => m.id === input.id);
    if (!msg) return;
    msg.processingStatus = "PROCESSED";
    msg.processedAt = input.processedAt;
    msg.leaseExpiresAt = null;
  }

  async markQueuedMessageFailed(input: { id: bigint; error: string }): Promise<void> {
    const msg = this.messages.find((m) => m.id === input.id);
    if (!msg) return;
    msg.processingStatus = "FAILED";
    msg.lastError = input.error;
    msg.leaseExpiresAt = null;
  }
}

function buildCoordinator(store: FakeStore, nowRef?: { value: Date }) {
  return createContactMessageProcessingCoordinator(store, {
    now: nowRef ? () => nowRef.value : undefined,
    sleep: async () => {},
    uuid: () => Math.random().toString(36).slice(2),
  });
}

async function enqueueMany(
  coordinator: ReturnType<typeof createContactMessageProcessingCoordinator>,
  contactId: string,
  items: Array<{ wa: string; text: string; phone?: string }>,
) {
  for (const item of items) {
    await coordinator.enqueueIncomingMessage({
      waMessageId: item.wa,
      contactId,
      fromPhone: item.phone ?? `57${contactId}`,
      customerName: null,
      inboundType: "TEXT",
      text: item.text,
      mediaId: null,
      providerTimestamp: null,
    });
  }
}

describe("contactMessageProcessingCoordinator", () => {
  it("procesa A -> B -> C para el mismo contacto aunque entren casi simultaneamente", async () => {
    const store = new FakeStore();
    const coordinator = buildCoordinator(store);
    const order: string[] = [];

    await enqueueMany(coordinator, "juan", [
      { wa: "wamid-a", text: "A" },
      { wa: "wamid-b", text: "B" },
      { wa: "wamid-c", text: "C" },
    ]);

    await Promise.all([
      coordinator.drainIncomingMessages("juan", async (m) => {
        order.push(m.text ?? "");
      }),
      coordinator.drainIncomingMessages("juan", async (m) => {
        order.push(`dup-${m.text ?? ""}`);
      }),
      coordinator.drainIncomingMessages("juan", async (m) => {
        order.push(`dup2-${m.text ?? ""}`);
      }),
    ]);

    expect(order).toEqual(["A", "B", "C"]);
  });

  it("permite procesamiento paralelo entre contactos diferentes", async () => {
    const store = new FakeStore();
    const coordinator = buildCoordinator(store);
    const started: string[] = [];
    let juanResolved = false;
    const juanGate = new Promise<void>((resolve) => setTimeout(() => {
      juanResolved = true;
      resolve();
    }, 20));

    await enqueueMany(coordinator, "juan", [{ wa: "wamid-juan", text: "A" }]);
    await enqueueMany(coordinator, "maria", [{ wa: "wamid-maria", text: "X" }]);

    await Promise.all([
      coordinator.drainIncomingMessages("juan", async (m) => {
        started.push(`juan:${m.text}`);
        await juanGate;
      }),
      coordinator.drainIncomingMessages("maria", async (m) => {
        started.push(`maria:${m.text}`);
      }),
    ]);

    expect(started).toContain("juan:A");
    expect(started).toContain("maria:X");
    expect(juanResolved).toBe(true);
  });

  it("no encola dos veces el mismo waMessageId", async () => {
    const store = new FakeStore();
    const coordinator = buildCoordinator(store);
    const processed: string[] = [];

    await expect(
      coordinator.enqueueIncomingMessage({
        waMessageId: "wamid-dup",
        contactId: "juan",
        fromPhone: "573001",
        customerName: null,
        inboundType: "TEXT",
        text: "Hola",
        mediaId: null,
        providerTimestamp: null,
      }),
    ).resolves.toBe(true);

    await expect(
      coordinator.enqueueIncomingMessage({
        waMessageId: "wamid-dup",
        contactId: "juan",
        fromPhone: "573001",
        customerName: null,
        inboundType: "TEXT",
        text: "Hola duplicado",
        mediaId: null,
        providerTimestamp: null,
      }),
    ).resolves.toBe(false);

    await coordinator.drainIncomingMessages("juan", async (m) => {
      processed.push(m.waMessageId);
    });

    expect(processed).toEqual(["wamid-dup"]);
  });

  it("el segundo mensaje espera a que el primero cree el carrito", async () => {
    const store = new FakeStore();
    const coordinator = buildCoordinator(store);
    const cart: string[] = [];
    const seenSecond: string[] = [];

    await enqueueMany(coordinator, "juan", [
      { wa: "wamid-1", text: "Quiero dos combos" },
      { wa: "wamid-2", text: "El segundo sin ensalada" },
    ]);

    await coordinator.drainIncomingMessages("juan", async (m) => {
      if (m.text === "Quiero dos combos") {
        cart.push("combo-1", "combo-2");
      } else {
        seenSecond.push(cart.join(","));
      }
    });

    expect(seenSecond).toEqual(["combo-1,combo-2"]);
  });

  it("si un procesamiento tarda, el siguiente del mismo contacto espera pero otro contacto sigue", async () => {
    const store = new FakeStore();
    const coordinator = buildCoordinator(store);
    const events: string[] = [];
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });

    await enqueueMany(coordinator, "juan", [
      { wa: "wamid-a", text: "A" },
      { wa: "wamid-b", text: "B" },
    ]);
    await enqueueMany(coordinator, "maria", [{ wa: "wamid-x", text: "X" }]);

    const juanRun = coordinator.drainIncomingMessages("juan", async (m) => {
      events.push(`start:${m.contactId}:${m.text}`);
      if (m.text === "A") {
        await slowGate;
      }
      events.push(`end:${m.contactId}:${m.text}`);
    });

    const mariaRun = coordinator.drainIncomingMessages("maria", async (m) => {
      events.push(`done:${m.contactId}:${m.text}`);
    });

    await Promise.resolve();
    await mariaRun;
    releaseSlow();
    await juanRun;

    expect(events.indexOf("done:maria:X")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("start:juan:B")).toBeGreaterThan(events.indexOf("end:juan:A"));
  });

  it("si hay error, el contacto no queda bloqueado permanentemente y el mensaje queda FAILED", async () => {
    const store = new FakeStore();
    const coordinator = buildCoordinator(store);

    await enqueueMany(coordinator, "juan", [{ wa: "wamid-fail", text: "A" }]);

    await coordinator.drainIncomingMessages("juan", async () => {
      throw new Error("boom");
    });

    const failed = store.messages.find((m) => m.waMessageId === "wamid-fail");
    expect(failed?.processingStatus).toBe("FAILED");

    await expect(
      coordinator.runSerializedContactTask("juan", "MANUAL_FIX", async () => "ok"),
    ).resolves.toBe("ok");
  });

  it("recupera un mensaje que habia quedado en PROCESSING con lease expirada", async () => {
    const store = new FakeStore();
    const nowRef = { value: new Date("2026-08-21T12:00:00.000Z") };
    const coordinator = buildCoordinator(store, nowRef);
    const recovered: string[] = [];

    await enqueueMany(coordinator, "juan", [{ wa: "wamid-stale", text: "A" }]);
    const msg = store.messages[0]!;
    msg.processingStatus = "PROCESSING";
    msg.attempts = 1;
    msg.leaseExpiresAt = new Date(nowRef.value.getTime() - 1000);

    await coordinator.drainIncomingMessages("juan", async (m) => {
      recovered.push(m.waMessageId);
    });

    expect(recovered).toEqual(["wamid-stale"]);
    expect(store.messages[0]?.processingStatus).toBe("PROCESSED");
    expect(store.messages[0]?.attempts).toBe(2);
  });
});
