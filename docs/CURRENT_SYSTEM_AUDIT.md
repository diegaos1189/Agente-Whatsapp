# Auditoria Del Sistema Actual

Fecha de auditoria: August 21, 2026

## Alcance

Esta auditoria se hizo sobre el codigo actual del repositorio. En esta ejecucion no se modifico comportamiento de produccion.

## Stack Encontrado

- Lenguaje: TypeScript
- Monorepo: pnpm workspaces
- Backend: Fastify 5 sobre Node.js 20+, ver `apps/api/package.json`
- Frontend/admin: Next.js 14 + React 18, ver `apps/admin/package.json`
- Base de datos: PostgreSQL
- ORM: Prisma 5
- Proveedor de IA: Gemini u OpenAI segun `AI_PROVIDER`, ver `apps/api/src/config/env.ts`
- Proveedor de WhatsApp: Meta WhatsApp Cloud API o adaptador mock, ver `apps/api/src/modules/whatsapp/whatsappClient.ts`
- Hosting observado: Docker; la documentacion apunta a Railway como destino esperado, ver `infra/docker-compose.yml` y `README.md`
- Autenticacion:
  - API admin con bearer token en `apps/api/src/app.ts`
  - Panel admin con cookie de sesion firmada por HMAC en `apps/admin/src/lib/auth.ts` y `apps/admin/src/middleware.ts`
- Redis: no encontrado
- Colas externas: no encontradas
- Serializacion actual: cola en memoria por numero de telefono, ver `apps/api/src/modules/conversation/conversationService.ts:571`
- Automatizaciones: webhooks salientes a n8n, ver `apps/api/src/modules/n8n/n8nClient.ts`

## Arquitectura Actual

Flujo observado en codigo:

1. El cliente escribe por WhatsApp.
2. Meta envia el webhook a `POST /webhooks/whatsapp`, ver `apps/api/src/routes/whatsapp.webhook.ts`.
3. El backend valida firma HMAC si `whatsappAppSecret` esta configurado.
4. El webhook normaliza mensajes entrantes y hace deduplicacion en memoria por `waMessageId`.
5. Cada mensaje se serializa por telefono con `enqueueByPhone(...)`.
6. `conversationService` resuelve o crea:
   - `contacts`
   - `conversations`
   - `messages`
7. Si entra audio o imagen:
   - el audio puede transcribirse con IA
   - la imagen puede describirse con IA
   - el comprobante de transferencia puede cambiar el estado del pago
8. Para texto, el backend orquesta:
   - clasificacion de intencion
   - extraccion de entidades
   - busqueda de productos/categorias/promociones
   - transicion del flujo de pedido
   - generacion de respuesta con guardrails
9. El contexto conversacional se persiste en `conversations.context`.
10. Al confirmar, el pedido se persiste en `orders`, `order_items`, `payments`, `order_events`.
11. La respuesta sale por el adaptador de WhatsApp y tambien se guarda en `messages`.
12. El panel admin consume la API REST para conversaciones, pedidos, productos, promociones, ajustes, FAQs, usuarios, metricas, cocina y facturacion.

## Modelo De Datos Actual

Entidades principales en `apps/api/prisma/schema.prisma`:

- Clientes: `contacts`
- Conversaciones: `conversations`
- Mensajes: `messages`
- Catalogo: `categories`, `products`, `promotions`, `faqs`
- Direcciones de clientes: `addresses`
- Pedidos: `orders`, `order_items`, `payments`, `order_events`
- Escalamiento humano: `handoffs`
- Configuracion del negocio: `business_settings`
- Usuarios del panel: `admin_users`

Observaciones importantes:

- El carrito activo no es una tabla dedicada.
- El carrito vive dentro de `conversations.context.orderFlow.cart`.
- Los aliases de producto existen solo de forma parcial mediante `products.searchKeywords`.
- Los combos si tienen composicion estructurada con `isCombo` y `comboItems`.
- No existe aun un modelo estructurado de modificadores.
- El domicilio hoy es una tarifa plana global desde `business_settings.deliveryFee`.

## Estado De Funcionalidades

### Recepcion de mensajes: `WORKING`

- Existe webhook.
- Existe validacion de firma.
- Existe normalizacion para texto, audio e imagen.
- Referencias:
  - `apps/api/src/routes/whatsapp.webhook.ts`
  - `apps/api/src/modules/whatsapp/whatsappTypes.ts`

### Envio de mensajes: `WORKING`

- Existen adaptadores `mock` y `meta`.
- Existe marcar como leido y typing indicator.
- Existe envio de imagen para QR/comprobantes.
- Referencia:
  - `apps/api/src/modules/whatsapp/whatsappClient.ts`

### Menu: `WORKING`

- Existe listado de catalogo.
- Existe respuesta por categoria.
- Existe bandera `showInMenu`.
- Referencias:
  - `apps/api/src/modules/products/productService.ts`
  - `apps/api/src/modules/conversation/conversationService.ts`

### Productos: `WORKING`

- Hay categorias, disponibilidad, combo, variante por defecto, keywords y `unitCount`.
- El matching ya tolera errores menores de escritura.
- Referencias:
  - `apps/api/prisma/schema.prisma`
  - `apps/api/src/modules/products/productService.ts`

### Precios: `WORKING`

- Los precios salen de base de datos.
- Existe precio efectivo con promociones.
- Existen guardrails para evitar montos inventados por IA.
- Referencias:
  - `apps/api/src/modules/products/productService.ts`
  - `apps/api/src/modules/ai/guardrails.ts`

### Carrito: `PARTIAL`

- Si hay estructura de carrito en el contexto conversacional.
- Soporta agregar items y algunas correcciones.
- No existe aun como modelo relacional dedicado.
- No vi operaciones explicitas de backend equivalentes a `removeCartItem`, `updateCartItem`, `clearCart` o modificadores por item.
- Referencias:
  - `apps/api/src/modules/conversation/orderFlow.ts`
  - `apps/api/src/modules/conversation/conversationService.ts`

### Pedidos: `WORKING`

- El pedido solo se crea tras confirmacion explicita.
- La creacion es transaccional con items, pagos y eventos.
- Referencias:
  - `apps/api/src/modules/conversation/orderFlow.ts`
  - `apps/api/src/modules/orders/orderService.ts`

### Confirmacion previa: `WORKING`

- El flujo llega a `CONFIRMING`.
- La orden solo se crea con `Intent.CONFIRM`.
- Referencia:
  - `apps/api/src/modules/conversation/orderFlow.ts`

### Clientes: `WORKING`

- El contacto se persiste y se reutiliza por telefono.
- Existe tabla de direcciones.
- Referencia:
  - `apps/api/prisma/schema.prisma`

### Domicilios: `PARTIAL`

- Existen domicilio vs recoger.
- Se capturan direccion, barrio, referencia y telefono alterno.
- La tarifa es plana.
- No vi validacion de cobertura ni zonas ni asignacion de sede.
- Referencias:
  - `apps/api/src/modules/conversation/orderFlow.ts`
  - `apps/api/prisma/schema.prisma`

### Pagos: `PARTIAL`

- Hay efectivo, transferencia y tarjeta contraentrega.
- Existe flujo de comprobante por imagen.
- La confirmacion final de transferencia sigue siendo manual.
- No existe pasarela online.
- Referencias:
  - `apps/api/src/modules/orders/orderService.ts`
  - `apps/api/src/modules/conversation/conversationService.ts:627`

### Historial de pedidos: `PARTIAL`

- Existe consulta del ultimo pedido.
- Existe consulta de estado.
- No encontre flujo completo y seguro para "lo mismo de la vez pasada".
- Referencias:
  - `apps/api/src/modules/orders/orderService.ts`
  - `apps/api/src/modules/conversation/conversationService.ts`

### Promociones: `WORKING`

- Se persisten.
- Hay filtro por dias de semana.
- Existen descuentos porcentuales y fijos.
- Referencia:
  - `apps/api/src/modules/products/productService.ts`

### Conversaciones e historial: `WORKING`

- Se persiste todo inbound y outbound.
- El contexto sobrevive reinicios porque va a base de datos.
- Referencias:
  - `apps/api/prisma/schema.prisma`
  - `apps/api/src/modules/conversation/conversationService.ts`

### IA: `WORKING`

- Esta separada en clasificacion, extraccion y generacion.
- La IA no crea pedidos ni calcula precios directamente.
- Existen guardrails.
- Referencias:
  - `apps/api/src/modules/ai/intentClassifier.ts`
  - `apps/api/src/modules/ai/entityExtractor.ts`
  - `apps/api/src/modules/ai/responseGenerator.ts`

### Panel administrativo: `WORKING`

- Existen vistas para conversaciones, pedidos, productos, promociones, configuracion, usuarios, FAQs, cocina, facturacion y metricas.
- Referencia:
  - `apps/admin/src/app/(dashboard)`

### Escalamiento a humano: `WORKING`

- Hay handoff por keyword, por intent, por baja confianza y por transferencias.
- Mientras la conversacion esta en handoff el bot no responde.
- Referencia:
  - `apps/api/src/modules/conversation/conversationService.ts`

### Audios: `PARTIAL`

- El audio se descarga y se transcribe.
- Luego vuelve a la misma pipeline de texto.
- No hay manejo estructurado de confianza de transcripcion.
- Referencia:
  - `apps/api/src/modules/conversation/conversationService.ts:735`

### Imagenes: `PARTIAL`

- Los comprobantes se manejan de forma util.
- Las imagenes normales solo se describen; no se entienden estructuralmente.
- Referencia:
  - `apps/api/src/modules/conversation/conversationService.ts:769`

### Ubicacion WhatsApp: `MISSING`

- No encontre parseo de payload de ubicacion en la normalizacion del webhook.
- Referencia:
  - `apps/api/src/modules/whatsapp/whatsappTypes.ts`

### Cobertura de domicilio: `MISSING`

- No encontre zonas, cobertura ni calculo por distancia.

### Modificadores estructurados: `MISSING`

- No encontre `modifier_groups`, `modifiers` ni persistencia por item.
- Hoy los cambios tipo "sin ensalada" o "extra salsa" caen en texto libre.

## Lo Que Ya Esta Bien Resuelto

- Confirmacion antes de crear el pedido.
- Precios calculados desde backend y no desde la IA.
- Disponibilidad respetada via catalogo disponible.
- Historial de mensajes persistente.
- Handoff humano ya operativo.
- Audio ya integrado a la conversacion.
- Panel suficientemente amplio para operar manualmente cuando el bot falle.

## Problemas Encontrados

- Deduplicacion de mensajes solo en memoria, ver `apps/api/src/routes/whatsapp.webhook.ts:33`
- Serializacion por telefono solo en memoria de proceso, ver `apps/api/src/modules/conversation/conversationService.ts:571`
- El carrito activo vive dentro de JSON de conversacion y no como modelo dedicado, ver `apps/api/prisma/schema.prisma:31`
- El matching de producto sigue siendo heuristico por tokens, ver `apps/api/src/modules/products/productService.ts:232`
- No existe soporte real para ubicacion WhatsApp, ver `apps/api/src/modules/whatsapp/whatsappTypes.ts`
- No existe cobertura estructurada de domicilio
- No existe reorder completo del pedido anterior
- No existe modelo estructurado de modificadores

## Riesgos De Produccion

### P0

- Mensajes duplicados pueden volver a procesarse tras reinicio o en multi-instancia porque la deduplicacion actual es solo en memoria.
- Dos instancias podrian corromper contexto porque la cola por telefono actual vive en memoria local de proceso.
- La mutacion del carrito es dificil de auditar y editar fino porque vive en JSON.

### P1

- Domicilio con tarifa plana sin cobertura ni sede.
- Reorder del ultimo pedido aun incompleto.
- Modificadores complejos y referencias como "el segundo", "mitad y mitad", "sin..." aun sin modelo estructurado.
- Imagenes no comprobante siguen siendo genericas.

### P2

- `ADMIN_BOOTSTRAP_PASSWORD` tiene default debil en `apps/api/src/config/env.ts:11`.
- Si falta `SESSION_SECRET`, el middleware del panel no bloquea acceso para no romper setup; eso es comodo para arranque pero riesgoso si se despliega mal configurado, ver `apps/admin/src/middleware.ts`.

## Tests Encontrados

Existen pruebas para:

- horarios en `apps/api/tests/businessHours.test.ts`
- guardrails en `apps/api/tests/guardrails.test.ts`
- maquina de estados de pedido en `apps/api/tests/orderFlow.test.ts`

Huecos de prueba relevantes:

- no vi prueba de idempotencia de webhook
- no vi prueba de concurrencia entre instancias
- no vi prueba de reorder seguro
- no vi prueba de cobertura de domicilio
- no vi prueba de ubicacion WhatsApp
- no vi prueba de modificadores estructurados por item

## Conclusiones

El proyecto si existe, si funciona y ya tiene bases buenas de produccion. No es un prototipo vacio.

Lo mas importante que encontre es esto:

- la base actual sirve para evolucionar incrementalmente
- la arquitectura general no necesita reescritura
- los mayores riesgos no estan en frontend ni en stack
- los mayores riesgos estan en idempotencia, concurrencia, carrito estructurado y modelado de modificadores
