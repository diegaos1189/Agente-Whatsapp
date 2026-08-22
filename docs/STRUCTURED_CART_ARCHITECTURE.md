## Carrito Estructurado Activo

Fecha: August 21, 2026

### Objetivo

Dejar de depender principalmente del historial libre para saber que lleva el cliente en el pedido activo.

### Decision aplicada

- No se creo un subsistema paralelo ni una migracion destructiva.
- Se mejoro la persistencia que ya existia en `conversations.context`.
- La fuente principal del pedido activo ahora puede vivir en `context.activeCart`.

### Estructura

- `activeCart.items[]`
  - `id`
  - `productId`
  - `productName`
  - `categoryName`
  - `unitPrice`
  - `components[]`
  - `notes[]`
- `activeCart.lastReferencedItemId`

### Componentes por item

Cada item puede tener componentes estructurados:

- `productId`
- `productName`
- `categoryName`
- `quantity`
- `unitPrice`
- `source`
  - `INCLUDED`
  - `ADDED`
- `status`
  - `ACTIVE`
  - `REMOVED`

Esto permite representar:

- items incluidos en combos
- extras agregados
- componentes removidos
- reemplazos de bebida o acompanante sin perder trazabilidad

### Compatibilidad

- `orderFlow.cart` se mantiene como snapshot derivado para no romper el flujo actual.
- La creacion final del pedido sigue usando lineas compatibles con `orderService`.
- El panel de conversaciones puede leer `activeCart` y, si no existe, caer al snapshot legado.

### Operaciones soportadas

- duplicar item de referencia
- quitar componente de un item concreto
- agregar extra a un item concreto
- reemplazar componente por otro producto real
- ajustar cantidad del grupo del producto referenciado

### Concurrencia

- No se introdujo una cola nueva.
- Todas las mutaciones siguen ocurriendo dentro de la serializacion durable por contacto implementada antes.

### Limites actuales

- No existe todavia un modelo relacional dedicado de modificadores.
- No existe aun un servicio unico de calculo avanzado de carrito/totales.
- Referencias extremadamente ambiguas siguen debiendo pedir aclaracion.
