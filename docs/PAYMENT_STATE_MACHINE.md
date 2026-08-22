# Payment State Machine

Fecha: August 22, 2026

## Estados

- `PENDING`
- `REPORTED`
- `PROCESSING`
- `AUTHORIZED`
- `PAID`
- `FAILED`
- `CANCELLED`
- `PARTIALLY_REFUNDED`
- `REFUNDED`

## Reglas

- `PENDING -> FAILED` es valido.
- `PENDING/PROCESSING/AUTHORIZED -> PAID` es valido.
- un evento viejo no puede degradar `PAID -> PROCESSING`.
- `PAID -> PARTIALLY_REFUNDED -> REFUNDED` es valido.
- `orders.paymentStatus` no se marca `PAID` si `netPaidAmount < order.total`.

## Casos manuales

- transferencia con comprobante: `REPORTED`
- confirmacion operativa: `PAID`
- cash on delivery: `PENDING` hasta cobro real

## Casos con discrepancia

Si el proveedor reporta monto o moneda distinta:

- se registra issue de conciliacion
- no se corrige dinero silenciosamente
