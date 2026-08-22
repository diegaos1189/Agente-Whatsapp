import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import type { AudioTranscriptionResult } from "../ai/aiClient.js";
import { normalizeLocalizedText } from "../localization/localeService.js";
import type { DownloadedMedia } from "../whatsapp/whatsappClient.js";

export interface ProcessWhatsAppAudioResult {
  status:
    | "READY"
    | "DOWNLOAD_FAILED"
    | "UNSUPPORTED_MIME"
    | "TOO_LARGE"
    | "TOO_LONG"
    | "TRANSCRIPTION_FAILED"
    | "EMPTY_TRANSCRIPT";
  transcript: AudioTranscriptionResult | null;
  normalizedText: string | null;
  fallbackMessage: string | null;
  debugReason: string | null;
}

export interface ProcessWhatsAppAudioParams {
  media: DownloadedMedia | null;
  webhookMimeType?: string | null;
  transcribe: (base64: string, mimeType: string) => Promise<AudioTranscriptionResult>;
}

const DEFAULT_AUDIO_FAILURE_MESSAGE =
  "No pude entender bien el audio. Â¿Puedes enviarlo nuevamente o escribirme el pedido?";
const DEFAULT_AUDIO_LIMIT_MESSAGE =
  "La nota de voz es demasiado grande para procesarla por aqui. Â¿Puedes enviarla mas corta o escribirme el pedido?";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout:${timeoutMs}`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function getAllowedMimeTypes(): Set<string> {
  return new Set(
    env.ALLOWED_WHATSAPP_AUDIO_MIME_TYPES.split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function resolveMimeType(media: DownloadedMedia, webhookMimeType?: string | null): string {
  return (media.mimeType || webhookMimeType || "application/octet-stream").toLowerCase();
}

function buildNormalizedTranscript(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  return normalizeLocalizedText(text);
}

export async function processWhatsAppAudio(params: ProcessWhatsAppAudioParams): Promise<ProcessWhatsAppAudioResult> {
  if (!params.media) {
    return {
      status: "DOWNLOAD_FAILED",
      transcript: null,
      normalizedText: null,
      fallbackMessage: DEFAULT_AUDIO_FAILURE_MESSAGE,
      debugReason: "download_failed",
    };
  }

  const mimeType = resolveMimeType(params.media, params.webhookMimeType);
  const allowedMimeTypes = getAllowedMimeTypes();
  if (!allowedMimeTypes.has(mimeType)) {
    return {
      status: "UNSUPPORTED_MIME",
      transcript: null,
      normalizedText: null,
      fallbackMessage: "Ese archivo de audio no tiene un formato soportado. Â¿Puedes enviarme una nota de voz normal o escribir el pedido?",
      debugReason: `unsupported_mime:${mimeType}`,
    };
  }

  const measuredBytes = params.media.fileSize ?? params.media.contentLength ?? params.media.byteLength;
  if (measuredBytes > env.MAX_WHATSAPP_AUDIO_SIZE_BYTES) {
    return {
      status: "TOO_LARGE",
      transcript: null,
      normalizedText: null,
      fallbackMessage: DEFAULT_AUDIO_LIMIT_MESSAGE,
      debugReason: `too_large:${measuredBytes}`,
    };
  }

  let lastFailure: AudioTranscriptionResult | null = null;
  const attempts = Math.max(1, env.AUDIO_TRANSCRIPTION_MAX_RETRIES + 1);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const transcript = await withTimeout(
        params.transcribe(params.media.base64, mimeType),
        env.AUDIO_TRANSCRIPTION_TIMEOUT_MS,
      );

      if (transcript.durationSeconds && transcript.durationSeconds > env.MAX_WHATSAPP_AUDIO_DURATION_SECONDS) {
        return {
          status: "TOO_LONG",
          transcript,
          normalizedText: buildNormalizedTranscript(transcript.text),
          fallbackMessage: "La nota de voz es demasiado larga para procesarla completa. Â¿Puedes enviarla mas corta o escribirme el pedido?",
          debugReason: `too_long:${transcript.durationSeconds}`,
        };
      }

      if (!transcript.ok || !transcript.text?.trim()) {
        lastFailure = transcript;
        if (transcript.errorCode === "EMPTY") {
          return {
            status: "EMPTY_TRANSCRIPT",
            transcript,
            normalizedText: null,
            fallbackMessage: DEFAULT_AUDIO_FAILURE_MESSAGE,
            debugReason: "empty_transcript",
          };
        }
        if (!transcript.retryable || attempt === attempts) {
          return {
            status: "TRANSCRIPTION_FAILED",
            transcript,
            normalizedText: null,
            fallbackMessage: DEFAULT_AUDIO_FAILURE_MESSAGE,
            debugReason: transcript.errorCode ?? "provider_error",
          };
        }
      } else {
        return {
          status: "READY",
          transcript,
          normalizedText: buildNormalizedTranscript(transcript.text),
          fallbackMessage: null,
          debugReason: null,
        };
      }
    } catch (error) {
      logger.warn({ err: error, attempt }, "Transcripcion de audio fallo en este intento");
      lastFailure = {
        ok: false,
        text: null,
        language: null,
        durationSeconds: null,
        provider: env.AI_PROVIDER,
        retryable: attempt < attempts,
        errorCode: String(error).includes("timeout:") ? "TIMEOUT" : "PROVIDER_ERROR",
      };
      if (attempt === attempts) {
        return {
          status: "TRANSCRIPTION_FAILED",
          transcript: lastFailure,
          normalizedText: null,
          fallbackMessage: DEFAULT_AUDIO_FAILURE_MESSAGE,
          debugReason: lastFailure.errorCode,
        };
      }
    }
  }

  return {
    status: "TRANSCRIPTION_FAILED",
    transcript: lastFailure,
    normalizedText: null,
    fallbackMessage: DEFAULT_AUDIO_FAILURE_MESSAGE,
    debugReason: lastFailure?.errorCode ?? "provider_error",
  };
}
