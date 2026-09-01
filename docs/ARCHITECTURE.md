# Arquitectura - Pollos El Corralito WhatsApp Agent

## Vision general

```
WhatsApp Cliente
      |
      v
Meta Cloud API  --webhook-->  apps/api (Fastify)
                                   |
                    +--------------+---------------+
                    |              |                |
              modules/ai     modules/orders    modules/conversation
              (OpenAI)       modules/products  (orquestador + state machine)
                    |              |
                    +------ Postgres (Prisma) ------+
                                   |
                              modules/n8n --webhook--> n8n (automatizaciones)
                                   |
                        apps/admin (Next.js) <--REST-- apps/api
```

## Monorepo

- `apps/api` — backend Fastify + TypeScript + Prisma. Toda la logica de negocio y el agente.
- `apps/admin` — panel administrativo Next.js (App Router). Server Components leen la API con el token admin server-side; las mutaciones pasan por un proxy interno (`/api/proxy/*`) para no exponer el token al navegador.
- `packages/shared` — enums, DTOs y contratos de payloads (incluido el contrato de n8n) compartidos entre api y admin.
- `infra/docker-compose.yml` — Postgres, api, admin y n8n para levantar todo con un comando.

## Capa de IA (`apps/api/src/modules/ai`)

Soporta **Gemini** (default) u **OpenAI**, elegible con `AI_PROVIDER` en `.env`. `aiClient.ts` despacha a `providers/gemini.ts` o `providers/openai.ts` segun corresponda; ambos implementan la misma interfaz (`callAiJson`, `callAiText`). Los schemas de extraccion estructurada se definen una sola vez en formato neutral (`schema.ts`) y se convierten al formato que pide cada proveedor (OpenAI usa `type: ["string","null"]` para nullable, Gemini usa `nullable: true` con tipos en mayuscula) — asi no hay que duplicar los schemas por proveedor.

Separada en 3 responsabilidades:

1. **intentClassifier.ts** — clasifica el ultimo mensaje en una intencion cerrada (enum `Intent`), con salida forzada a JSON Schema. Fallback a `UNKNOWN` si la llamada falla o la respuesta no valida contra el schema (Zod).
2. **entityExtractor.ts** — extrae entidades estructuradas (producto, cantidad, direccion, barrio, metodo de pago, nombre, etc). Mismo patron de JSON Schema + validacion Zod + fallback seguro (todo null).
3. **responseGenerator.ts** — genera el texto final en espanol. Recibe una lista de **"hechos"** ya verificados (precios y datos que vienen de la base de datos) y, opcionalmente, la unica pregunta a hacer. El modelo NO decide que datos existen, solo los redacta de forma natural.

### Guardrails (`guardrails.ts`)

Anti-alucinacion: despues de generar la respuesta, se extraen los montos de dinero mencionados en el texto y se comparan contra los montos permitidos (derivados automaticamente de los "hechos" que se le dieron al modelo). Si el modelo menciona un monto que no estaba en los hechos, se descarta toda la respuesta y se usa un mensaje de fallback seguro en vez de arriesgar un precio inventado. Tambien se trunca cualquier respuesta anormalmente larga.

Esta separacion (reglas de negocio deciden los hechos → IA solo redacta) es la defensa principal contra alucinaciones, mas fuerte que solo confiar en el prompt.

## Orquestador de conversacion (`modules/conversation`)

- `conversationService.ts` — punto de entrada `handleIncomingMessage`. Resuelve contacto/conversacion, guarda mensajes, corta camino rapido para palabras clave de escalamiento humano, corre horario de atencion, corre intent+entity extraction, y despacha a la logica correspondiente.
- `orderFlow.ts` — maquina de estados **pura** (sin I/O) para la toma de pedido: `decideOrderFlow(input) -> decision`. Esto la hace facil de testear (ver `tests/orderFlow.test.ts`) sin mockear DB ni OpenAI.
- El contexto de cada conversacion (paso actual, carrito, direccion, metodo de pago) se persiste en `conversations.context` (JSON) para sobrevivir reinicios del proceso.

### Contador de intentos fallidos y escalamiento

Cada conversacion tiene `failedAttempts`. Se incrementa cuando el turno no logra avanzar (intent `UNKNOWN`, o el flujo de pedido vuelve a preguntar lo mismo sin nueva informacion). Al llegar a 2 sin resolverse, se escala automaticamente a un humano (`handoffReason = LOW_CONFIDENCE`). Tambien se escala inmediato ante palabras clave (asesor/humano/persona/queja/reclamo) o intent `COMPLAINT`/`HUMAN_HANDOFF`.

Mientras `conversation.isHandoff = true`, el bot no vuelve a responder automaticamente — la conversacion se ve en el panel admin para que un humano continue. Se resuelve con el boton "Marcar como resuelta" en el panel.

## Modelo de datos (Prisma)

Ver `apps/api/prisma/schema.prisma`. Decisiones relevantes:

- **Montos en enteros** (COP no usa decimales en la practica). `price`, `total`, `deliveryFee` son `Int`.
- `orders.status` es un string libre validado por el enum compartido `OrderStatus`, no un enum nativo de Postgres, para poder agregar estados sin migracion destructiva.
- `business_settings` tiene una fila por restaurante (`restaurantId` unico) con toda la configuracion editable desde el panel: horario (`openingHours` JSON por dia), costo de domicilio, tiempo estimado, mensajes de bienvenida/fuera de horario. Nada de esto esta hardcodeado en el codigo del agente.

## Multi-tenant (en curso, por fases)

El sistema nacio single-tenant: una base de datos por cliente, un deployment por restaurante.
`platform_restaurants` era solo un directorio de clientes. Se esta migrando a que una sola base
atienda a varios restaurantes, por fases, para no mover las ~220 queries de golpe.

**Como se resuelve el restaurante de un request** (`modules/platform/restaurantContext.ts`):
el panel manda el header `x-restaurant-id` cuando el usuario abre `/<slug>/...`; sin header se
asume `local-deployment`, el restaurante que ya corria en este deployment. Ese default es lo que
mantiene funcionando sin cambios el panel de siempre (`/products`, `/settings`) y el bot de
WhatsApp, que todavia no sabe a que restaurante corresponde cada numero.

| Fase | Alcance | Estado |
| --- | --- | --- |
| 1 | `business_settings`, `categories`, `products` acotados por `restaurantId`. Panel `/<slug>/products` y `/<slug>/settings`. | Hecho |
| 2 | Pedidos y cocina (`orders`, `order_items`, `payments`). | Pendiente |
| 3 | Conversaciones, contactos y ruteo del webhook por numero de WhatsApp -> restaurante. | Pendiente |
| 4 | Usuarios y sesion atada a un restaurante (hoy el panel `/<slug>` es solo ADMIN de la plataforma). | Pendiente |

Consecuencias mientras las fases 2-4 no esten:

- En el panel `/<slug>` solo Productos y Configuracion son links reales; las demas secciones se
  muestran marcadas como "Pronto" a proposito, porque sus datos siguen siendo los del
  restaurante local y linkearlas mostraria pedidos y conversaciones de otro negocio.
- `promotions` y `product_recommendations` cuelgan de productos pero todavia no tienen
  `restaurantId` propio: no estan expuestas en el panel por restaurante.
- El bot atiende unicamente al restaurante local, sin importar cuantos haya dados de alta.
- Las caches de catalogo y configuracion estan indexadas por restaurante (`Map`), no globales:
  con una sola entrada, un negocio veria los datos de otro durante los 30s de TTL.

## Simplificaciones conocidas del MVP (documentadas, no accidentales)

- **Pedidos programados fuera de horario**: si `acceptsScheduledOrders=true`, el flujo de pedido continua fuera de horario, pero el MVP no calcula automaticamente la proxima hora de apertura para `scheduledFor`; queda como nota para el equipo. Extender esto es agregar el calculo de "siguiente horario abierto" en `businessHoursService`.
- **Match de productos**: `findBestProductMatch` usa overlap de palabras normalizado (sin acentos). Funciona bien para un catalogo chico tipo restaurante; con catalogos grandes conviene mover a busqueda vectorial o full-text de Postgres.
- **Confirmacion de pago por transferencia**: el cliente manda una foto, el sistema la marca como `REPORTED` y notifica al operador via n8n; la confirmacion final (`CONFIRMED`) la hace un humano desde el panel o desde n8n, no hay integracion con una pasarela bancaria real (el negocio pidio pago manual, no pasarela).
- **Audio/imagen**: el pipeline esta preparado (branch por `type` en `conversationService`) pero solo imagen (como comprobante de pago) tiene logica real; audio responde pidiendo texto. Agregar transcripcion (ej. Whisper) es agregar un paso antes de `handleTextMessage`.
