/** Formas minimas del payload de webhook de Meta WhatsApp Cloud API que efectivamente usamos. */
export interface MetaWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        /** Numero de WhatsApp del negocio que RECIBIO el mensaje: con esto se sabe a que restaurante entra. */
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text?: { body: string };
          image?: { id: string; mime_type?: string; caption?: string };
          audio?: { id: string; mime_type?: string };
        }>;
      };
    }>;
  }>;
}

export type NormalizedInboundType = "TEXT" | "IMAGE" | "AUDIO" | "UNKNOWN";

export interface NormalizedInboundMessage {
  from: string;
  name: string | null;
  type: NormalizedInboundType;
  text: string | null;
  mediaId: string | null;
  mediaMimeType: string | null;
  waMessageId: string;
  timestamp: string;
  /**
   * Numero del negocio al que le escribieron (phone_number_id de Meta). Es la unica pista
   * del payload sobre a que restaurante de la plataforma pertenece el mensaje. Null cuando
   * Meta no lo manda o en payloads de prueba armados a mano (modo mock).
   */
  phoneNumberId: string | null;
}

/** Aplana el payload anidado de Meta a una lista simple de mensajes normalizados. */
export function parseMetaWebhookPayload(payload: MetaWebhookPayload): NormalizedInboundMessage[] {
  const results: NormalizedInboundMessage[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages) continue;

      const phoneNumberId = value.metadata?.phone_number_id ?? null;

      const nameByWaId = new Map(
        (value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null] as const),
      );

      for (const msg of value.messages) {
        let type: NormalizedInboundType = "UNKNOWN";
        let text: string | null = null;
        let mediaId: string | null = null;
        let mediaMimeType: string | null = null;

        if (msg.type === "text" && msg.text) {
          type = "TEXT";
          text = msg.text.body;
        } else if (msg.type === "image" && msg.image) {
          type = "IMAGE";
          mediaId = msg.image.id;
          mediaMimeType = msg.image.mime_type ?? null;
          text = msg.image.caption ?? null;
        } else if (msg.type === "audio" && msg.audio) {
          type = "AUDIO";
          mediaId = msg.audio.id;
          mediaMimeType = msg.audio.mime_type ?? null;
        }

        results.push({
          from: msg.from,
          name: nameByWaId.get(msg.from) ?? null,
          type,
          text,
          mediaId,
          mediaMimeType,
          waMessageId: msg.id,
          timestamp: msg.timestamp,
          phoneNumberId,
        });
      }
    }
  }

  return results;
}
