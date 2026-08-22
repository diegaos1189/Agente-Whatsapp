# Quickstart — cliente nuevo en minutos

Pensado para llevar este proyecto en una memoria USB (o repo git) a la maquina de un cliente nuevo y dejarlo funcionando rapido.

## Con Claude Code (recomendado)

1. Copia esta carpeta completa a la maquina (USB, git clone, lo que sea).
2. Abre una terminal ahi y corre `claude` (Claude Code).
3. Dile: **"configura esto para [nombre del negocio]"** — Claude Code lee `CLAUDE.md` y sigue el proceso solo: instala dependencias, levanta la base de datos, corre el wizard de configuracion, y te va pidiendo los datos que falten (nombre del negocio, telefono, horario, API key de IA, etc).
4. Cuando termine, entra a `http://localhost:3000/products` y carga el menu real del cliente.

## Manual (sin Claude Code)

```bash
npm install -g pnpm          # si no lo tienes
pnpm install
docker compose -f infra/docker-compose.yml up -d postgres
pnpm run prisma:generate
pnpm run prisma:migrate -- --name init
pnpm run setup                # wizard: pide datos del negocio y arma los .env
pnpm run dev:api               # terminal 1
pnpm run dev:admin             # terminal 2
```

Luego entra a `http://localhost:3000` para cargar productos, categorias y promociones desde el panel.

## Requisitos en la maquina nueva

- Node.js 20+ (https://nodejs.org)
- Docker Desktop (para Postgres local sin instalar nada mas) — o un Postgres accesible por red
- Una API key de IA: Gemini gratis en https://aistudio.google.com/apikey, u OpenAI en https://platform.openai.com

## Para WhatsApp real (no solo pruebas)

Ver `docs/WHATSAPP_SETUP.md`. Resumen: crear app en developers.facebook.com, sacar Phone Number ID + token, exponer el backend con un tunel (Docker/Railway es mas estable que ngrok/cloudflared para esto) y configurar el webhook.
