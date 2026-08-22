# Mejoras implementadas — registro completo

Documento generado tras una sesión larga de desarrollo autónomo. Cubre todo el sistema tal como quedó: qué se construyó, qué se arregló, y qué queda pendiente. Organizado por categoría, no cronológicamente.

**Estado al cierre:** typecheck limpio (`pnpm run lint`), 17/17 tests pasando (`pnpm run test`), backend y panel admin corriendo y verificados en vivo (login, todas las páginas, webhook de WhatsApp real conectado).

---

## 1. Seguridad (lo más importante de esta sesión)

Estos dos hallazgos eran los gaps reales más serios para un sistema "de producción" — ambos corregidos:

### 1.1 El webhook de WhatsApp no verificaba que los mensajes vinieran realmente de Meta
Cualquiera que adivinara la URL del webhook podía mandar un POST con formato de mensaje de WhatsApp falso y el bot lo habría procesado como si fuera un cliente real (crear pedidos falsos, saturar la IA, etc).

**Fix:** verificación de firma HMAC-SHA256 (`X-Hub-Signature-256`) contra el App Secret de Meta, comparación con `timingSafeEqual` (resistente a timing attacks). Requirió capturar el body crudo del request en Fastify (`app.addContentTypeParser`) ya que Meta firma el body sin parsear.
- `apps/api/src/routes/whatsapp.webhook.ts`
- `apps/api/src/app.ts`
- `apps/api/src/config/env.ts` (nueva var `WHATSAPP_APP_SECRET`)
- Si la variable no está configurada, no valida (modo dev/mock sigue funcionando sin fricción). Ya está configurada en el `.env` actual con tu App Secret real.

### 1.2 El panel admin no tenía login propio
El backend sí pedía un `Authorization: Bearer <token>`, pero ese token vivía **solo en el servidor** de Next.js (via `apiServerFetch`). Cualquiera que abriera la URL del panel en un navegador veía conversaciones, pedidos y datos de clientes sin escribir ninguna contraseña.

**Fix:** login propio del panel con sesión sin estado (cookie httpOnly firmada con hash, no expira por servidor caído, no necesita tabla de sesiones).
- `apps/admin/src/middleware.ts` — bloquea todo excepto `/login`, redirige si no hay cookie válida
- `apps/admin/src/lib/auth.ts` + `authConstants.ts` (separado porque el middleware corre en Edge Runtime, que no soporta `node:crypto`)
- `apps/admin/src/app/login/page.tsx`, `app/api/login/route.ts`, `app/api/logout/route.ts`
- Reestructuré las páginas del dashboard bajo un route group `app/(dashboard)/` para que `/login` no muestre el sidebar
- Nuevas vars: `ADMIN_PANEL_PASSWORD`, `SESSION_SECRET` en `apps/admin/.env`
- **Contraseña actual del panel: `pollos2026`** (cámbiala en `apps/admin/.env` cuando quieras)

### 1.3 Otros
- Comparación de tokens con `timingSafeEqual` donde correspondía.
- El proxy interno del panel (`/api/proxy/*`) nunca expone el token real al navegador — se mantuvo ese diseño, solo se le agregó el método `DELETE` que faltaba (ver bugs).

---

## 2. Generalización del sistema (de "bot de pollo" a plantilla reutilizable)

El pedido original fue construir esto para revender a otros restaurantes (pizzerías, hamburgueserías, etc), no solo Pollos El Corralito.

- **Intents genéricos**: se eliminaron `ORDER_FRIED_CHICKEN` / `ORDER_GRILLED_CHICKEN` del enum compartido, reemplazados por un único `ORDER_PRODUCT` — el tipo de producto es texto libre resuelto contra el catálogo real de cada negocio, no hardcodeado por tipo de comida.
- **Prompts de IA agnósticos**: `intentClassifier`, `entityExtractor` y `responseGenerator` reciben `businessName` como parámetro y nunca mencionan un tipo de comida específico en las instrucciones fijas.
- **Moneda dinámica**: `formatCurrency(amount, currencyCode)` reemplazó el `formatCOP` hardcodeado — cualquier negocio puede usar su propia moneda (MXN, USD, etc) desde Configuración.
- **Personalidad configurable**: campo `assistantTone` en `business_settings`, editable desde el panel, inyectado en el prompt del generador de respuestas.
- **Wizard de setup**: `apps/api/scripts/setup-business.mjs` — pregunta datos del negocio (nombre, horario, moneda, tono, API key de IA) y escribe los `.env` + guarda en base de datos. `pnpm run setup`.
- **`CLAUDE.md`** en la raíz: instrucciones para que Claude Code configure un cliente nuevo en minutos, y reglas explícitas de "no reintroducir cosas específicas de un negocio" (para que futuras sesiones no rompan la genericidad).
- **`QUICKSTART.md`**: guía para llevar el proyecto en USB/git a la máquina de un cliente nuevo.

---

## 3. Motor de IA: dos proveedores intercambiables

- `AI_PROVIDER=gemini` (default) u `openai`, elegible por variable de entorno.
- `apps/api/src/modules/ai/aiClient.ts` despacha a `providers/gemini.ts` o `providers/openai.ts`, misma interfaz (`callAiJson`, `callAiText`, `transcribeAudio`, `describeImage`).
- Schemas de extracción estructurada definidos **una sola vez** en formato neutral (`schema.ts`) y convertidos al formato de cada proveedor (OpenAI usa `type: ["string","null"]`, Gemini usa `nullable: true`) — evita duplicar schemas.
- **Nota real de esta sesión**: tu cuenta de Gemini tiene cuota gratis en 0 en todos los modelos probados (2.0-flash, 2.0-flash-lite, 2.5-flash) — típico de cuentas Google Workspace o proyectos nuevos sin facturación activada. Quedó configurado con **OpenAI** por ahora (funcionando, con crédito cargado). Si quieres volver a Gemini: activa facturación en el proyecto de Google Cloud o crea la key con una cuenta Gmail personal.

---

## 4. Percepción multimedia (audio e imágenes)

- **Audio**: nota de voz → se descarga de WhatsApp (`whatsappClient.downloadMedia`) → se transcribe (Whisper si `AI_PROVIDER=openai`, nativo si `gemini`) → se procesa como si fuera un mensaje de texto normal (mismo flujo completo de pedidos/menú/etc).
- **Imágenes**: si no es comprobante de pago pendiente, el bot ahora **describe la imagen** (visión) y responde según lo que ve, en vez de solo pedir que la describas en texto.
- Ambas requieren modo `meta` real (no `mock`) porque necesitan descargar el archivo de los servidores de WhatsApp.

---

## 5. Calidad de conversación (que suene humano, no un bot)

Varios ajustes vinieron de revisar transcripciones reales de WhatsApp:

- **El bot repetía "¡Hola!" y el nombre del negocio entre comillas en cada mensaje** — sonaba robótico. Se separaron las instrucciones: el saludo inicial (mensaje de bienvenida) es la única vez que se permite saludar/nombrar el negocio; todas las respuestas de seguimiento tienen instrucción explícita de **no** volver a saludar ni repetir el nombre.
- **Pedido múltiple en un mensaje se perdía parcialmente**: "pollo de 8 piezas y una gaseosa" solo agregaba el pollo, la gaseosa se descartaba silenciosamente. Ahora se resuelven acompañantes/productos extra mencionados en el mismo mensaje sin importar en qué paso del flujo esté el cliente, y si algo no matchea el menú **se lo dice explícito** al cliente en vez de callarlo.
- **Cambio de pedido a mitad de flujo causaba loop y escalamiento innecesario**: si el bot preguntaba "¿domicilio o recoger?" y el cliente respondía con un pedido completamente distinto ("no, yo pedí X"), el bot no entendía el cambio de tema, contaba como intento fallido, y a los 2 fallos escalaba a humano. Ahora detecta que el nuevo mensaje matchea otro producto del menú y **reinicia el pedido** en vez de trabarse.
- **Indicador de "escribiendo..."**: como la IA tarda 3-5 segundos en responder, ahora se marca el mensaje como leído + se activa el indicador de escritura de WhatsApp apenas llega el mensaje (`typing_indicator` de la Cloud API), para que el cliente vea feedback inmediato en vez de silencio.

---

## 6. Gestión de sesiones y memoria de cliente

- **Sesión de 30 min de inactividad**: si un cliente no escribe en 30 min, la conversación se archiva sola; al volver a escribir arranca una sesión nueva.
- **Archivo inmediato al completar un pedido**: en cuanto el bot termina de tomar un pedido, archiva la conversación de una vez (no espera los 30 min) — ya no hay nada más que hablar en ese momento.
- **Cliente recurrente**: si alguien que ya pidió antes vuelve a escribir (nueva sesión), el saludo es personalizado — lo saluda por nombre y menciona su último pedido (estado + dirección de domicilio anterior si aplica) en vez de la bienvenida genérica.
- **Archivo diario automático**: a la hora que configures (default 11:50pm, campo editable en Configuración → Operación), todas las conversaciones activas del día se archivan solas.
- **Botón de archivar manual** en el listado de conversaciones (por si quieres limpiar el panel principal antes de la hora automática).
- **Retención de 30 días, no borrado inmediato**: las conversaciones archivadas se conservan 30 días completos (mensajes incluidos) para que el bot pueda dar contexto a clientes que vuelven — después de 30 días, un job las purga automáticamente (borra mensajes + handoffs + la conversación, en una transacción).
- El identificador de cada conversación sigue siendo el número de celular (`Contact.phone`, único) — sin cambios ahí, ya estaba bien.

---

## 7. Control humano/IA (CRM operativo)

- **Toggle bidireccional**: antes solo existía "volver al bot" (resolver un handoff). Ahora también hay **"Escalar a humano" manual** — puedes pausar el bot en cualquier conversación sin esperar a que el cliente pida un asesor o el bot falle.
- **Responder desde el panel**: cuadro de texto en la conversación para que un humano le escriba directo al cliente por WhatsApp desde el panel (antes no había forma de contestar manualmente).
- **Panel de pedido al lado del chat**: al abrir una conversación, se ve el pedido más reciente del cliente (o un formulario para crear uno manual leyendo el chat — útil cuando un humano toma el pedido). Al crear un pedido manual, el cliente recibe automáticamente un WhatsApp con el resumen pidiendo que confirme que está bien.

---

## 8. POS / gestión de pedidos

- **Estado nuevo: "Listo"** (`READY`) — entre "en cocina" y "en camino", para el momento en que el pedido está armado y se busca domiciliario.
- **Notificación automática al cliente en cada cambio de estado** (confirmado, en cocina, listo, en camino, entregado, cancelado) — mensaje distinto por estado, incluyendo el pedido para "listo": *"Estamos buscando un domiciliario para enviártelo"*.
- **Timer en vivo por pedido**: en el listado de pedidos, cuenta el tiempo transcurrido desde que se creó — verde mientras va bien, rojo con ⚠ si se pasa del tiempo estimado de preparación configurado (no un número fijo, usa tu configuración real).

## 9. Métricas (pantalla nueva)

`/metrics` — últimos 30 días:
- Pedidos hoy / 7 días / 30 días
- Ticket promedio
- **Tiempo real de preparación** (medido de verdad con los eventos de cada pedido: desde que se crea hasta que llega a "Listo" o "Entregado"), comparado contra tu estimado configurado
- Conversaciones totales y % que terminó escalado a humano
- Desglose de pedidos por estado

---

## 10. Diseño del panel (estética Apple)

- Rediseño completo de `globals.css`: paleta gris suave, blur/glassmorphism en el sidebar, cards con bordes finos y sombras suaves, botones tipo píldora, soporte automático a modo oscuro del sistema.
- **Bug de contraste en modo oscuro**: los inputs usaban el mismo color que el fondo de la página — texto invisible. Corregido dándole a todo input/select/textarea un fondo propio siempre distinguible del fondo general.
- **Burbujas de chat con colores fijos tipo iMessage** (gris cliente / azul bot) en vez de heredar el tema — un chat necesita contraste garantizado sin importar claro/oscuro.
- **Configuración reorganizada**: de un formulario larguísimo hacia abajo a secciones balanceadas (Datos+Operación en una columna pareja con Horario, Mensajes abajo usando todo el ancho), responsive a pantallas más chicas.
- **Productos**: tarjetas de "nueva categoría"/"nuevo producto" simétricas y más anchas en vez de angostas y altas.

---

## 11. Performance

- **Catálogo de productos con cache de 30s**: en un flujo de pedido normal, el mismo mensaje puede llamar `findBestProductMatch` varias veces (producto principal + cada acompañante) — sin cache eso eran varias queries idénticas a la DB por mensaje. Se invalida automáticamente apenas el panel crea/edita/borra un producto o categoría.

---

## 12. Bugs corregidos (que no encajan en las categorías de arriba)

- **`phone: undefined` crasheaba el webhook** la primera vez que llegó un mensaje real de Meta — el parser no cubría bien la forma real del payload en ciertos casos; se agregó chequeo defensivo.
- **Botón "Marcar como resuelta" tiraba error 400**: el cliente HTTP mandaba `Content-Type: application/json` en requests **sin body**, y Fastify rechaza eso. Corregido en `apiClient.ts`, `apiServer.ts`, y el proxy interno (que además le faltaba el método `DELETE`, por lo que "Eliminar producto" nunca había funcionado a través del proxy).
- **Doble suscripción de WhatsApp a la app equivocada**: el número estaba suscrito a una app default de Meta ("WA DevX Webhook Events") en vez de la tuya — re-suscrito correctamente vía API.
- **Túneles locales inestables**: ngrok se quedó sin ancho de banda gratis, cloudflared "quick tunnel" perdía mensajes silenciosamente. Documentado en README — para uso real sostenido, desplegar a Railway (URL fija) en vez de depender de túneles desde tu laptop.

---

## 13. Recomendaciones pendientes (no implementadas, para decidir cuándo)

Ordenadas por impacto:

1. **Deploy a Railway** — el bloqueante más real para probar WhatsApp de forma estable; los túneles locales fallan seguido.
2. **Rate limiting** en el webhook y la API admin (anti-abuso, actualmente sin límite de requests).
3. **Tests de integración para `conversationService.ts`** — hoy solo está testeada la lógica pura (`orderFlow.ts`, guardrails, horario); el orquestador completo (con Prisma/IA/WhatsApp mockeados) no tiene cobertura automatizada.
4. **Auditoría de acciones del panel** — quién cambió qué estado de pedido, quién respondió qué mensaje (hoy no queda registro de "qué humano" hizo una acción, solo que se hizo).
5. **Multi-tenant real** (si vas a vender a muchos negocios desde una sola instancia en vez de un deploy por cliente) — decisión de arquitectura grande, ya discutida antes: por ahora se optó por "un deploy por cliente", que no requiere este cambio.
6. **Reintentos automáticos** si falla el envío de un WhatsApp saliente (hoy se loguea el error pero no reintenta).

---

## 14. Segunda ronda — fixes de pruebas en vivo con WhatsApp real

Encontrados escribiéndole al bot de verdad, no en tests:

- **"2" se interpretaba como pedido de "Combo Pareja... + 2 gaseosas"**: el matcher de productos comparaba dígitos sueltos contra números dentro del nombre del producto. Fix: `meaningfulTokens()` en `productService.ts` descarta tokens numéricos y de <3 letras antes de comparar.
- **Atajos numéricos del menú de bienvenida**: si el bot ofrece "1. Ver menú / 2. Pedir / 3. Promos / 4. Estado" y el cliente responde solo "2", ahora se mapea directo al intent correspondiente (sin pasar por IA) — solo cuando no está ya dentro de un flujo de pedido.
- **Bot "perdido" a mitad de pedido**: si el cliente preguntaba el menú, promociones, o solo decía "hola" mientras el bot esperaba dirección/pago, antes lo ignoraba (o lo contaba como intento fallido, escalando a humano a los 2). Ahora responde la pregunta real Y recuerda la pregunta pendiente del pedido (`getPendingOrderQuestion` en `orderFlow.ts`), sin penalizar saludos ni preguntas fuera de tema a mitad de flujo.
- **Cierre de conversación también al entregar/cancelar pedido**: antes solo se archivaba al *crear* el pedido. Ahora `notifyOrderStatusChange` también cierra la conversación cuando el estado pasa a `DELIVERED` o `CANCELLED` — si el cliente escribe después, es sesión nueva con saludo limpio.
- **Pantalla de Pedidos dividida en dos**: "Pedidos vigentes" (todo lo que no sea entregado/cancelado) arriba, "Archivados" (solo últimos 10 entregados) abajo — antes era una sola lista larga mezclando todo el historial.

---

## Cómo verificar que todo esto sigue funcionando

```bash
pnpm run lint    # typecheck completo (api + admin)
pnpm run test    # 17 tests (state machine de pedido, guardrails, horario)
```

Backend: `http://localhost:4000/health` — Panel: `http://localhost:3000` (password: `pollos2026`, configurable en `apps/admin/.env`).
