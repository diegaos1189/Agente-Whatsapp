import { logger } from "../../utils/logger.js";
import { getBusinessSettings } from "../business/businessHoursService.js";
import { env } from "../../config/env.js";

export interface DownloadedMedia {
  base64: string;
  mimeType: string;
  byteLength: number;
  contentLength: number | null;
  fileSize: number | null;
}

export interface WhatsAppClient {
  sendTextMessage(to: string, body: string): Promise<{ success: boolean; providerMessageId: string | null }>;
  /** Descarga un audio/imagen recibido por su media id. Null si no aplica (ej: modo mock) o si fallo. */
  downloadMedia(mediaId: string): Promise<DownloadedMedia | null>;
  /** Marca el mensaje como leido y muestra "escribiendo..." mientras procesamos la respuesta. */
  markAsReadWithTyping(messageId: string): Promise<void>;
  /** Envia una imagen (ej: QR de pago) a partir de un data URL base64 ("data:image/png;base64,..."). */
  sendImageMessage(
    to: string,
    dataUrl: string,
    caption?: string,
  ): Promise<{ success: boolean; providerMessageId: string | null }>;
}

/**
 * Adaptador mock: no llama a Meta, solo loguea. Permite desarrollar y probar
 * todo el flujo de conversacion sin credenciales reales de WhatsApp.
 */
class MockWhatsAppClient implements WhatsAppClient {
  async sendTextMessage(to: string, body: string) {
    logger.info({ to, body }, "[WHATSAPP MOCK] mensaje saliente");
    return { success: true, providerMessageId: `mock-${Date.now()}` };
  }

  async downloadMedia(): Promise<DownloadedMedia | null> {
    logger.info("[WHATSAPP MOCK] downloadMedia no aplica en modo mock");
    return null;
  }

  async markAsReadWithTyping(): Promise<void> {
    logger.info("[WHATSAPP MOCK] markAsReadWithTyping no aplica en modo mock");
  }

  async sendImageMessage(to: string, dataUrl: string, caption?: string) {
    logger.info({ to, caption, size: dataUrl.length }, "[WHATSAPP MOCK] imagen saliente");
    return { success: true, providerMessageId: `mock-${Date.now()}` };
  }
}

/** Adaptador real contra Meta WhatsApp Cloud API (Graph API). */
class MetaWhatsAppClient implements WhatsAppClient {
  private readonly baseUrl: string;
  private readonly graphBaseUrl: string;

  constructor(
    private readonly phoneNumberId: string,
    private readonly token: string,
    private readonly apiVersion: string,
  ) {
    this.baseUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
    this.graphBaseUrl = `https://graph.facebook.com/${apiVersion}`;
  }

  async sendTextMessage(to: string, body: string) {
    if (!this.phoneNumberId || !this.token) {
      logger.error("MetaWhatsAppClient: falta WHATSAPP_PHONE_NUMBER_ID o WHATSAPP_TOKEN");
      return { success: false, providerMessageId: null };
    }

    try {
      const res = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body },
        }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        logger.error({ status: res.status, errBody }, "Meta WhatsApp API respondio error");
        return { success: false, providerMessageId: null };
      }

      const data = (await res.json()) as { messages?: Array<{ id: string }> };
      return { success: true, providerMessageId: data.messages?.[0]?.id ?? null };
    } catch (error) {
      logger.error({ err: error }, "Fallo enviando mensaje via Meta WhatsApp API");
      return { success: false, providerMessageId: null };
    }
  }

  async downloadMedia(mediaId: string): Promise<DownloadedMedia | null> {
    if (!this.token) {
      logger.error("MetaWhatsAppClient: falta WHATSAPP_TOKEN para descargar media");
      return null;
    }

    try {
      const metadataController = new AbortController();
      const metadataTimeout = setTimeout(() => metadataController.abort(), env.WHATSAPP_MEDIA_DOWNLOAD_TIMEOUT_MS);
      // Paso 1: pedir la URL temporal del archivo.
      const metaRes = await fetch(`${this.graphBaseUrl}/${mediaId}`, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: metadataController.signal,
      });
      clearTimeout(metadataTimeout);
      if (!metaRes.ok) {
        logger.error({ status: metaRes.status }, "No se pudo obtener metadata del media de WhatsApp");
        return null;
      }
      const meta = (await metaRes.json()) as { url?: string; mime_type?: string; file_size?: number };
      if (!meta.url) return null;

      const fileController = new AbortController();
      const fileTimeout = setTimeout(() => fileController.abort(), env.WHATSAPP_MEDIA_DOWNLOAD_TIMEOUT_MS);
      // Paso 2: descargar el archivo desde esa URL (tambien requiere el token).
      const fileRes = await fetch(meta.url, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: fileController.signal,
      });
      clearTimeout(fileTimeout);
      if (!fileRes.ok) {
        logger.error({ status: fileRes.status }, "No se pudo descargar el media de WhatsApp");
        return null;
      }
      const arrayBuffer = await fileRes.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      const contentLengthHeader = fileRes.headers.get("content-length");
      return {
        base64,
        mimeType: meta.mime_type ?? fileRes.headers.get("content-type") ?? "application/octet-stream",
        byteLength: Buffer.byteLength(base64, "base64"),
        contentLength: contentLengthHeader ? Number(contentLengthHeader) : null,
        fileSize: typeof meta.file_size === "number" ? meta.file_size : null,
      };
    } catch (error) {
      logger.error({ err: error }, "Fallo descargando media de WhatsApp");
      return null;
    }
  }

  async sendImageMessage(to: string, dataUrl: string, caption?: string) {
    if (!this.phoneNumberId || !this.token) {
      logger.error("MetaWhatsAppClient: falta WHATSAPP_PHONE_NUMBER_ID o WHATSAPP_TOKEN");
      return { success: false, providerMessageId: null };
    }

    try {
      const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
      if (!match) {
        logger.error("sendImageMessage: dataUrl no tiene el formato esperado (data:mime;base64,...)");
        return { success: false, providerMessageId: null };
      }
      const mimeType = match[1] ?? "image/png";
      const base64 = match[2] ?? "";
      const buffer = Buffer.from(base64, "base64");

      // Paso 1: subir la imagen a los servidores de Meta para obtener un media id.
      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append("file", new Blob([buffer], { type: mimeType }), "qr.png");

      const uploadRes = await fetch(`${this.graphBaseUrl}/${this.phoneNumberId}/media`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}` },
        body: form,
      });
      if (!uploadRes.ok) {
        logger.error({ status: uploadRes.status, body: await uploadRes.text() }, "Fallo subiendo imagen a Meta");
        return { success: false, providerMessageId: null };
      }
      const { id: mediaId } = (await uploadRes.json()) as { id: string };

      // Paso 2: mandar el mensaje de tipo imagen referenciando ese media id.
      const res = await fetch(this.baseUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "image",
          image: { id: mediaId, ...(caption ? { caption } : {}) },
        }),
      });
      if (!res.ok) {
        logger.error({ status: res.status, body: await res.text() }, "Fallo enviando imagen via Meta WhatsApp API");
        return { success: false, providerMessageId: null };
      }
      const data = (await res.json()) as { messages?: Array<{ id: string }> };
      return { success: true, providerMessageId: data.messages?.[0]?.id ?? null };
    } catch (error) {
      logger.error({ err: error }, "Fallo enviando imagen via Meta WhatsApp API");
      return { success: false, providerMessageId: null };
    }
  }

  async markAsReadWithTyping(messageId: string): Promise<void> {
    if (!this.token) return;

    try {
      const res = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
          typing_indicator: { type: "text" },
        }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        logger.warn({ status: res.status, errBody }, "No se pudo marcar mensaje como leido/escribiendo");
      }
    } catch (error) {
      logger.warn({ err: error }, "Fallo marcando mensaje como leido/escribiendo");
    }
  }
}

/**
 * Se reconstruye en cada llamada a partir de la configuracion en base de datos (no env),
 * asi que si el operador actualiza el token/numero desde Configuracion, el siguiente
 * mensaje ya usa las credenciales nuevas sin reiniciar el servidor. getBusinessSettings()
 * ya tiene su propia cache corta (30s), asi que esto no pega a la DB en cada mensaje.
 */
export async function getWhatsAppClient(): Promise<WhatsAppClient> {
  const settings = await getBusinessSettings();

  if (settings.whatsappProvider !== "meta") {
    return new MockWhatsAppClient();
  }

  return new MetaWhatsAppClient(settings.whatsappPhoneNumberId, settings.whatsappToken, settings.whatsappApiVersion);
}
