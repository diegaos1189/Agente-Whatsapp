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

## Multi-tenant

El sistema nacio single-tenant: una base de datos por cliente, un deployment por restaurante.
`platform_restaurants` era solo un directorio de clientes. Hoy una sola base atiende a varios
restaurantes: cada uno con su catalogo, su configuracion, sus pedidos, sus chats y sus usuarios.

**Tres cortes distintos resuelven el restaurante de un request** (`modules/platform/restaurantContext.ts`):

1. **El panel** manda el header `x-restaurant-id` con el restaurante que el usuario abrio
   (`/<slug>/orders`). Sin header se asume `local-deployment`, el restaurante que ya corria en
   este deployment — ese default es lo que mantiene el panel de la raiz (`/products`, `/orders`)
   funcionando igual que siempre.
2. **El usuario** manda `x-admin-restaurant-id`, derivado de la cookie de sesion firmada. Si el
   usuario pertenece a un restaurante, ese gana sobre el header del punto 1 y un header que
   apunte a otro se rechaza con 403. El header del navegador nunca alcanza por si solo.
3. **El bot** resuelve el restaurante por el `phone_number_id` del payload de Meta: el numero
   que recibio el mensaje dice de que negocio es el chat. Cada restaurante guarda sus propias
   credenciales de WhatsApp en Configuracion y responde con las suyas.

| Fase | Alcance | Estado |
| --- | --- | --- |
| 1 | `business_settings`, `categories`, `products` acotados por `restaurantId`. | Hecho |
| 2 | `contacts`, `conversations`, `orders`, `promotions`, `faqs`, `product_recommendations`; ruteo del webhook por numero; usuarios atados a un restaurante; las 12 secciones del panel `/<slug>`. | Hecho |

Detalles que conviene tener presentes al tocar esto:

- **El contacto es por (restaurante, telefono)**, no por telefono: el mismo celular que le
  escribe a dos negocios de la plataforma son dos clientes distintos, con historiales separados.
- **`BusinessSettingsDTO` lleva `restaurantId` adentro.** El objeto `settings` ya viajaba por
  todo el flujo del bot, asi que es lo que permite que cada paso (catalogo, precios, promociones,
  envio) sepa a quien atiende sin pasar el id a mano por cada firma. Al agregar un paso nuevo,
  usar `settings.restaurantId` en vez de agregar otro parametro.
- **`productService` no tiene defaults.** `listCatalog`, `resolveProductReference`,
  `getEffectivePrice` y compañia exigen `restaurantId`: la idea es que el compilador marque una
  fuga en vez de que caiga al restaurante local en silencio.
- **Los schedulers recorren restaurante por restaurante** (archivo diario, alertas operativas,
  recuperacion de carrito, reactivacion), cada uno con su hora y su zona horaria. Las marcas de
  "ya corrio hoy" son `Map` por restaurante, no variables sueltas.
- **Las caches de catalogo y configuracion estan indexadas por restaurante** (`Map`): con una
  sola entrada, un negocio veria los datos de otro durante los 30s de TTL.
- **Pagos, handoffs y eventos de pedido no llevan `restaurantId` propio**: se acotan por su
  pedido o su conversacion, que si lo tienen.
- **Una sola copia de cada pantalla.** Cada seccion del panel vive en `(dashboard)/<seccion>/View.tsx`
  y recibe `restaurantId` + `basePath`; `page.tsx` (raiz) y `[restaurantSlug]/<seccion>/page.tsx`
  son envoltorios de tres lineas sobre esa vista.
- **Los nombres de seccion son slugs reservados** (`orders`, `metrics`, ...): el middleware corre
  en Edge y no puede consultar la base, asi que decide si el primer segmento de la URL es una
  seccion o un slug comparandolo contra la lista fija `PANEL_SECTIONS`. `uniqueSlug()` en la API
  respeta la misma lista.

El aislamiento esta cubierto por dos tests de regresion que corren las queries reales contra un
prisma en memoria: `catalogTenantIsolation.test.ts` (catalogo) y `operationsTenantIsolation.test.ts`
(pedidos, conversaciones, FAQs y el corte por usuario).

## Simplificaciones conocidas del MVP (documentadas, no accidentales)

- **Pedidos programados fuera de horario**: si `acceptsScheduledOrders=true`, el flujo de pedido continua fuera de horario, pero el MVP no calcula automaticamente la proxima hora de apertura para `scheduledFor`; queda como nota para el equipo. Extender esto es agregar el calculo de "siguiente horario abierto" en `businessHoursService`.
- **Match de productos**: `findBestProductMatch` usa overlap de palabras normalizado (sin acentos). Funciona bien para un catalogo chico tipo restaurante; con catalogos grandes conviene mover a busqueda vectorial o full-text de Postgres.
- **Confirmacion de pago por transferencia**: el cliente manda una foto, el sistema la marca como `REPORTED` y notifica al operador via n8n; la confirmacion final (`CONFIRMED`) la hace un humano desde el panel o desde n8n, no hay integracion con una pasarela bancaria real (el negocio pidio pago manual, no pasarela).
- **Audio/imagen**: el pipeline esta preparado (branch por `type` en `conversationService`) pero solo imagen (como comprobante de pago) tiene logica real; audio responde pidiendo texto. Agregar transcripcion (ej. Whisper) es agregar un paso antes de `handleTextMessage`.
