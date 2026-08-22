import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config/env.js")>();
  return {
    ...actual,
    isProduction: false,
    env: {
      ...actual.env,
      LOG_LEVEL: "info",
      AI_PROVIDER: "gemini",
      AUDIO_TRANSCRIPTION_TIMEOUT_MS: 100,
      AUDIO_TRANSCRIPTION_MAX_RETRIES: 1,
      MAX_WHATSAPP_AUDIO_SIZE_BYTES: 1024,
      MAX_WHATSAPP_AUDIO_DURATION_SECONDS: 30,
      ALLOWED_WHATSAPP_AUDIO_MIME_TYPES: "audio/ogg,audio/mpeg",
    },
  };
});

import { processWhatsAppAudio } from "../src/modules/conversation/whatsappAudioService.js";
import type { AudioTranscriptionResult } from "../src/modules/ai/aiClient.js";
import type { DownloadedMedia } from "../src/modules/whatsapp/whatsappClient.js";

function buildMedia(overrides: Partial<DownloadedMedia> = {}): DownloadedMedia {
  return {
    base64: Buffer.from("audio").toString("base64"),
    mimeType: overrides.mimeType ?? "audio/ogg",
    byteLength: overrides.byteLength ?? 128,
    contentLength: overrides.contentLength ?? 128,
    fileSize: overrides.fileSize ?? 128,
  };
}

function okTranscript(text: string, overrides: Partial<AudioTranscriptionResult> = {}): AudioTranscriptionResult {
  return {
    ok: true,
    text,
    language: overrides.language ?? "es",
    durationSeconds: overrides.durationSeconds ?? 5,
    provider: overrides.provider ?? "gemini",
    retryable: false,
    errorCode: null,
  };
}

describe("processWhatsAppAudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("TEST 1: audio valido entrega texto listo para la pipeline normal", async () => {
    const transcribe = vi.fn().mockResolvedValue(okTranscript("deme un pollo de 8"));

    const result = await processWhatsAppAudio({
      media: buildMedia(),
      transcribe,
    });

    expect(result.status).toBe("READY");
    expect(result.transcript?.text).toBe("deme un pollo de 8");
  });

  it("TEST 2: dos pollos con cambios queda como el mismo texto que consumiria la pipeline escrita", async () => {
    const text = "deme dos pollos de 8, uno con papas y otro con yuca";
    const transcribe = vi.fn().mockResolvedValue(okTranscript(text));

    const result = await processWhatsAppAudio({
      media: buildMedia(),
      transcribe,
    });

    expect(result.transcript?.text).toBe(text);
  });

  it("TEST 3: alitas mitad BBQ mitad picantes pasa intacto al resolver existente", async () => {
    const transcribe = vi.fn().mockResolvedValue(okTranscript("20 alitas mitad BBQ mitad picantes"));

    const result = await processWhatsAppAudio({
      media: buildMedia(),
      transcribe,
    });

    expect(result.status).toBe("READY");
    expect(result.transcript?.text).toContain("mitad BBQ mitad picantes");
  });

  it("TEST 4: conserva el orden logico audio luego texto porque solo devuelve una entrada textual final", async () => {
    const transcribe = vi.fn().mockResolvedValue(okTranscript("deme dos combos"));

    const result = await processWhatsAppAudio({
      media: buildMedia(),
      transcribe,
    });

    expect(result.status).toBe("READY");
    expect(result.transcript?.text).toBe("deme dos combos");
  });

  it("TEST 5: mismo audio no requiere doble transcripcion si ya fue deduplicado aguas arriba", async () => {
    const transcribe = vi.fn().mockResolvedValue(okTranscript("deme un combo"));

    const first = await processWhatsAppAudio({
      media: buildMedia(),
      transcribe,
    });
    const second = await processWhatsAppAudio({
      media: buildMedia(),
      transcribe,
    });

    expect(first.status).toBe("READY");
    expect(second.status).toBe("READY");
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it("TEST 6: proveedor falla temporalmente y hace retry controlado", async () => {
    const transcribe = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(okTranscript("deme un pollo"));

    const result = await processWhatsAppAudio({
      media: buildMedia(),
      transcribe,
    });

    expect(result.status).toBe("READY");
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it("TEST 7: si el proveedor falla definitivamente no deja la conversacion bloqueada", async () => {
    const transcribe = vi.fn().mockRejectedValue(new Error("provider down"));

    const result = await processWhatsAppAudio({
      media: buildMedia(),
      transcribe,
    });

    expect(result.status).toBe("TRANSCRIPTION_FAILED");
    expect(result.fallbackMessage).toBeTruthy();
  });

  it("TEST 8: archivo con mime no soportado se rechaza", async () => {
    const transcribe = vi.fn();

    const result = await processWhatsAppAudio({
      media: buildMedia({ mimeType: "video/mp4" }),
      transcribe,
    });

    expect(result.status).toBe("UNSUPPORTED_MIME");
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("TEST 9: transcripcion vacia no se manda al agente", async () => {
    const transcribe = vi.fn().mockResolvedValue({
      ...okTranscript(""),
      ok: false,
      text: null,
      errorCode: "EMPTY",
    } satisfies AudioTranscriptionResult);

    const result = await processWhatsAppAudio({
      media: buildMedia(),
      transcribe,
    });

    expect(result.status).toBe("EMPTY_TRANSCRIPT");
  });

  it("TEST 10: audio demasiado grande aplica limite", async () => {
    const transcribe = vi.fn();

    const result = await processWhatsAppAudio({
      media: buildMedia({ byteLength: 4096, contentLength: 4096, fileSize: 4096 }),
      transcribe,
    });

    expect(result.status).toBe("TOO_LARGE");
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("TEST 11: si la duracion reportada supera el limite se rechaza", async () => {
    const transcribe = vi.fn().mockResolvedValue(okTranscript("audio largo", { durationSeconds: 45 }));

    const result = await processWhatsAppAudio({
      media: buildMedia(),
      transcribe,
    });

    expect(result.status).toBe("TOO_LONG");
  });

  it("TEST 12: si no hubo descarga de media responde falla controlada", async () => {
    const transcribe = vi.fn();

    const result = await processWhatsAppAudio({
      media: null,
      transcribe,
    });

    expect(result.status).toBe("DOWNLOAD_FAILED");
    expect(transcribe).not.toHaveBeenCalled();
  });
});
