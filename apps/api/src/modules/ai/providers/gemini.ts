import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../../../config/env.js";
import { logger } from "../../../utils/logger.js";
import { toGeminiSchema, type NeutralSchema } from "../schema.js";
import type { AudioTranscriptionResult } from "../aiClient.js";

const client = new GoogleGenerativeAI(env.GEMINI_API_KEY);

export async function callGeminiJson(params: {
  instructions: string;
  input: string;
  schemaName: string;
  schema: NeutralSchema;
}): Promise<string | null> {
  try {
    const model = client.getGenerativeModel({
      model: env.GEMINI_MODEL,
      systemInstruction: params.instructions,
      generationConfig: {
        responseMimeType: "application/json",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        responseSchema: toGeminiSchema(params.schema) as any,
      },
    });
    const result = await model.generateContent(params.input);
    return result.response.text() ?? null;
  } catch (error) {
    logger.error({ err: error, schemaName: params.schemaName }, "Fallo llamada Gemini (json)");
    return null;
  }
}

export async function callGeminiText(params: {
  instructions: string;
  input: string;
  maxOutputTokens?: number;
}): Promise<string | null> {
  try {
    const model = client.getGenerativeModel({
      model: env.GEMINI_MODEL,
      systemInstruction: params.instructions,
      generationConfig: { maxOutputTokens: params.maxOutputTokens ?? 300 },
    });
    const result = await model.generateContent(params.input);
    return result.response.text()?.trim() ?? null;
  } catch (error) {
    logger.error({ err: error }, "Fallo llamada Gemini (texto)");
    return null;
  }
}

export async function transcribeGeminiAudio(base64: string, mimeType: string): Promise<AudioTranscriptionResult> {
  try {
    const model = client.getGenerativeModel({ model: env.GEMINI_MODEL });
    const result = await model.generateContent([
      { inlineData: { data: base64, mimeType } },
      { text: "Transcribe este audio a texto plano en espanol. Responde solo con la transcripcion, sin comentarios." },
    ]);
    const text = result.response.text()?.trim() || null;
    return {
      ok: Boolean(text),
      text,
      language: null,
      durationSeconds: null,
      provider: "gemini",
      retryable: false,
      errorCode: text ? null : "EMPTY",
    };
  } catch (error) {
    logger.error({ err: error }, "Fallo transcribiendo audio con Gemini");
    return {
      ok: false,
      text: null,
      language: null,
      durationSeconds: null,
      provider: "gemini",
      retryable: true,
      errorCode: "PROVIDER_ERROR",
    };
  }
}

export async function describeGeminiImage(params: {
  base64: string;
  mimeType: string;
  instructions: string;
}): Promise<string | null> {
  try {
    const model = client.getGenerativeModel({ model: env.GEMINI_MODEL, systemInstruction: params.instructions });
    const result = await model.generateContent([{ inlineData: { data: params.base64, mimeType: params.mimeType } }]);
    return result.response.text()?.trim() ?? null;
  } catch (error) {
    logger.error({ err: error }, "Fallo describiendo imagen con Gemini");
    return null;
  }
}
