import { env } from "../../config/env.js";
import type { NeutralSchema } from "./schema.js";
import { callOpenAiJson, callOpenAiText, transcribeOpenAiAudio, describeOpenAiImage } from "./providers/openai.js";
import { callGeminiJson, callGeminiText, transcribeGeminiAudio, describeGeminiImage } from "./providers/gemini.js";

interface JsonCallParams {
  instructions: string;
  input: string;
  schemaName: string;
  schema: NeutralSchema;
}

/** Llama al motor de IA configurado (AI_PROVIDER) pidiendo salida forzada a un schema. */
export async function callAiJson(params: JsonCallParams): Promise<string | null> {
  return env.AI_PROVIDER === "gemini" ? callGeminiJson(params) : callOpenAiJson(params);
}

interface TextCallParams {
  instructions: string;
  input: string;
  maxOutputTokens?: number;
}

export interface AudioTranscriptionResult {
  ok: boolean;
  text: string | null;
  language: string | null;
  durationSeconds: number | null;
  provider: "openai" | "gemini";
  retryable: boolean;
  errorCode: "PROVIDER_ERROR" | "TIMEOUT" | "EMPTY" | null;
}

/** Llamada de texto libre al motor de IA configurado. */
export async function callAiText(params: TextCallParams): Promise<string | null> {
  return env.AI_PROVIDER === "gemini" ? callGeminiText(params) : callOpenAiText(params);
}

/** Transcribe un audio (base64) usando el motor de IA configurado. */
export async function transcribeAudio(base64: string, mimeType: string): Promise<AudioTranscriptionResult> {
  return env.AI_PROVIDER === "gemini"
    ? transcribeGeminiAudio(base64, mimeType)
    : transcribeOpenAiAudio(base64, mimeType);
}

/** Describe/analiza una imagen (base64) segun las instrucciones dadas, usando el motor de IA configurado. */
export async function describeImage(params: {
  base64: string;
  mimeType: string;
  instructions: string;
}): Promise<string | null> {
  return env.AI_PROVIDER === "gemini" ? describeGeminiImage(params) : describeOpenAiImage(params);
}
