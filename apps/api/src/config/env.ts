import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  ADMIN_API_TOKEN: z.string().min(1, "ADMIN_API_TOKEN requerido"),
  // Credenciales del primer usuario ADMIN del panel, creado automaticamente al arrancar
  // si la tabla admin_users esta vacia. Despues de eso, gestionar usuarios desde /users.
  ADMIN_BOOTSTRAP_USERNAME: z.string().default("master"),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().default("1234"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL requerido"),
  // Backup automatico diario de la base de datos (pg_dump). Requiere el binario pg_dump
  // disponible en el PATH del servidor (ya incluido en el Dockerfile de produccion). En
  // desarrollo local sin postgresql-client instalado, simplemente loguea el error y sigue.
  // z.coerce.boolean() haria Boolean("false") === true (bug), por eso se compara el string.
  BACKUP_ENABLED: z.preprocess((v) => (typeof v === "string" ? v !== "false" && v !== "0" : v), z.boolean()).default(true),
  BACKUP_DIR: z.string().default("./backups"),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(14),

  AI_PROVIDER: z.enum(["openai", "gemini"]).default("gemini"),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL: z.string().default("gemini-2.0-flash"),
  AUDIO_TRANSCRIPTION_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  AUDIO_TRANSCRIPTION_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),
  MAX_WHATSAPP_AUDIO_SIZE_BYTES: z.coerce.number().int().positive().default(16 * 1024 * 1024),
  MAX_WHATSAPP_AUDIO_DURATION_SECONDS: z.coerce.number().int().positive().default(300),
  ALLOWED_WHATSAPP_AUDIO_MIME_TYPES: z
    .string()
    .default("audio/ogg,audio/opus,audio/mpeg,audio/mp4,audio/aac,audio/amr"),
  WHATSAPP_MEDIA_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),

  WHATSAPP_PROVIDER: z.enum(["mock", "meta"]).default("mock"),
  WHATSAPP_API_VERSION: z.string().default("v21.0"),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(""),
  WHATSAPP_TOKEN: z.string().optional().default(""),
  WHATSAPP_VERIFY_TOKEN: z.string().default("change-me-verify-token"),
  // Clave secreta de la app de Meta. Si se configura, se verifica la firma HMAC de cada
  // webhook entrante (header X-Hub-Signature-256) para confirmar que realmente viene de
  // Meta y no de un tercero que adivino la URL. Ver docs/WHATSAPP_SETUP.md.
  WHATSAPP_APP_SECRET: z.string().optional().default(""),

  N8N_WEBHOOK_URL_ORDER_CREATED: z.string().optional().default(""),
  N8N_WEBHOOK_URL_PAYMENT_REMINDER: z.string().optional().default(""),
  N8N_WEBHOOK_URL_OPERATOR_NOTIFICATION: z.string().optional().default(""),
  N8N_WEBHOOK_URL_HANDOFF: z.string().optional().default(""),
  PAYMENT_DEFAULT_PROVIDER: z.string().default("MANUAL"),
  PAYMENT_MOCK_WEBHOOK_SECRET: z.string().default("change-me-payment-webhook-secret"),
  PAYMENT_MOCK_BASE_URL: z.string().default("https://mock-payments.local"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Variables de entorno invalidas:", parsed.error.flatten().fieldErrors);
  throw new Error("Configuracion de entorno invalida. Revisa tu archivo .env contra .env.example");
}

export const env = parsed.data;
const insecureProductionValues: string[] = [];

if (env.AI_PROVIDER === "gemini" && !env.GEMINI_API_KEY) {
  throw new Error("AI_PROVIDER=gemini requiere GEMINI_API_KEY en .env");
}
if (env.AI_PROVIDER === "openai" && !env.OPENAI_API_KEY) {
  throw new Error("AI_PROVIDER=openai requiere OPENAI_API_KEY en .env");
}

if (env.NODE_ENV === "production") {
  if (env.ADMIN_API_TOKEN === "change-me-admin-token") {
    insecureProductionValues.push("ADMIN_API_TOKEN");
  }
  if (env.ADMIN_BOOTSTRAP_PASSWORD === "1234") {
    insecureProductionValues.push("ADMIN_BOOTSTRAP_PASSWORD");
  }
  if (env.WHATSAPP_VERIFY_TOKEN === "change-me-verify-token") {
    insecureProductionValues.push("WHATSAPP_VERIFY_TOKEN");
  }
  if (env.PAYMENT_MOCK_WEBHOOK_SECRET === "change-me-payment-webhook-secret") {
    insecureProductionValues.push("PAYMENT_MOCK_WEBHOOK_SECRET");
  }
  if (insecureProductionValues.length > 0) {
    throw new Error(
      `Produccion no puede iniciar con valores inseguros por defecto: ${insecureProductionValues.join(", ")}`,
    );
  }
}

export const isProduction = env.NODE_ENV === "production";
