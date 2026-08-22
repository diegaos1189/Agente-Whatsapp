# Upselling y cross-selling inteligente

Sugerencias proactivas de adicionales ("¿Te agrego una gaseosa de 1.5L por $6.000?") durante
la toma de pedido, con el mismo principio que el resto del bot: **el backend decide que
producto, a que precio y si aplica; la IA solo redacta la frase**. Nunca hay un producto,
precio o promocion inventado por el modelo.

## Flujo

```
Carrito (structuredCart) -> RecommendationService -> elegibilidad backend -> 1 oferta
  -> generateResponse({facts:[nombre+precio exacto], askNext:"¿Le agrego X por $Y?"})
  -> cliente responde (acepta/rechaza/ignora)
  -> aceptar: se agrega por el mismo camino real de carrito (orderFlow.cart + invalidacion
     de activeCart, igual que cualquier otro item nuevo) -> PricingService revalida precio
  -> rechazar: se guarda en rejectedProductIds del carrito, nunca se vuelve a ofrecer ese
     producto en el mismo carrito, y el pedido sigue su curso normal
```

## Cuando se dispara la oferta

Solo al final de un turno donde el producto principal + acompanantes/bebidas quedaron
resueltos **en ese mismo turno** (transicion del flujo a `ASK_DELIVERY_TYPE`). Ver
`shouldOfferUpsellThisTurn()` en `recommendationService.ts`. Esto evita:

- Ofrecer durante checkout/confirmacion (nunca dispara en `CONFIRMING`).
- Ofrecer mientras falta resolver el producto principal, tamaño, sides o bebidas.
- Repetir la oferta en cada turno mientras el cliente sigue completando datos (domicilio,
  pago) — solo dispara una vez, justo en la transicion.

Ademas de esa condicion de "punto seguro", `tryOfferUpsell()` exige:

- `settings.upsellEnabled === true` (apagado por defecto).
- La conversacion no esta en handoff humano (`canBotAutoReply()`, mismo guard que usa el
  resto del bot — incluye `HUMAN` y `WAITING_HUMAN`).
- No hay ya una oferta pendiente de respuesta (`upsell.pendingProductId`).
- No se supero `settings.maxUpsellOffers` ofertas distintas en este carrito.
- El cliente no pidio "nada mas"/"solo eso"/"sin adicionales" en algun mensaje de este
  carrito (`upsell.suspended`).

## Seleccion del producto (RecommendationService)

`getCartRecommendations()` en `apps/api/src/modules/conversation/recommendationService.ts`
carga el catalogo, las reglas activas (`ProductRecommendation`) y el precio vigente de hoy
(`getEffectivePrice()`, ya aplica promocion del dia) y llama a la funcion pura
`selectCartRecommendation()`, que:

1. Filtra reglas cuyo producto recomendado este disponible (`isAvailable`), no este ya en
   el carrito y no este en `rejectedProductIds`.
2. Prioriza reglas de producto exacto (el producto recomendado matchea un producto ya en el
   carrito), ordenadas por `priority` desc.
3. Si no hay match de producto, usa reglas de categoria (la categoria de algun item del
   carrito matchea `sourceCategoryId`), ordenadas por `priority` desc.
4. Si no hay ninguna regla elegible, devuelve vacio — **no hay fallback forzado**.
5. Devuelve como maximo **una** oferta (nunca una lista para elegir).

## Modelo de datos

```prisma
model ProductRecommendation {
  id                    String   @id @default(cuid())
  sourceProductId       String?  // regla de producto (uno de los dos, no ambos)
  sourceCategoryId      String?  // regla de categoria
  recommendedProductId  String
  recommendationType    String   // UPSELL | CROSS_SELL | ADD_ON
  priority              Int      @default(0)
  active                Boolean  @default(true)
}
```

`BusinessSettings` agrega `upsellEnabled` (default `false`) y `maxUpsellOffers` (default `1`).

## Estado por conversacion

Persistido en `conversations.context.upsell` (mismo mecanismo que `orderFlow`/`activeCart`):

```ts
interface UpsellContextState {
  offeredProductIds: string[]; // ofertas ya hechas este carrito (respeta maxUpsellOffers)
  rejectedProductIds: string[]; // nunca se vuelven a ofrecer este carrito
  pendingProductId: string | null; // oferta esperando respuesta del cliente
  suspended: boolean; // el cliente pidio no recibir mas ofertas este carrito
}
```

Se reinicia cuando el carrito se vacia/reinicia o cuando se crea el pedido.

## Frases del cliente

Mismo patron de regex por frases coloquiales que `cartRecoveryService.ts`:

- Aceptar: "de una", "hágale", "échela", "agréguela", "sí señor", "mande eso", "sí"/"si" solos.
- Rechazar: "no", "no señor", "déjelo así", "así está bien", "no gracias", "nada más", "solo eso".
- "nada más"/"solo eso"/"eso es todo" ademas de rechazar la oferta actual, **suspenden**
  cualquier oferta futura del mismo carrito.
- Opt-out explícito (sin que haya oferta pendiente): "sin adicionales", "no me ofrezca más".

La respuesta a una oferta pendiente se intercepta **antes** del clasificador de intencion
normal (`tryHandleUpsellOffer()`), para que un simple "no" respondiendo la oferta nunca se
confunda con `Intent.CANCEL` del pedido completo.

## Eventos de auditoria

Se registran en `ConversationAuditEvent` (misma tabla que usa cart recovery):
`UPSELL_OFFERED`, `UPSELL_ACCEPTED`, `UPSELL_REJECTED`, `UPSELL_UNAVAILABLE`.

## Panel admin

- `/recommendations`: alta/baja/activar-desactivar reglas (producto o categoria origen ->
  producto recomendado, tipo, prioridad).
- `/settings`: toggle `upsellEnabled` + numero `maxUpsellOffers`, junto a los demas toggles
  de operacion.

## Rollback

Apagar `upsellEnabled` en Configuracion detiene toda oferta inmediatamente (no requiere
reiniciar el proceso, `businessHoursService` cachea 30s). Para revertir el cambio de base de
datos por completo, hacer `DROP TABLE product_recommendations` y quitar las columnas
`upsellEnabled`/`maxUpsellOffers` de `business_settings` (o revertir la migracion
`20260821000600_add_product_recommendations`).

## Limitacion conocida / siguiente mejora

Cuando la oferta se dispara justo en la transicion a `ASK_DELIVERY_TYPE`, el mensaje del bot
contiene la pregunta original del flujo ("¿Es para domicilio o para recoger?") **y** la
pregunta de upsell en el mismo mensaje (dos preguntas). Es deliberado para no complicar la
maquina de estados de `orderFlow.ts` en esta primera fase, pero la mejora natural siguiente
es bloquear el avance a `ASK_DELIVERY_TYPE` mientras `upsell.pendingProductId` este activo,
para que solo se haga una pregunta a la vez.
