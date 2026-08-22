# PRODUCTION_READINESS_CHECKLIST

Fecha: August 21, 2026

## Estado general

- API: `READY WITH WARNINGS`
- Panel admin: `READY WITH WARNINGS`
- Multi-tenant real: `NOT READY`

## Checklist

### Migraciones

- Revisadas visualmente: si
- Cambios destructivos detectados en esta auditoria: no
- Rollback documentado: parcial
- Warning:
  - no hay tenant scope en schema actual

### Database backup

- Soporte de backup diario: si
- Verificacion operativa en este turno: no

### Variables de entorno

- API valida varias obligatorias: si
- Produccion bloquea defaults inseguros criticos desde esta auditoria: si
- `SESSION_SECRET` protegido en produccion: si
- Warning:
  - `WHATSAPP_APP_SECRET` aun no es obligatorio duro en produccion

### Webhook configuration

- Verify token: si
- Firma HMAC Meta: soportada
- Obligatoria en prod: no aun

### Rollback

- Codigo: si, revert de commit/cambios
- Variables de entorno: si
- Migraciones: requiere plan especifico por release

### Monitoring / logs

- Logging estructurado: si
- Audit trail de handoff/takeover: si
- Dashboard/alerting externo: no

### Health checks

- `/health` con DB/config minima: si

### Tests

- API tests: 178 pasando
- Golden Conversations: 30 pasando
- Invariantes: 6 pasando

### Build

- API build: ok
- Admin build: warning por issue local de Next/node_modules

### Lint

- API lint: debe ejecutarse antes de release
- Admin lint: debe ejecutarse antes de release

### Deployment

- No ejecutado en esta auditoria
- Requiere smoke test posterior

### Smoke test post deploy

- Recibir mensaje de texto
- Recibir audio
- Consultar estado
- Crear pedido
- Confirmar handoff
- Responder desde panel

## Rollback recomendado

1. Revertir codigo al release anterior.
2. Restaurar variables de entorno del release anterior.
3. Si hubo migraciones, ejecutar plan reversible aprobado previamente.
4. Verificar:
   - webhook 200
   - login panel
   - pedido simple
   - consulta de estado

## Bloqueadores actuales para llamar al sistema “fully ready”

1. El producto sigue siendo single-tenant en la practica.
2. No hay evidencia automatizada aun para todos los escenarios `AG`, `AH`, `Q`, `Z`.
3. El build local del admin sigue con problema de entorno preexistente.
