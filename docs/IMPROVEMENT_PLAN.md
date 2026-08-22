# Plan De Mejoras

Fecha del plan: August 21, 2026

## BUG CONOCIDO #2 — respuesta con saludo de "cliente recurrente" concatenada al fallback de guardrail (reportado 2026-08-22)

Estado: ABIERTO. Diagnosticado por Claude (sesion paralela), no arreglado — se evita tocar
`conversationService.ts` en paralelo mientras Codex sigue trabajando ahi.

Sintoma (reproducido en produccion, screenshot real de WhatsApp): cliente recurrente (ya
tiene pedidos previos y nombre guardado) manda "hola" y el bot responde en una sola burbuja:

```
Disculpa, no logre confirmar ese dato con certeza. ¿Me lo repites de otra forma? Si
prefieres, escribe *asesor* y te atiende una persona del equipo.

1. Ver el estado de mi pedido
2. Hacer un nuevo pedido
3. Ver el menu
4. Otra cosa (escribeme libremente)
```

Causa raiz CONFIRMADA — `apps/api/src/modules/conversation/conversationService.ts:1330-1347`
(rama de saludo para cliente recurrente, dentro de `handleTextMessage`'s flujo de sesion nueva):

```ts
const greeting = await generateResponse({
  facts: [
    `El cliente se llama ${contact.name} y ya nos ha pedido antes.`,
    `Su ultimo pedido (${lastOrder.code}) quedo en estado: ${statusLabel}.`,
  ],
  askNext: null,
  businessName: settings.restaurantName,
  tone: settings.assistantTone,
  allowGreeting: true,
});
message = `${greeting}\n\n1. Ver el estado de mi pedido\n2. Hacer un nuevo pedido\n3. Ver el menu\n4. Otra cosa (escribeme libremente)`;
```

`facts` aqui NO contiene ningun monto de dinero (solo nombre, codigo de pedido y estado), asi
que `allowedAmounts` en `responseGenerator.ts` (`extractMoneyLikeNumbers(factsBlock + askNext)`)
queda vacio. Si el modelo, al redactar el saludo, menciona cualquier numero que la regex de
`extractMoneyLikeNumbers` interprete como monto (ej: parte del codigo de pedido, o simplemente
frasea algo con digitos agrupados), `applyGuardrails` lo bloquea y `generateResponse` devuelve
`SAFE_FALLBACK_MESSAGE` en vez del saludo real — y la linea de arriba concatena el menu numerado
IGUAL, sin verificar si `greeting` termino siendo el fallback. Resultado: el cliente ve el
mensaje de error pegado al menu, en vez de un saludo normal.

Arreglo sugerido:
1. En `responseGenerator.ts`, que `applyGuardrails`/`generateResponse` puedan señalar de alguna
   forma (ej. un flag `wasModified` ya existe en `GuardrailResult` pero no se propaga hacia
   afuera de `generateResponse`) que el guardrail reemplazo el texto — y que el llamador en
   `conversationService.ts:1346` no concatene el menu numerado si `greeting` termino siendo
   igual a `SAFE_FALLBACK_MESSAGE` (comparar el texto, o exponer el flag).
2. Revisar por que el modelo esta generando un numero que dispara el guardrail en un saludo
   sin montos reales — probablemente basta con ese fix, pero vale la pena loggear
   `mentionedAmounts` en este caso especifico para confirmar que numero exacto se esta colando.

### Bug relacionado (mismo reporte, no confirmado con la misma profundidad)

En la misma sesion de prueba, el cliente escribio despues "menu" (texto libre, no numero) y
volvio a recibir SOLO `SAFE_FALLBACK_MESSAGE` (sin el menu numerado esta vez — indica que este
si paso por `buildMenuReply()`, no por la rama de arriba). Revisando `buildMenuReply`
(`conversationService.ts` ~linea 2639) los `facts` SI incluyen los precios reales via
`formatCurrency`, y `allowedAmounts` se deriva de esos mismos `facts`, asi que en teoria deberia
calzar siempre — no se encontro la causa exacta en este pase. Sugerencia: loggear
`mentionedAmounts` vs `allowedAmounts` cuando `applyGuardrails` bloquea una respuesta (por
ahora solo loggea un `warn` generico) para ver en logs reales de Railway que numero especifico
no calzo la proxima vez que se reproduzca.

### Nota aparte (no es un bug, es limpieza pendiente)

`conversationService.ts` tiene dos funciones casi identicas: `handleTextMessageLegacy` (linea
~1789) y `handleTextMessage` (linea ~2159). Solo `handleTextMessage` esta conectada (se llama
desde `handleIncomingMessage`/audio) — `handleTextMessageLegacy` parece codigo muerto de un
refactor anterior. Confirmar y borrarla si en efecto no se usa en ningun lado, para que no
haya que mantener dos copias de esta logica en paralelo.

## BUG CONOCIDO #1 — condicion de carrera que duplicaba el saludo (RESUELTO 2026-08-22)

Estado: RESUELTO por Codex — ver `apps/api/tests/conversationServiceLeaseRace.test.ts`.

Sintoma (reproducido en produccion, screenshot real de WhatsApp): un cliente manda dos
mensajes reales casi seguidos (ej: "ola" y luego "hola" segundos despues, sesion nueva) y el
bot responde el saludo de bienvenida **dos veces**, una por cada mensaje del cliente — deberia
responder una sola vez (el segundo mensaje deberia caer en la conversacion ya creada por el
primero, con `isNewSession=false`).

Sospecha de causa raiz — `apps/api/src/modules/conversation/contactMessageProcessingCoordinator.ts`:

- `handleIncomingMessage()` en `conversationService.ts` hace `enqueueIncomingMessage()` y
  luego siempre llama `drainIncomingMessages()`, sin importar si el enqueue fue exitoso.
- `drainIncomingMessages()` usa `withLease({ waitForLease: false })` — si otro webhook ya
  tiene el lease del mismo `contactId`, esta llamada **no espera ni reintenta**, simplemente
  no hace nada (`return null`) y el mensaje recien encolado queda pendiente de que el drain
  que SI tiene el lease lo recoja en su propio loop antes de soltar.
- En teoria esto deberia bastar (el drain que gano el lease deberia procesar ambos mensajes
  en orden dentro de su mismo `while(true)`, y el segundo deberia ver `isNewSession=false`
  porque `getOrCreateActiveConversation()` ya encontraria la conversacion creada por el
  primero) — pero en produccion se ve el saludo duplicado, asi que hay algun timing/caso no
  cubierto (posible: dos webhooks de WhatsApp llegando lo bastante separados en el tiempo
  como para que el primer drain ya haya salido del `while` (cola vacia, lease liberado) justo
  antes de que el segundo mensaje termine de encolarse, y el segundo webhook tampoco logre
  tomar el lease a tiempo por algun otro motivo — o algo especifico del `ContactLeaseStore`
  basado en Postgres que no se ve solo leyendo el codigo).
- `apps/api/tests/contactMessageProcessingCoordinator.test.ts` (7 tests) no cubre
  especificamente este escenario: dos mensajes REALES distintos del mismo contacto,
  llegando casi simultaneos, sesion nueva — verificar que el saludo de bienvenida
  (`isNewSession`) se dispare una sola vez.

Sugerencia: agregar un test de integracion que dispare `handleIncomingMessage()` dos veces en
paralelo (`Promise.all`) para el mismo `contactId` con `waMessageId` distintos y una
conversacion nueva, y verificar que solo se cree una conversacion y se mande un solo mensaje
de bienvenida. Luego ajustar `drainIncomingMessages`/`withLease` hasta que el test pase.

## Objetivo

Mejorar el agente existente de forma incremental, sin reemplazar stack, sin reescritura completa y sin cambios destructivos.

## Principios

- Mantener Fastify + Prisma + Next.js.
- Hacer cambios backward-compatible.
- Pasar verdad de negocio a backend y base de datos, no al prompt.
- Priorizar confiabilidad antes que sofisticacion.
- Agregar tests antes de tocar comportamientos de riesgo.

## P0 Critico

### 1. Idempotencia persistente para mensajes entrantes de WhatsApp

Estado: DONE

Problema:

- La deduplicacion actual es solo en memoria.
- Un reinicio o una segunda instancia puede reprocesar el mismo mensaje.

Codigo actual:

- `apps/api/src/routes/whatsapp.webhook.ts:33`

Direccion recomendada:

- Persistir `waMessageId` procesados en base de datos con unique constraint.
- Rechazar duplicados antes de cualquier logica de negocio.
- Mantener el cache en memoria solo como optimizacion opcional.

Impacto:

- Evita respuestas duplicadas y pedidos duplicados en retries, reinicios y multi-instancia.

### 2. Serializacion durable de conversacion

Estado: DONE

Problema:

- La cola por telefono solo protege una instancia.

Codigo actual:

- `apps/api/src/modules/conversation/conversationService.ts:571`

Direccion recomendada:

- Agregar lock transaccional o versionado optimista por conversacion/contacto.
- Serializar por `conversationId` o `contactId`.

Impacto:

- Evita perdida o corrupcion de contexto con mensajes rapidos del cliente.

### 3. Carrito estructurado y contexto preciso del pedido

Estado: DONE

Problema:

- El carrito provisional vivia en `conversations.context.orderFlow.cart` como lineas simples.
- No existia referencia individual por item.
- Cambios como "al segundo quitele la ensalada", "deme otro igual" o "cambieme la gaseosa por Colombiana" dependian demasiado del historial libre.

Codigo actual:

- `apps/api/src/modules/conversation/conversationService.ts`
- `apps/api/src/modules/conversation/structuredCart.ts`
- `apps/api/src/routes/conversations.ts`

Direccion aplicada:

- Se mejoro la estructura persistente ya existente en `conversations.context` en vez de crear un subsistema paralelo.
- Se agrego `activeCart` estructurado con items individualizables, componentes incluidos/agregados y `lastReferencedItemId`.
- El backend ahora aplica operaciones estructuradas sobre ese carrito para duplicar items, quitar componentes, agregar extras, reemplazar bebidas y ajustar cantidades.
- `orderFlow.cart` queda como snapshot derivado/compatible para resumenes, confirmacion y creacion final del pedido.

Impacto:

- El pedido activo deja de depender principalmente del historial textual.
- Las referencias por item sobreviven multiples mensajes y reinicios porque siguen persistidas en backend.
- El flujo conserva compatibilidad con confirmacion, handoff humano, idempotencia y serializacion durable.

### 4. Servicio explicito de calculo de carrito

Estado: DONE

Problema:

- El total hoy sale del flujo de pedido y de `orderService`, pero no existe aun un borde claro tipo `calculateCart()`.

Codigo actual:

- `apps/api/src/modules/conversation/orderFlow.ts`
- `apps/api/src/modules/orders/orderService.ts`

Direccion recomendada:

- Crear un servicio backend que retorne:
  - subtotal
  - discount
  - deliveryFee
  - tax
  - total

Direccion aplicada:

- Se consolido el calculo en `apps/api/src/modules/orders/pricingService.ts`.
- El backend ahora revalida y recalcula precios antes de confirmar y antes de crear/corregir pedidos.
- El flujo conversacional usa hechos monetarios ya calculados por backend para que la IA no haga matematicas.
- Se cubrieron escenarios de descuentos, delivery, cambios de precio, productos inexistentes y modificadores incompatibles con tests unitarios.

Impacto:

- Un solo origen de verdad para totales, promociones y futuras reglas.

### 5. Validacion fuerte de disponibilidad y combinaciones invalidas

Estado: DONE

Problema:

- La disponibilidad esta bien encaminada, pero combos y modificadores aun no tienen validacion estructurada.

Direccion recomendada:

- Validar cada linea antes de confirmar y antes de crear pedido.
- Rechazar combinaciones que no existan en catalogo real.

Direccion aplicada:

- Se agrego validacion final estructurada de checkout en `apps/api/src/modules/orders/checkoutService.ts`.
- El flujo de confirmacion ahora genera un snapshot backend con version, fingerprint y confirmationId.
- La confirmacion explicita revalida antes de crear la orden y rechaza resumenes obsoletos.
- La creacion final usa idempotencia persistida en `orders.confirmationId`.
- Se agregaron reglas configurables de delivery: `acceptsDelivery`, `acceptsPickup`, `minimumDeliveryOrder` y `deliveryCoverageKeywords`.

Impacto:

- Menos pedidos errados y menos correcciones manuales.

### 6. Aislamiento de errores y fallback seguro al cliente

Problema:

- Ya hay fallbacks utiles, pero falta estandarizarlos mejor para IA, DB y proveedor.

Direccion recomendada:

- Centralizar respuestas seguras para:
  - error IA
  - error DB
  - error WhatsApp provider
  - error inesperado al crear pedido
- Escalar a humano automaticamente si hay fallos repetidos.

Impacto:

- Mejor resiliencia real en produccion.

## P1 Importante

### 1. Modificadores estructurados y edicion por item

Estado: PARTIAL / PHASE 1 DONE

Problema:

- Casos como "uno sin ensalada", "cambieme el segundo", "10 BBQ y 10 picantes" aun no tienen modelo fuerte.

Direccion recomendada:

- Agregar grupos de modificadores y persistencia por item.
- Permitir referenciar una linea concreta del carrito.

Direccion aplicada en esta fase:

- Se agrego resolucion avanzada de productos/modificadores desde backend con estados `MATCHED`, `AMBIGUOUS` y `NOT_FOUND`.
- `searchKeywords` se reutiliza como base de aliases persistentes del catalogo, con normalizacion de texto, numeros escritos y tolerancia limitada a typos.
- El carrito estructurado ahora reutiliza el mismo resolvedor para cambios como "cambie papas por yuca", "pongale BBQ" y rechaza referencias demasiado ambiguas o componentes no validos.
- Se agrego soporte backend para interpretar distribuciones de sabores tipo "mitad BBQ mitad picantes" y "10 BBQ y 10 picantes" como base para el siguiente endurecimiento de modificadores.

### 2. Sistema de aliases de producto

Estado: DONE

Problema:

- `searchKeywords` ayuda, pero sigue siendo un campo libre unico.

Codigo actual:

- `apps/api/src/modules/products/productService.ts:247`

Direccion recomendada:

- Evolucionar a aliases normalizados por producto/variante.
- Mantener `searchKeywords` mientras se migra.

Direccion aplicada:

- Se mantuvo `searchKeywords` como almacenamiento persistente backward-compatible.
- El backend ahora deriva aliases adicionales desde `unitCount`, nombre del producto, banderas como `isCombo` y variantes frecuentes ("el familiar", "pollo de 8", "combo de 8", etc.).
- La IA ya no selecciona productos por intuicion: interpreta lenguaje natural y el backend resuelve contra catalogo real.

### 4. Cobertura de domicilio y seleccion de sede

Problema:

- La tarifa es plana y no hay cobertura real.

Direccion recomendada:

- Agregar zonas de entrega.
- Validar cobertura antes de confirmar.
- Preparar asignacion de sede si el negocio lo necesita.

### 5. Repetir pedido anterior

Problema:

- Existe consulta del ultimo pedido, pero no flujo seguro de reorder.

Direccion recomendada:

- Cargar lineas anteriores.
- Revalidar disponibilidad.
- Recalcular con precios y promos actuales.
- Pedir confirmacion otra vez.

Estado: DONE

Direccion aplicada:

- Se agrego consulta estructurada de historial por `contactId` en `orderService`.
- El backend ahora reconstruye un carrito NUEVO desde un pedido historico, sin reutilizar `orderId` ni confirmar automaticamente.
- Cada item historico se resuelve contra catalogo actual y sus notas/modificadores se revalidan sobre el carrito estructurado actual.
- El flujo reutiliza `pricingService` y `checkoutService` para recalcular precios, promociones, delivery y confirmacion con valores vigentes.
- Si ya existe un carrito activo, el bot no lo sobrescribe: pide confirmacion explicita antes de reemplazarlo.
- "Lo de siempre" no se resuelve automaticamente si los pedidos recientes son ambiguos.

### 6. HUMAN -> BOT controlado

Estado: DONE

- BOT -> HUMAN ya esta bien.
- Falta endurecer el retorno controlado a BOT para evitar silencio del bot o reactivaciones accidentales.

Direccion aplicada:

- Se formalizo el ciclo `ACTIVE -> WAITING_HUMAN -> HUMAN -> ACTIVE/CLOSED`.
- La conversacion ahora puede tener ownership humano explicito (`assignedAdminUserId`, `takenAt`) sin reemplazar el handoff existente.

### 7. Estado, seguimiento y consulta de pedidos

Estado: DONE

Problema:

- El agente ya respondia estado, pero solo consultaba el ultimo pedido del contacto.
- No resolvia varios pedidos activos.
- No preservaba referencia estructurada del pedido consultado.
- No diferenciaba claramente `READY` de `ON_THE_WAY`.
- No hacia handoff automatico ante demora evidente o inconsistencia `DELIVERED` vs "no me llego".

Direccion aplicada:

- Se agrego `orderStatusService` para resolver el pedido correcto desde backend con scope por `contactId`.
- Si hay un solo pedido activo se resuelve automaticamente; si hay varios, pide aclaracion sin asumir.
- Si el cliente menciona un codigo real (`POL-...`), la consulta sigue estando restringida al mismo contacto.
- Se guarda `lastReferencedOrderId` / `lastReferencedOrderCode` dentro del contexto conversacional para follow-ups como "¿y ahora?" o "¿ya salio?".
- `ASK_ETA` y `ORDER_STATUS` ahora reutilizan la misma consulta backend; audio sigue entrando por la misma pipeline textual ya endurecida.
- Se agrego traduccion deterministica de estados internos a mensajes naturales para cliente.
- Se endurecio el endpoint admin de cambio de estado para bloquear transiciones invalidas obvias.

Impacto:

- El bot deja de responder seguimiento desde "ultimo pedido" o memoria vieja.
- Baja el riesgo de mezclar pedidos distintos del mismo cliente.
- Se mejora soporte operativo ante demoras e inconsistencias de entrega.
- El bot revalida ownership/estado antes de enviar mensajes automaticos para evitar carreras BOT/HUMANO.
- El panel ahora distingue "Esperando" de "En atencion" y permite tomar/devolver al bot.

## P2 Recomendable

### 1. Mejoras de audio

Estado: DONE

Direccion aplicada:

- Se mantuvo una sola logica de negocio: `Audio -> Transcription -> handleTextMessage(...)`.
- Se formalizo validacion de MIME, tamano, timeout y retry limitado antes de llamar al agente.
- La descarga sigue usando el cliente oficial actual de WhatsApp/Meta, con timeout configurable.
- La transcripcion ahora deja metadata estructurada en `messages.raw` para trazabilidad.
- Los fallos de audio liberan correctamente la serializacion y responden con fallback controlado en vez de dejar la conversacion bloqueada.

### 2. Recuperacion inteligente de carritos abandonados

Estado: DONE

Problema:

- El carrito podia quedar vivo en `conversations.context`, pero no existia una recuperacion durable y conservadora.
- No habia una decision backend deterministica para saber si correspondia recordar un pedido incompleto.
- Tampoco habia proteccion persistente contra doble envio en multi-instancia.

Direccion aplicada:

- Se agrego `CartRecovery` como registro durable del intento de recuperacion, con fingerprint del carrito, hora programada, ultimo mensaje del cliente, intentos y lease persistente.
- Se extendio `BusinessSettings` con configuracion conservadora por deployment: `cartRecoveryEnabled`, `cartRecoveryDelayMinutes`, `cartRecoveryMaxAttempts` y `cartRecoveryMessage`.
- Se implemento `canSendCartRecovery()` en backend para decidir elegibilidad sin depender de la IA.
- El scheduler reutiliza la infraestructura actual del proceso y usa claim durable en base de datos para que dos workers no envien el mismo recordatorio.
- El bot solo envia un mensaje si sigue existiendo carrito real, no hay pedido creado, la conversacion no esta en handoff humano, no existe opt-out y la ventana tecnica de WhatsApp sigue abierta.
- Cuando el cliente responde, el backend retoma el carrito real desde `conversations.context`, revalida catalogo, pricing, promociones y delivery antes de continuar o confirmar.
- Se registran eventos `CART_ABANDONED`, `RECOVERY_NOT_ELIGIBLE`, `RECOVERY_SENT`, `RECOVERY_REPLIED`, `RECOVERY_CANCELLED` y `RECOVERY_CONVERTED` para analitica futura.

Impacto:

- Se habilita una recuperacion prudente, medible y segura para produccion.
- Se evita spam, se respeta handoff humano y se protege el sistema ante carreras de concurrencia.
- El pedido recuperado vuelve a entrar por el flujo seguro de pricing y checkout actual.

### 2. Upselling y cross-selling inteligente

Estado: DONE

Problema:

- El bot no sugeria adicionales durante el pedido (ej: bebida con el pollo, papas con las
  alitas) mas alla de una recomendacion reactiva ("recomiendame algo") basada en promos o
  variante por defecto.
- No existia una forma backend-controlada de decidir que ofrecer, evitando que la IA
  inventara productos, precios o combos que no existen.

Codigo actual:

- `apps/api/src/modules/conversation/conversationService.ts` (funcion previa
  `buildRecommendationReply`/`looksLikeRecommendationRequest`, sigue existiendo para
  "recomiendame algo" explicito — es reactiva, no hace tracking de aceptar/rechazar y no se
  toco en este cambio).
- `apps/api/src/modules/products/productService.ts` (`getEffectivePrice`, catalogo).

Direccion aplicada:

- Se agrego el modelo `ProductRecommendation` (regla por producto o por categoria origen ->
  producto recomendado, tipo UPSELL/CROSS_SELL/ADD_ON, prioridad, activo) y los settings
  `upsellEnabled` (default false, opt-in por deployment) y `maxUpsellOffers`.
- Se agrego `apps/api/src/modules/conversation/recommendationService.ts`: seleccion 100%
  backend y determinista (`selectCartRecommendation`), nunca decidida por la IA — reutiliza
  `getEffectivePrice()` para el precio vigente del dia, respeta disponibilidad, evita
  duplicados y respeta rechazos previos del mismo carrito. Devuelve como maximo una oferta.
- La oferta se dispara solo una vez, justo cuando el producto principal + acompanantes/
  bebidas quedan resueltos en el turno (nunca durante checkout/confirmacion), se frasea con
  el mismo patron `generateResponse({facts, askNext})` que el resto del bot (la IA solo
  redacta, nunca elige producto/precio), y se apaga automaticamente en handoff humano
  (mismo guard `canBotAutoReply()` que usa cart recovery).
- Reconocimiento de frases coloquiales de aceptar/rechazar con el mismo patron de regex que
  `cartRecoveryService.ts`, interceptado antes del clasificador de intencion para que un
  "no" respondiendo la oferta nunca se confunda con cancelar el pedido completo.
- Eventos de auditoria `UPSELL_OFFERED`/`UPSELL_ACCEPTED`/`UPSELL_REJECTED`/
  `UPSELL_UNAVAILABLE` en `ConversationAuditEvent`, mismo mecanismo que cart recovery.
- Panel admin minimo en `/recommendations` (alta/baja/activar reglas) y toggle en
  Configuracion. Ver `docs/UPSELLING.md` para el detalle completo.

Impacto:

- Aumenta el ticket promedio sin arriesgar UX: como mucho una sugerencia por carrito (o el
  limite configurado), nunca insiste tras un rechazo, nunca interfiere con checkout ni con
  handoff humano, y nunca ofrece un producto agotado o con precio desactualizado.

### 3. Soporte de ubicacion WhatsApp

- Parsear ubicacion estructuralmente.
- Reutilizarla para cobertura y tarifa.

### 4. Mejor observabilidad

- Agregar correlacion `mensaje -> conversacion -> IA -> carrito -> pedido -> respuesta`.
- No loguear secretos ni datos sensibles innecesarios.

### 5. Analytics utiles

- ratio de handoff
- intents no entendidos
- carritos abandonados
- retries duplicados
- frecuencia de correcciones

### 6. Payment Engine, webhooks, refunds y conciliacion

Estado: DONE

Problema:

- El pago estaba acoplado a `Order`.
- `payments` existia, pero era una tabla minima sin provider abstraction, webhook idempotency, refunds ni conciliacion.
- `orders.paymentStatus` se escribia manualmente desde varios puntos.

Direccion aplicada:

- Se enriquecio `Payment` con provider, currency, idempotency, provider references, timestamps financieros, `paidAmount` y `refundedAmount`.
- Se agregaron `PaymentRefund`, `PaymentWebhookEvent` y `PaymentReconciliationIssue`.
- Se implemento `paymentService.ts` como source of truth financiero.
- Se agrego provider abstraction con `MANUAL` y `MOCK`.
- El webhook de pagos quedo separado en `POST /webhooks/payments/mock` con verificacion e idempotencia.
- Los refunds usan proteccion contra duplicate request y contra sobre-refund concurrente.
- `orders.paymentStatus` ahora es proyeccion derivada desde pagos reales.

Impacto:

- Menos acoplamiento entre pedido y cobro.
- Base lista para agregar pasarelas reales sin meter logica de proveedor dentro de `OrderService`.
- Mejor seguridad frente a double click, replay de webhook, underpayment y overpayment.

## P3 Futuro

- multi-sucursal
- CRM mas profundo
- recomendaciones mas ricas
- integraciones logisticas

## Orden Sugerido De Entrega

1. Idempotencia persistente de webhook
2. Serializacion durable de conversacion
3. Carrito estructurado y contexto preciso del pedido
4. Servicio explicito de calculo de carrito
5. Validacion de disponibilidad y combinaciones
6. Modificadores estructurados
7. Aliases normalizados
8. Cobertura de domicilio
9. Reorder del pedido anterior
10. Audio y ubicacion

## Tests A Agregar Antes De Cambios De Comportamiento

- mensaje duplicado de webhook
- dos mensajes rapidos del mismo cliente
- confirmacion obligatoria antes de crear pedido
- producto agotado durante reorder
- combinacion de modificador invalida
- domicilio fuera de cobertura
- repetir ultimo pedido con precio actualizado
- handoff humano y retorno a bot

## Primer Cambio Recomendado

Empezar por idempotencia persistente de mensajes entrantes.

Por que primero:

- protege ingresos y confianza operativa
- evita el fallo mas peligroso: pedido duplicado
- es mas acotado que una refactorizacion de carrito/modificadores
- hace mas seguros los cambios posteriores del agente
