# Payment Refunds

Fecha: August 22, 2026

## Modelo

Los refunds viven en `payment_refunds`.

Guardan:

- paymentId
- amount
- currency
- status
- idempotencyKey
- providerRefundId
- reasonCode
- requestedBy
- completedAt

## Reglas

- no permitir `sum(refunds) > paidAmount`
- doble click con misma `idempotencyKey` reutiliza el mismo refund
- dos refunds concurrentes usan compare-and-set sobre `payments.refundedAmount`

## Efecto sobre Payment

- refund parcial -> `PARTIALLY_REFUNDED`
- refund total -> `REFUNDED`

## Limitaciones actuales

- no hay ledger de loyalty en este repositorio
- no hay modulo real de cash drawer para registrar salida fisica de caja
- no se permite cambiar automaticamente el medio original del refund
