# Payment Reconciliation

Fecha: August 22, 2026

## Objetivo

Detectar diferencias entre estado interno y estado reportado por proveedor.

## Tabla

`payment_reconciliation_issues`

## Issues actuales

- `MISSING_PROVIDER_PAYMENT`
- `AMOUNT_MISMATCH`
- `CURRENCY_MISMATCH`
- `INTERNAL_PENDING_PROVIDER_UNKNOWN`
- `INTERNAL_PENDING_PROVIDER_PAID`

## Proceso

`reconcilePayments()` revisa pagos viejos en:

- `PENDING`
- `PROCESSING`
- `AUTHORIZED`

y genera issues de revision.

## Politica

- no corregir automaticamente casos riesgosos
- dejar trazabilidad para revision humana
- permitir automatizacion futura solo si el proveedor real da evidencia inequívoca
