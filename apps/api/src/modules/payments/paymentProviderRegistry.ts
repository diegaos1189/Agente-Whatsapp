import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";

export interface PaymentProviderCreateResult {
  providerPaymentId: string;
  providerReference: string;
  paymentUrl?: string | null;
  expiresAt?: Date | null;
  raw?: Record<string, unknown>;
}

export interface PaymentProviderRefundResult {
  providerRefundId: string;
  raw?: Record<string, unknown>;
}

export interface ParsedPaymentWebhookEvent {
  provider: string;
  eventId: string;
  eventType: string;
  providerPaymentId?: string | null;
  providerReference?: string | null;
  paymentId?: string | null;
  status: string;
  amount?: number | null;
  currency?: string | null;
  rawPayload: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly providerName: string;
  createPayment(input: {
    paymentId: string;
    amount: number;
    currency: string;
    orderCode: string;
    idempotencyKey: string | null;
  }): Promise<PaymentProviderCreateResult>;
  refundPayment?(input: {
    paymentId: string;
    providerPaymentId: string | null;
    providerReference: string | null;
    amount: number;
    currency: string;
    idempotencyKey: string | null;
  }): Promise<PaymentProviderRefundResult>;
  verifyWebhook?(params: { headers: Record<string, string | string[] | undefined>; rawBody: Buffer }): boolean;
  parseWebhook?(params: { headers: Record<string, string | string[] | undefined>; rawBody: Buffer }): ParsedPaymentWebhookEvent;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const mockProvider: PaymentProvider = {
  providerName: "MOCK",
  async createPayment(input) {
    return {
      providerPaymentId: `mockpay_${input.paymentId}`,
      providerReference: input.orderCode,
      paymentUrl: `${env.PAYMENT_MOCK_BASE_URL.replace(/\/$/, "")}/pay/${input.paymentId}`,
      expiresAt: new Date(Date.now() + 30 * 60_000),
      raw: { mode: "mock" },
    };
  },
  async refundPayment(input) {
    return {
      providerRefundId: `mockrefund_${input.paymentId}_${input.amount}`,
      raw: { mode: "mock" },
    };
  },
  verifyWebhook({ headers, rawBody }) {
    const signature = headers["x-payment-signature"];
    const value = Array.isArray(signature) ? signature[0] : signature;
    if (!value) return false;
    const expected = createHmac("sha256", env.PAYMENT_MOCK_WEBHOOK_SECRET).update(rawBody).digest("hex");
    return safeEqual(value, expected);
  },
  parseWebhook({ rawBody }) {
    const payload = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    return {
      provider: "MOCK",
      eventId: String(payload.eventId ?? ""),
      eventType: String(payload.eventType ?? ""),
      providerPaymentId: payload.providerPaymentId ? String(payload.providerPaymentId) : null,
      providerReference: payload.providerReference ? String(payload.providerReference) : null,
      paymentId: payload.paymentId ? String(payload.paymentId) : null,
      status: String(payload.status ?? "PENDING"),
      amount: typeof payload.amount === "number" ? payload.amount : null,
      currency: payload.currency ? String(payload.currency) : null,
      rawPayload: payload,
    };
  },
};

const providers = new Map<string, PaymentProvider>([
  ["MOCK", mockProvider],
  ["MANUAL", { providerName: "MANUAL", createPayment: async (input) => ({ providerPaymentId: input.paymentId, providerReference: input.orderCode }) }],
]);

export function getPaymentProvider(provider: string): PaymentProvider {
  const resolved = providers.get(provider);
  if (!resolved) {
    throw new Error(`Proveedor de pago no soportado: ${provider}`);
  }
  return resolved;
}
