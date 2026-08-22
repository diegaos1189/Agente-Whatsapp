# Instrucciones para Claude Code en este proyecto

Este repo es una **plantilla reutilizable** de agente de WhatsApp + CRM + POS para negocios de comida (restaurantes, pizzerias, hamburgueserias, y similares). No es codigo especifico de un solo cliente — el objetivo es poder llevarlo a un cliente nuevo y dejarlo configurado en minutos.

## Si el usuario pide "configurar esto para un negocio nuevo" / "setup rapido"

Sigue este orden, sin saltarte pasos:

1. Verifica requisitos: `node -v` (20+), `pnpm -v` (si no esta, `npm install -g pnpm`), Docker Desktop corriendo (si van a usar Postgres local en contenedor).
2. `pnpm install` en la raiz del repo.
3. Levanta Postgres: `docker compose -f infra/docker-compose.yml up -d postgres` (si el puerto 5432 ya esta ocupado por otro Postgres del sistema, cambia el mapeo de puerto en `infra/docker-compose.yml` y `DATABASE_URL` a otro puerto libre, ej 5434 — revisa con `Get-NetTCPConnection -LocalPort 5432` en PowerShell si hay dudas).
4. `pnpm run prisma:generate` y `pnpm run prisma:migrate -- --name init` (crea las tablas).
5. Corre el wizard interactivo: `pnpm run setup` — pregunta datos del negocio (nombre, telefono, direccion, horario, moneda, mensajes) y escribe `apps/api/.env` + `apps/admin/.env` automaticamente, ademas de guardar la config en la base de datos. Este es el paso clave para "configurar en minutos": no edites `.env` a mano si el wizard ya cubre el campo.
6. Pide la API key de IA al usuario si no la tiene (Gemini gratis en aistudio.google.com/apikey, o OpenAI en platform.openai.com) y pegala cuando el wizard la pida.
7. `pnpm run dev:api` y `pnpm run dev:admin` en terminales separadas.
8. Dirige al usuario a `http://localhost:3000/products` para cargar su menu real (categorias + productos + precios) y a `/settings` si necesita ajustar algo que el wizard no cubrio.
9. Para WhatsApp real: sigue `docs/WHATSAPP_SETUP.md`. El modo `mock` (default) sirve para probar todo el flujo sin numero real via `curl` al webhook (ejemplo en `README.md`).

## Limitacion conocida de Windows + exFAT

Si el proyecto vive en una unidad exFAT (comun en discos externos/USB formateados para compatibilidad Mac+Windows), dos cosas rompen y ya estan resueltas — no las repitas ni las "arregles" de nuevo:
- `pnpm install` normal fallaria por symlinks no soportados — ya esta resuelto via `pnpm-workspace.yaml` (`nodeLinker: hoisted`, `symlink: false`) y `scripts/sync-shared.mjs` que copia `@pollos/shared` a mano en cada build.
- `next build` (produccion) de `apps/admin` falla con `EISDIR` por symlinks internos del paquete `next` — no tiene arreglo de configuracion. `next dev` (desarrollo) SI funciona normal. Para build de produccion en esta unidad, usar Docker (`pnpm run docker:up`, corre dentro de Linux) o mover el proyecto a una unidad NTFS.

Si detectas que el proyecto esta en una unidad exFAT (revisa con `fsutil fsinfo drivetype <letra>:` en PowerShell) y algo de esto vuelve a fallar, no reinventes la solucion: revisa `pnpm-workspace.yaml`, `.npmrc` y `scripts/sync-shared.mjs` primero.

## Generalidad del sistema — no reintroducir cosas especificas de un negocio

Este proyecto empezo como demo para "Pollos El Corralito" (pollo frito/asado) y se generalizo despues. Reglas para mantenerlo generico:
- El enum `Intent` en `packages/shared/src/enums.ts` usa `ORDER_PRODUCT` generico, no intents por tipo de comida (nunca vuelvas a agregar `ORDER_PIZZA`, `ORDER_BURGER`, etc — el tipo de producto es texto libre que se resuelve contra el catalogo real en `productService.ts`).
- Los prompts de IA (`modules/ai/*.ts`) reciben `businessName` como parametro y nunca deben mencionar un tipo de comida especifico en las instrucciones fijas.
- Los montos siempre se formatean con `formatCurrency(amount, settings.currency)` (`utils/currency.ts`), nunca hardcodear COP/$ en texto.
- Todo dato de negocio (nombre, horario, menu, precios, promociones, mensajes) vive en la base de datos (`business_settings`, `categories`, `products`, `promotions`), editable desde el panel admin o el wizard — nunca hardcodear datos de un restaurante especifico fuera de `prisma/seed.ts` (que es solo data de EJEMPLO para desarrollar, no para clientes reales).

## Estructura del proyecto

Ver `docs/ARCHITECTURE.md` para el detalle completo. Resumen: `apps/api` (backend Fastify+Prisma+IA), `apps/admin` (panel Next.js), `packages/shared` (tipos compartidos), `infra/docker-compose.yml` (Postgres+api+admin+n8n).
