# Payment Webhooks

Fecha: August 22, 2026

## Endpoint actual

- `POST /webhooks/payments/mock`

## Verificacion

El proveedor `MOCK` usa firma HMAC por header:

- `x-payment-signature`

con secreto:

- `PAYMENT_MOCK_WEBHOOK_SECRET`

## Idempotencia

Los eventos se guardan en `payment_webhook_events` con llave unica:

- `provider + eventId`

Si el proveedor reenvia el mismo evento:

- no se reprocesa
- no se duplican efectos

## Resolucion del pago

Se intenta asociar el webhook por:

1. `paymentId`
2. `providerPaymentId`
3. `providerReference`

Si no existe pago interno:

- se registra `MISSING_PROVIDER_PAYMENT`

## Seguridad

- firma invalida -> `400`
- evento viejo no degrada estado final
- mismatch de amount/currency genera issue de conciliacion
