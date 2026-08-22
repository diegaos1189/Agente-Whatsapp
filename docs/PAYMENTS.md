# Payments

Fecha: August 22, 2026

## Objetivo

Separar `Order` de `Payment`.

Un pedido puede existir sin estar pagado.

Un pago puede quedar:

- `PENDING`
- `REPORTED`
- `PROCESSING`
- `AUTHORIZED`
- `PAID`
- `FAILED`
- `CANCELLED`
- `PARTIALLY_REFUNDED`
- `REFUNDED`

## Flujo base

Order
-> PaymentService
-> PaymentProvider
-> Webhook / confirmacion manual
-> actualizacion de Payment
-> proyeccion segura a `orders.paymentStatus`

## Modelo

`payments` ahora guarda:

- provider
- method
- amount
- currency
- idempotencyKey
- checkoutVersion
- providerPaymentId
- providerReference
- paidAmount
- refundedAmount
- paymentUrl
- expiresAt
- timestamps financieros

`orders.paymentStatus` queda como resumen derivado para panel y flujos conversacionales.

## Alcance actual

- proveedor `MOCK` para pagos online de prueba
- proveedor `MANUAL` para efectivo, transferencia y confirmaciones operativas
- refunds parciales y totales
- webhook idempotente
- conciliacion basica de pagos pendientes antiguos

## Limitaciones actuales

- no hay settlement bancario
- no hay almacenamiento de tarjetas
- no hay multi-tenant real dentro de la misma base
- no existe modulo real de caja/movimientos financieros en este repositorio
