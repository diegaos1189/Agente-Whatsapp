# Agente de WhatsApp + CRM + POS para negocios de comida

Plantilla reutilizable de agente de ventas y atencion por WhatsApp para restaurantes, pizzerias, hamburgueserias y negocios de comida en general: menu, toma de pedidos, seguimiento, pagos manuales, escalamiento a humano, CRM basico (conversaciones + pedidos) y panel administrativo. Nada esta hardcodeado a un negocio especifico — todo (menu, precios, horario, mensajes) se carga por panel o por el wizard de setup.

> ¿Vas a configurar esto para un cliente nuevo en minutos? Ve directo a **[QUICKSTART.md](QUICKSTART.md)**.
>
> `apps/api/prisma/seed.ts` trae datos de ejemplo de "Pollos El Corralito" solo para tener algo con que probar en desarrollo — bórralos/reemplázalos con datos reales del cliente (panel admin o `pnpm run setup`).

## Stack

- **Backend**: Node.js + TypeScript + Fastify + Prisma + PostgreSQL
- **IA**: Google Gemini u OpenAI (elegible por variable de entorno `AI_PROVIDER`, default Gemini) — clasificacion de intencion, extraccion de entidades y generacion de respuesta separadas, con guardrails anti-alucinacion
- **Mensajeria**: WhatsApp Cloud API (Meta) — con adaptador mock para desarrollar sin numero real
- **Automatizaciones**: n8n (webhooks salientes, contrato documentado)
- **Panel admin**: Next.js
- **Infra**: Docker / docker-compose, pensado para desplegar en Railway

## Estructura

```
apps/
  api/       backend Fastify (agente, REST, webhook WhatsApp)
  admin/     panel administrativo Next.js
packages/
  shared/    enums, DTOs y contratos compartidos (incluye contrato n8n)
infra/
  docker-compose.yml
docs/
  ARCHITECTURE.md
  WHATSAPP_SETUP.md
  N8N_INTEGRATION.md
```

## Requisitos

- Node.js 20+
- pnpm (`npm install -g pnpm`) — el monorepo usa pnpm workspaces, no npm/yarn
- Docker (opcional pero recomendado para Postgres/n8n)
- Una API key de OpenAI

> Nota: si tu proyecto vive en una unidad **exFAT** (comun en discos externos), los symlinks de node_modules fallan. Este repo ya trae `pnpm-workspace.yaml` con `nodeLinker: hoisted` y `symlink: false` para evitarlo, mas un script (`scripts/sync-shared.mjs`) que copia `packages/shared` a mano en vez de symlinkearlo. Con esto, `apps/api` corre perfecto en exFAT.
>
> `apps/admin` (Next.js) es otra historia: el propio paquete `next` trae symlinks internos en su distribucion (para compatibilidad con Pages Router) que **exFAT no puede representar**, asi que `next build` / `next dev` fallan con `EISDIR` directo en una unidad exFAT — esto no tiene workaround a nivel de pnpm, es una limitacion del filesystem. Dos salidas:
> 1. Corre `apps/admin` (o todo el repo) desde una unidad NTFS.
> 2. Usa Docker (`pnpm run docker:up`): el contenedor de `admin` compila dentro de Linux, no en el filesystem de Windows, asi que el problema no aplica ahi.

## Puesta en marcha (desarrollo local)

### 1. Instalar dependencias

```bash
pnpm install
```

### 2. Variables de entorno

```bash
cp apps/api/.env.example apps/api/.env
cp apps/admin/.env.example apps/admin/.env
```

Edita `apps/api/.env`:
- `AI_PROVIDER` — `gemini` (default) u `openai`.
- `GEMINI_API_KEY` — obligatorio si usas Gemini. Consiguela gratis en https://aistudio.google.com/apikey
- `OPENAI_API_KEY` — obligatorio solo si cambias `AI_PROVIDER=openai`.
- `ADMIN_API_TOKEN` — inventa un valor, debe coincidir con el mismo campo en `apps/admin/.env`.
- Deja `WHATSAPP_PROVIDER=mock` para probar todo el flujo sin numero real (ver `docs/WHATSAPP_SETUP.md` para pasar a numero real).

## Cargar los datos de tu negocio

Todo el catalogo, precios, promociones y datos de la empresa se cargan desde el panel admin (`http://localhost:3000`), nunca hardcodeados en el codigo:
- **Productos**: crea categorias y productos con precio/descripcion/disponibilidad, o edita/elimina los existentes.
- **Promociones**: crea promos y activa/desactivala con un check.
- **Configuracion**: nombre del negocio, telefono, direccion, horario por dia (JSON), costo de domicilio, tiempo estimado de preparacion, mensaje de bienvenida y mensaje fuera de horario.

El seed (`pnpm run prisma:seed`) solo carga datos de ejemplo para desarrollar — bórralos o edítalos desde el panel cuando tengas los datos reales.

### 3. Base de datos

Con Docker (recomendado):

```bash
docker compose -f infra/docker-compose.yml up -d postgres
```

O apunta `DATABASE_URL` en `apps/api/.env` a tu propio Postgres.

Luego, generar cliente Prisma, migrar y poblar datos de ejemplo:

```bash
pnpm run prisma:generate
pnpm run prisma:migrate -- --name init
pnpm run prisma:seed
```

Esto crea el negocio "Pollos El Corralito" con menu, categorias y promociones de ejemplo.

### 4. Levantar backend y panel

```bash
pnpm run dev:api      # http://localhost:4000
pnpm run dev:admin    # http://localhost:3000
```

### 5. Probar el bot sin WhatsApp real

Con `WHATSAPP_PROVIDER=mock`, puedes simular un mensaje entrante llamando directo al webhook:

```bash
curl -X POST http://localhost:4000/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{
    "entry": [{
      "changes": [{
        "value": {
          "contacts": [{ "profile": { "name": "Juan Perez" }, "wa_id": "573001112233" }],
          "messages": [{ "from": "573001112233", "id": "wamid.test1", "timestamp": "1710000000", "type": "text", "text": { "body": "hola, quiero ver el menu" } }]
        }
      }]
    }]
  }'
```

Revisa los logs de `pnpm run dev:api` — ahi se ve la "respuesta" del bot (modo mock no llama a Meta, solo loguea y guarda en base de datos). Tambien puedes ver la conversacion en el panel admin (`/conversations`).

## Panel administrativo

`http://localhost:3000` — Conversaciones (con escalamiento a humano), Pedidos (cambiar estado), Productos (editar precio/disponibilidad), Configuracion (horario, mensajes, costo de domicilio).

## Tests

```bash
pnpm run test
```

Cubre la maquina de estados de toma de pedido, los guardrails anti-alucinacion y el chequeo de horario de atencion (los tres puntos con logica de negocio mas riesgosa).

## Todo con Docker

```bash
pnpm run docker:up
```

Levanta Postgres, api, admin y n8n. Antes de esto, crea `apps/api/.env` y `apps/admin/.env` (docker-compose los usa via `env_file`).

## Siguientes pasos sugeridos (fuera de este MVP)

- Migrar de `mock` a numero real de WhatsApp (`docs/WHATSAPP_SETUP.md`).
- Crear los workflows en n8n usando los contratos de `docs/N8N_INTEGRATION.md`.
- Pasarela de pago online (el MVP solo soporta efectivo/transferencia/tarjeta contraentrega, confirmados manualmente).
- Multi-sucursal (el modelo actual asume un solo local).
