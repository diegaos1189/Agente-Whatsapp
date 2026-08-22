# Checkout Flow

Fecha: August 21, 2026

## Objetivo

Garantizar que un pedido de WhatsApp no se cree hasta pasar por:

Cart
-> Validate
-> Price
-> Summary
-> Confirm
-> Revalidate
-> Create Order

## Flujo final

1. El cliente arma el carrito en `conversation.context.orderFlow` y, si aplica, en `conversation.context.activeCart`.
2. Cuando el flujo entra a `OrderFlowStep.CONFIRMING`, el backend prepara un snapshot de checkout:
   - valida disponibilidad, horario, delivery/pickup, cobertura, minimo y pago;
   - recalcula subtotal, descuento, delivery, tax y total desde backend;
   - genera `checkout.summary`, `checkout.version`, `checkout.cartFingerprint` y `checkout.confirmationId`.
3. La IA solo redacta el resumen ya calculado por backend.
4. Cuando el cliente confirma, el backend NO crea la orden inmediatamente:
   - revalida todo;
   - compara el carrito actual con `checkout.cartFingerprint`;
   - compara el resumen previo con los valores actuales.
5. Si algo cambio:
   - el checkout anterior queda obsoleto;
   - se genera un nuevo resumen/version;
   - se exige una nueva confirmacion explicita.
6. Si nada cambio:
   - se crea la orden con `confirmationId` unico;
   - la transaccion persiste pedido, items, pago y eventos;
   - despues se disparan notificaciones externas.

## Idempotencia de confirmacion

- La confirmacion de checkout se persiste como `orders.confirmationId`.
- Ese campo es unico.
- Si llega dos veces la misma confirmacion o dos procesos intentan crear la misma orden, solo una insercion gana.
- El segundo intento reutiliza la orden existente y no vuelve a notificar.

## Confirmaciones obsoletas

- El backend calcula `checkout.cartFingerprint` con carrito, activeCart, delivery, direccion y pago.
- Cualquier cambio relevante invalida el checkout previo.
- Si el cliente responde "si" a un resumen viejo, el backend detecta que el fingerprint o los montos ya no coinciden y no crea el pedido.

## Validaciones implementadas hoy

- local abierto segun `business_settings.openingHours`
- delivery habilitado / pickup habilitado
- direccion requerida para delivery
- cobertura por `deliveryCoverageKeywords` cuando se configure
- pedido minimo para delivery con `minimumDeliveryOrder`
- metodo de pago habilitado
- productos y componentes existentes/disponibles
- modificadores incompatibles
- precios/promociones/totales recalculados desde backend

## Limitaciones actuales del modelo

- No existe aun modelo de sucursales/tenant por sede.
- No existe aun modelo formal de grupos de modificadores con min/max/required.
- No existen horarios especiales/festivos en schema actual.

El checkout ya quedo preparado para extender esas validaciones sin reescribir el flujo.
