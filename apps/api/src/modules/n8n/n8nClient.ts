import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import type { N8nOutboundPayload } from "@pollos/shared";

/**
 * Envia un payload a un webhook de n8n. Si la URL no esta configurada, solo
 * loguea (modo "preparado pero no conectado") en vez de fallar el flujo principal.
 * Ver docs/N8N_INTEGRATION.md para contratos y ejemplos de workflow.
 */
async function postToN8n(url: string, payload: N8nOutboundPayload): Promise<void> {
  if (!url) {
    logger.info({ event: payload.event, payload }, "[N8N] webhook no configurado, solo logueo");
    return;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      logger.error({ status: res.status, event: payload.event }, "n8n respondio error");
    }
  } catch (error) {
    logger.error({ err: error, event: payload.event }, "Fallo enviando webhook a n8n");
  }
}

export const n8nClient = {
  notifyOrderCreated: (payload: Extract<N8nOutboundPayload, { event: "order.created" }>) =>
    postToN8n(env.N8N_WEBHOOK_URL_ORDER_CREATED, payload),

  notifyPaymentReminder: (payload: Extract<N8nOutboundPayload, { event: "payment.reminder" }>) =>
    postToN8n(env.N8N_WEBHOOK_URL_PAYMENT_REMINDER, payload),

  notifyOperator: (payload: Extract<N8nOutboundPayload, { event: "operator.notification" }>) =>
    postToN8n(env.N8N_WEBHOOK_URL_OPERATOR_NOTIFICATION, payload),

  notifyHandoff: (payload: Extract<N8nOutboundPayload, { event: "conversation.handoff" }>) =>
    postToN8n(env.N8N_WEBHOOK_URL_HANDOFF, payload),
};
