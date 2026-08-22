import OpenAI, { toFile } from "openai";
import { env } from "../../../config/env.js";
import { logger } from "../../../utils/logger.js";
import { toOpenAiJsonSchema, type NeutralSchema } from "../schema.js";
import type { AudioTranscriptionResult } from "../aiClient.js";

const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export async function callOpenAiJson(params: {
  instructions: string;
  input: string;
  schemaName: string;
  schema: NeutralSchema;
}): Promise<string | null> {
  try {
    const response = await client.responses.create({
      model: env.OPENAI_MODEL,
      instructions: params.instructions,
      input: params.input,
      text: {
        format: {
          type: "json_schema",
          name: params.schemaName,
          schema: toOpenAiJsonSchema(params.schema),
          strict: true,
        },
      },
    });
    return response.output_text ?? null;
  } catch (error) {
    logger.error({ err: error, schemaName: params.schemaName }, "Fallo llamada OpenAI (json)");
    return null;
  }
}

export async function callOpenAiText(params: {
  instructions: string;
  input: string;
  maxOutputTokens?: number;
}): Promise<string | null> {
  try {
    const response = await client.responses.create({
      model: env.OPENAI_MODEL,
      instructions: params.instructions,
      input: params.input,
      max_output_tokens: params.maxOutputTokens ?? 300,
    });
    return response.output_text?.trim() ?? null;
  } catch (error) {
    logger.error({ err: error }, "Fallo llamada OpenAI (texto)");
    return null;
  }
}

export async function transcribeOpenAiAudio(base64: string, mimeType: string): Promise<AudioTranscriptionResult> {
  try {
    const buffer = Buffer.from(base64, "base64");
    const extension = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp3") ? "mp3" : "m4a";
    const file = await toFile(buffer, `audio.${extension}`, { type: mimeType });
    const result = await client.audio.transcriptions.create({ file, model: "whisper-1", response_format: "verbose_json" });
    const text = result.text?.trim() || null;
    return {
      ok: Boolean(text),
      text,
      language: "language" in result && typeof result.language === "string" ? result.language : null,
      durationSeconds: "duration" in result && typeof result.duration === "number" ? result.duration : null,
      provider: "openai",
      retryable: false,
      errorCode: text ? null : "EMPTY",
    };
  } catch (error) {
    logger.error({ err: error }, "Fallo transcribiendo audio con OpenAI Whisper");
    return {
      ok: false,
      text: null,
      language: null,
      durationSeconds: null,
      provider: "openai",
      retryable: true,
      errorCode: "PROVIDER_ERROR",
    };
  }
}

export async function describeOpenAiImage(params: {
  base64: string;
  mimeType: string;
  instructions: string;
}): Promise<string | null> {
  try {
    const response = await client.responses.create({
      model: env.OPENAI_MODEL,
      instructions: params.instructions,
      input: [
        {
          role: "user",
          content: [
            { type: "input_image", image_url: `data:${params.mimeType};base64,${params.base64}`, detail: "auto" },
          ],
        },
      ],
      max_output_tokens: 300,
    });
    return response.output_text?.trim() ?? null;
  } catch (error) {
    logger.error({ err: error }, "Fallo describiendo imagen con OpenAI");
    return null;
  }
}
