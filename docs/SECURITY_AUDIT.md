# SECURITY_AUDIT

Fecha: August 21, 2026

## Alcance

Auditoria del codigo actual del agente, panel administrativo y rutas criticas. No se tocaron datos de produccion.

## Resumen ejecutivo

- Vulnerabilidades `CRITICAL` abiertas: 0
- Vulnerabilidades `HIGH` abiertas: 2
- Vulnerabilidades `MEDIUM` abiertas: 5
- Vulnerabilidades `LOW` abiertas: 5

## Hallazgos corregidos durante esta auditoria

### FIXED 2026-08-21 - Panel podia fallar abierto si faltaba `SESSION_SECRET`

Severidad original: `HIGH`

Hallazgo:

- `apps/admin/src/middleware.ts` dejaba pasar todo si `SESSION_SECRET` estaba vacio.
- En un despliegue mal configurado del panel esto podia degradar autenticacion.

Correccion:

- En desarrollo local se mantiene comportamiento flexible.
- En produccion ahora falla cerrado y redirige a login con error de configuracion.
- `apps/admin/src/app/api/login/route.ts` tambien rechaza login en produccion si falta `SESSION_SECRET`.

### FIXED 2026-08-21 - Produccion podia arrancar con secretos/tokens inseguros por defecto

Severidad original: `HIGH`

Hallazgo:

- `ADMIN_API_TOKEN`, `ADMIN_BOOTSTRAP_PASSWORD` y `WHATSAPP_VERIFY_TOKEN` tenian defaults inseguros sin bloqueo de produccion.

Correccion:

- `apps/api/src/config/env.ts` ahora aborta el arranque en produccion si detecta esos valores por defecto.

### FIXED 2026-08-21 - Healthcheck no validaba DB ni config critica

Severidad original: `MEDIUM`

Correccion:

- `GET /health` ahora verifica API, DB y estado basico de config WhatsApp.

## Hallazgos abiertos

### HIGH-01 - No existe aislamiento multi-tenant explicito

Estado: `OPEN`

Impacto:

- El schema actual no tiene `tenantId`.
- El sistema es efectivamente single-tenant hoy.
- Si se publicita o reutiliza como multi-tenant sin cambios estructurales, no hay aislamiento real entre tenants.

Riesgo:

- Acceso cruzado entre negocios en una futura evolucion multi-tenant.

Recomendacion:

- No declarar soporte multi-tenant hasta introducir `tenantId`, constraints, filtros obligatorios e indices por tenant.

### HIGH-02 - Backend admin confia en bearer compartido y headers reenviados por el panel

Estado: `OPEN`

Impacto:

- La API administrativa usa `ADMIN_API_TOKEN` compartido.
- La identidad del usuario final viaja en headers `x-admin-*` desde el proxy del panel.

Riesgo:

- Si el token de backend se filtra, un actor con acceso a red/API podria intentar operar rutas administrativas.

Mitigacion actual:

- El token no se expone al navegador.
- El proxy del panel vive server-side.
- La session del panel ahora exige `SESSION_SECRET` en produccion.

Recomendacion:

- Evolucionar a auth backend por usuario/sesion o JWT firmado server-to-server.

### MEDIUM-01 - Verificacion HMAC del webhook de Meta es opcional

Estado: `OPEN`

Impacto:

- Si `WHATSAPP_APP_SECRET` queda vacio en produccion, el webhook no verifica autenticidad.

Recomendacion:

- Tratarlo como obligatorio en produccion cuando `WHATSAPP_PROVIDER=meta`.

### MEDIUM-02 - Media de audio/imagen se guarda inline en `messages.mediaUrl`

Estado: `OPEN`

Impacto:

- Crecimiento de base de datos.
- Superficie de exposicion de datos media dentro de DB y panel.

Recomendacion:

- Migrar a almacenamiento externo firmado cuando el volumen lo justifique.

### MEDIUM-03 - No existe rate limiting especifico por webhook / telefono / login backend

Estado: `OPEN`

Impacto:

- Hay rate limit global y login panel, pero no un control especializado por telefono o por `waMessageId`.

Recomendacion:

- Agregar limites por IP + endpoint + telefono segun trafico real.

### MEDIUM-04 - El panel lee la sesion ya verificada, pero el proxy no re-verifica firma localmente

Estado: `ACCEPTED`

Contexto:

- Hoy pasa por middleware de Next antes de llegar al proxy, por lo que el riesgo esta mitigado.

Recomendacion:

- Mantener esa suposicion documentada y evitar excluir `/api/proxy` del matcher.

### MEDIUM-05 - No hay suite automatizada completa de prompt injection del cliente

Estado: `OPEN`

Impacto:

- Guardrails existen, pero la cobertura regresiva especifica aun es incompleta.

Recomendacion:

- Agregar tests `AG*` de la matriz.

### LOW-01 - `ADMIN_BOOTSTRAP_USERNAME` sigue teniendo default conocido

Estado: `OPEN`

Mitigacion:

- Solo aplica en bootstrap inicial.
- Password por defecto ya bloqueado en produccion.

### LOW-02 - Logs no estan redaccionados con una politica central de PII

Estado: `OPEN`

Observacion:

- No vi tokens/API keys logueados de forma obvia.
- Aun asi faltan redactors estructurados por campo.

### LOW-03 - `/health` expone estado de config resumido

Estado: `ACCEPTED`

Observacion:

- No expone secretos.
- Conviene mantenerlo solo con informacion minima.

### LOW-04 - No hay CSP/headers hardening revisados en detalle para el panel

Estado: `OPEN`

### LOW-05 - No existe evidencia de rotacion automatica de secretos

Estado: `OPEN`

## Revisiones especificas

### Autenticacion / autorizacion

- Panel:
  - cookie firmada por `SESSION_SECRET`
  - middleware con RBAC por rutas
- API:
  - bearer `ADMIN_API_TOKEN`
- Riesgo principal:
  - token compartido entre panel y backend

### Webhook signature

- Correcto cuando `WHATSAPP_APP_SECRET` esta configurado.
- Riesgo si se deja vacio en produccion.

### SQL injection

- Prisma reduce superficie de inyeccion SQL directa.
- No vi construccion manual riesgosa de queries.

### Input validation

- Amplio uso de Zod en rutas y payloads.
- Bueno en superficie critica.

### Uploads / audio

- Audio endurecido con MIME/tamano/timeout/retry.
- Persistencia inline aun es deuda operativa.

### Endpoints administrativos

- Hay RBAC de panel.
- La API confia en proxy + token.

## Conclusion

Estado de seguridad actual:

- `READY WITH WARNINGS` para despliegue single-tenant actual.
- `NOT READY` para una promesa real multi-tenant sin redisenar modelo/autorizacion.
