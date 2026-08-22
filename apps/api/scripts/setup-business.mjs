#!/usr/bin/env node
// Wizard interactivo de configuracion rapida: pregunta los datos minimos del
// negocio, escribe apps/api/.env y apps/admin/.env, y crea/actualiza la fila
// de business_settings en la base de datos. Pensado para dejar un cliente
// nuevo (restaurante, pizzeria, hamburgueseria, etc) listo en minutos.
import { createInterface } from "node:readline/promises";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(__dirname, "..");
const adminDir = path.resolve(apiDir, "..", "admin");

const rl = createInterface({ input: process.stdin, output: process.stdout });

async function ask(question, defaultValue) {
  const suffix = defaultValue !== undefined && defaultValue !== "" ? ` (${defaultValue})` : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || defaultValue || "";
}

async function askYesNo(question, defaultYes) {
  const suffix = defaultYes ? "S/n" : "s/N";
  const answer = (await rl.question(`${question} (${suffix}): `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === "s" || answer === "si" || answer === "y" || answer === "yes";
}

function randomToken() {
  return randomBytes(24).toString("hex");
}

function readEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const content = readFileSync(filePath, "utf-8");
  const env = {};
  for (const line of content.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

function writeEnvFile(filePath, values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  writeFileSync(filePath, lines.join("\n") + "\n");
}

async function main() {
  console.log("\n=== Setup rapido del negocio (WhatsApp Agent) ===\n");

  // --- 1. Motor de IA ---
  const aiProvider = (await ask("Proveedor de IA (gemini/openai)", "gemini")).toLowerCase();
  let geminiKey = "";
  let openaiKey = "";
  if (aiProvider === "openai") {
    openaiKey = await ask("OPENAI_API_KEY (platform.openai.com/account/api-keys)", "");
  } else {
    geminiKey = await ask("GEMINI_API_KEY (aistudio.google.com/apikey)", "");
  }

  // --- 2. Datos del negocio ---
  const restaurantName = await ask("Nombre del negocio", "Mi Restaurante");
  const phone = await ask("Telefono de contacto", "");
  const address = await ask("Direccion", "");
  const currency = (await ask("Moneda (codigo ISO, ej: COP, MXN, USD)", "COP")).toUpperCase();
  const timezone = await ask("Zona horaria (IANA, ej: America/Bogota)", "America/Bogota");
  const deliveryFee = Number(await ask("Costo de domicilio (0 si no aplica)", "0")) || 0;
  const estimatedPrepMinutes = Number(await ask("Tiempo estimado de preparacion (minutos)", "30")) || 30;
  const acceptsScheduledOrders = await askYesNo("¿Acepta pedidos programados fuera de horario?", true);

  console.log("\nHorario de atencion:");
  const sameEveryDay = await askYesNo("¿Mismo horario todos los dias?", true);
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const openingHours = {};
  if (sameEveryDay) {
    const open = await ask("Hora de apertura (HH:MM)", "11:00");
    const close = await ask("Hora de cierre (HH:MM)", "22:00");
    for (const day of days) openingHours[day] = { open, close };
  } else {
    for (const day of days) {
      const isOpenDay = await askYesNo(`¿Abre el ${day}?`, true);
      if (!isOpenDay) {
        openingHours[day] = null;
        continue;
      }
      const open = await ask(`  Hora de apertura ${day}`, "11:00");
      const close = await ask(`  Hora de cierre ${day}`, "22:00");
      openingHours[day] = { open, close };
    }
  }

  const assistantTone = await ask(
    "Personalidad/tono del asistente",
    "Anfitrion virtual del negocio: atencion rapida, amable y personalizada. Ayuda a conocer el menu, recomienda segun gustos, resuelve dudas y gestiona pedidos con calidez y profesionalismo. Prioriza la satisfaccion del cliente, responde con claridad y nunca inventa informacion.",
  );

  const welcomeMessage = await ask(
    "Mensaje de bienvenida",
    `¡Hola! Bienvenido a ${restaurantName} 👋 ¿En que te ayudo hoy? Puedo mostrarte el menu, tomar tu pedido o contarte nuestras promociones.`,
  );
  const outOfHoursMessage = await ask(
    "Mensaje fuera de horario",
    `Gracias por escribirnos. Nuestro horario de atencion es de ${openingHours.mon?.open ?? "11:00"} a ${openingHours.mon?.close ?? "22:00"}. Puedes dejar tu pedido y lo procesamos apenas abramos.`,
  );

  // --- 3. Panel admin ---
  const existingApiEnv = readEnvFile(path.join(apiDir, ".env"));
  const adminApiToken = existingApiEnv.ADMIN_API_TOKEN && existingApiEnv.ADMIN_API_TOKEN !== "change-me-admin-token"
    ? existingApiEnv.ADMIN_API_TOKEN
    : randomToken();

  // --- 4. Escribir .env ---
  if (!existsSync(path.join(apiDir, ".env.example"))) {
    console.error("No se encontro apps/api/.env.example. Corre este script desde el repo completo.");
    process.exit(1);
  }

  const apiEnv = {
    NODE_ENV: "development",
    PORT: "4000",
    LOG_LEVEL: "info",
    CORS_ORIGIN: "http://localhost:3000",
    ADMIN_API_TOKEN: adminApiToken,
    DATABASE_URL: existingApiEnv.DATABASE_URL || "postgresql://pollos:pollos@localhost:5434/negocio?schema=public",
    AI_PROVIDER: aiProvider === "openai" ? "openai" : "gemini",
    GEMINI_API_KEY: geminiKey || existingApiEnv.GEMINI_API_KEY || "",
    GEMINI_MODEL: existingApiEnv.GEMINI_MODEL || "gemini-2.0-flash",
    OPENAI_API_KEY: openaiKey || existingApiEnv.OPENAI_API_KEY || "",
    OPENAI_MODEL: existingApiEnv.OPENAI_MODEL || "gpt-4o-mini",
    WHATSAPP_PROVIDER: existingApiEnv.WHATSAPP_PROVIDER || "mock",
    WHATSAPP_API_VERSION: existingApiEnv.WHATSAPP_API_VERSION || "v21.0",
    WHATSAPP_PHONE_NUMBER_ID: existingApiEnv.WHATSAPP_PHONE_NUMBER_ID || "",
    WHATSAPP_TOKEN: existingApiEnv.WHATSAPP_TOKEN || "",
    WHATSAPP_VERIFY_TOKEN: existingApiEnv.WHATSAPP_VERIFY_TOKEN || randomToken().slice(0, 24),
    N8N_WEBHOOK_URL_ORDER_CREATED: existingApiEnv.N8N_WEBHOOK_URL_ORDER_CREATED || "",
    N8N_WEBHOOK_URL_PAYMENT_REMINDER: existingApiEnv.N8N_WEBHOOK_URL_PAYMENT_REMINDER || "",
    N8N_WEBHOOK_URL_OPERATOR_NOTIFICATION: existingApiEnv.N8N_WEBHOOK_URL_OPERATOR_NOTIFICATION || "",
    N8N_WEBHOOK_URL_HANDOFF: existingApiEnv.N8N_WEBHOOK_URL_HANDOFF || "",
  };
  writeEnvFile(path.join(apiDir, ".env"), apiEnv);
  console.log(`\n✔ Escrito ${path.join(apiDir, ".env")}`);

  const adminEnv = {
    API_BASE_URL: "http://localhost:4000",
    ADMIN_API_TOKEN: adminApiToken,
  };
  writeEnvFile(path.join(adminDir, ".env"), adminEnv);
  console.log(`✔ Escrito ${path.join(adminDir, ".env")}`);

  // --- 5. Guardar en base de datos ---
  console.log("\nConectando a la base de datos para guardar la configuracion...");
  process.env.DATABASE_URL = apiEnv.DATABASE_URL;
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const existing = await prisma.businessSettings.findFirst();
    const data = {
      restaurantName,
      phone,
      address,
      currency,
      timezone,
      openingHours,
      deliveryFee,
      estimatedPrepMinutes,
      acceptsScheduledOrders,
      outOfHoursMessage,
      welcomeMessage,
      assistantTone,
    };

    if (existing) {
      await prisma.businessSettings.update({ where: { id: existing.id }, data });
      console.log("✔ business_settings actualizado.");
    } else {
      await prisma.businessSettings.create({ data });
      console.log("✔ business_settings creado.");
    }
  } catch (error) {
    console.error("\n⚠ No se pudo guardar en la base de datos:", error.message);
    console.error("Verifica que Postgres este corriendo y las migraciones aplicadas (pnpm run prisma:migrate),");
    console.error("luego corre de nuevo: pnpm run setup");
  } finally {
    await prisma.$disconnect();
  }

  console.log("\n=== Listo ===");
  console.log("Siguientes pasos:");
  console.log("  1. pnpm run prisma:generate && pnpm run prisma:migrate   (si es la primera vez)");
  console.log("  2. pnpm run dev:api");
  console.log("  3. pnpm run dev:admin");
  console.log("  4. Entra a http://localhost:3000/products para cargar categorias y productos.\n");

  rl.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
