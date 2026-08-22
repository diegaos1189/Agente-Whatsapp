# Historial Y Repeticion Segura

Fecha: August 21, 2026

## Objetivo

Permitir frases como:

- `lo mismo de la vez pasada`
- `repitame el ultimo pedido`
- `lo mismo pero sin ensalada`
- `el mismo pero hoy lo recojo`
- `lo mismo a la misma direccion`

Sin copiar pedidos historicos directamente ni cobrar con snapshots viejos.

## Regla Central

Un pedido anterior es solo una referencia.

El flujo correcto es:

Historical Order
-> Ownership
-> Rebuild Cart
-> Current Catalog
-> Current Availability
-> Current Pricing
-> Delivery Revalidation
-> Summary
-> Confirmation

Nunca:

Historical Order
-> Copy
-> Confirmed Order

## Como Funciona Ahora

### 1. Ownership

- Todas las consultas usan `contactId` resuelto por la conversacion de WhatsApp.
- El lookup por codigo de pedido tambien filtra por `contactId`.
- No se consulta historial a partir de un telefono inventado por IA.

### 2. Consulta de historial

`apps/api/src/modules/orders/orderService.ts`

- `getLatestOrderForContact(contactId)`
- `getRecentOrdersForContact(contactId, limit)`
- `getOrderByCodeForContact(contactId, code)`

Se devuelven pocos resultados y estructurados.

### 3. Reconstruccion segura

`apps/api/src/modules/conversation/repeatOrder.ts`

- Se selecciona un pedido fuente.
- Se crea un carrito NUEVO en memoria/contexto de conversacion.
- Cada `OrderItem` se resuelve contra el catalogo actual.
- Si el producto ya no existe o esta agotado, no se agrega.
- Las notas historicas se reintentan sobre el carrito estructurado actual para revalidar removals/additions/replacements.

### 4. Pricing actual

- El backend usa `getEffectivePrice(...)`.
- El carrito repetido pasa por `pricingService`.
- La confirmacion final pasa por `checkoutService`.
- Nunca se cobra con `unitPrice` historico del pedido anterior.

### 5. Delivery actual

- Si el pedido fuente era domicilio, la direccion historica solo se reutiliza como candidata.
- `checkoutService` revalida cobertura, minimo y costo actual.
- Si el cliente cambia a `PICKUP`, se limpia direccion y no se reutiliza delivery fee historico.

### 6. Carrito activo existente

- Si ya hay carrito en curso, el bot no lo pisa.
- Guarda una propuesta de reemplazo en `conversations.context`.
- Solo reemplaza si el cliente confirma explicitamente.

### 7. Ambiguedad

- `lo de siempre` no toma automaticamente el ultimo pedido si los recientes difieren.
- En ese caso se muestran pocos candidatos recientes y se pide aclaracion.

## Limitaciones Conocidas

- El sistema actual no tiene `tenantId` en el modelo de pedidos porque hoy opera como tenant unico.
- Los modificadores historicos siguen dependiendo de las notas disponibles en `OrderItem.notes`; si un pedido viejo guardo notas muy libres o incompletas, la reconstruccion puede quedar parcial y pedir ajuste humano/cliente.
- No existe aun analytics formal; por ahora la trazabilidad vive en contexto conversacional y tests.

## Archivos Clave

- `apps/api/src/modules/orders/orderService.ts`
- `apps/api/src/modules/conversation/repeatOrder.ts`
- `apps/api/src/modules/conversation/conversationService.ts`
- `apps/api/src/modules/products/productService.ts`
- `apps/api/tests/repeatOrder.test.ts`
