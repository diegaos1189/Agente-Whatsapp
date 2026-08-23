# Auditoria tecnica - 2026-08-22

## Resumen ejecutivo

El proyecto tiene una base solida:

- Monorepo ordenado (`apps/api`, `apps/admin`, `packages/shared`)
- Cobertura de pruebas backend amplia
- `304/304` pruebas pasando en `apps/api`
- Tipado TypeScript pasando en API y admin

Sin embargo, la revision encontro 3 problemas importantes:

1. Faltan controles de autorizacion por permiso en varios endpoints del backend.
2. El sistema de permisos del panel esta desalineado entre frontend y backend.
3. El build de produccion de `apps/admin` falla en Windows, bloqueando despliegues desde este entorno.

## Validaciones ejecutadas

- `pnpm -r test`
- `pnpm run lint`
- `pnpm run build`

Resultados:

- `pnpm -r test`: OK
- `pnpm run lint`: OK
- `pnpm run build`: FAIL en `apps/admin` con `EISDIR: illegal operation on a directory, readlink '...node_modules\\next\\dist\\pages\\_app.js'`

## Hallazgos

### 1. Control de acceso incompleto en APIs del panel

**Severidad:** Alta

El middleware de Next protege las rutas visuales del panel, pero el backend Fastify no aplica permisos finos en muchos endpoints de lectura y escritura. Un usuario autenticado puede invocar `/api/proxy/...` manualmente desde el navegador y acceder a modulos para los que no tiene permiso visual.

Ejemplos observados:

- `apps/api/src/routes/payments.ts`: el `GET /api/payments` no valida permiso `facturacion`
- `apps/api/src/routes/orders.ts`: `GET /api/orders` y `GET /api/orders/:id` no validan permisos
- `apps/api/src/routes/products.ts`: productos, categorias, promociones y recomendaciones no validan permisos
- `apps/api/src/routes/faqs.ts`: lectura y escritura sin validacion de permiso
- `apps/api/src/routes/settings.ts`: lectura y escritura sin validar que sea solo `ADMIN`
- `apps/api/src/routes/metrics.ts`: metricas sin validacion de permiso

**Impacto:**

- Exposicion de informacion sensible a usuarios `STAFF`
- Posibilidad de modificar catalogo, FAQs o configuracion si conocen el endpoint
- El control de seguridad queda en el frontend, no en el backend

**Recomendacion:**

- Centralizar autorizacion por permiso en Fastify
- Validar permisos en todos los endpoints `/api/*`, no solo en algunas mutaciones
- Tratar `settings` y `users` como recursos exclusivos de `ADMIN`

### 2. Desalineacion del catalogo de permisos entre frontend y backend

**Severidad:** Alta

El frontend reconoce 8 permisos:

- `metrics`
- `conversations`
- `orders`
- `products`
- `promotions`
- `faqs`
- `kitchen`
- `facturacion`

Pero el backend de usuarios solo conoce 5:

- `metrics`
- `conversations`
- `orders`
- `products`
- `promotions`

Referencias:

- `apps/admin/src/lib/authConstants.ts`
- `apps/api/src/modules/adminUsers/adminUserService.ts`
- `apps/api/src/routes/adminUsers.ts`

**Impacto:**

- No se pueden crear o editar correctamente usuarios `STAFF` con permisos para `faqs`, `kitchen` o `facturacion`
- El frontend muestra checks de permisos que el backend no soporta
- Un admin devuelto por el backend no refleja el mismo universo de permisos que usa el middleware del panel

**Recomendacion:**

- Mover `PERMISSION_KEYS` a `packages/shared`
- Hacer que admin y API importen la misma fuente
- Agregar pruebas para altas/ediciones de usuario con todos los permisos disponibles

### 3. Build de produccion roto en `apps/admin`

**Severidad:** Media-Alta

El comando `pnpm run build` falla hoy en este workspace:

`Error: EISDIR: illegal operation on a directory, readlink 'E:\agent whatsapp\node_modules\next\dist\pages\_app.js'`

Contexto relevante:

- `.npmrc` usa `node-linker=hoisted`
- `.npmrc` usa `symlink=false`
- existe un workaround manual en `scripts/sync-shared.mjs`

**Impacto:**

- El proyecto no esta listo para despliegue reproducible desde este entorno
- El problema no aparece en `tsc`, pero si en el build real de Next

**Recomendacion:**

- Probar una estrategia estable de instalacion para Next en Windows:
  - quitar `symlink=false` si el disco/entorno ya no lo requiere
  - evitar el copiado manual a `node_modules/@pollos/shared`
  - evaluar `node-linker=isolated` o instalacion no hoisted
- Ejecutar `next build` en CI Linux para confirmar si el problema es del entorno o del repo

## Mejoras prioritarias

### Prioridad 1

- Implementar middleware/autorizacion backend por permiso
- Unificar permisos en `packages/shared`
- Agregar pruebas de autorizacion por rol y permiso

### Prioridad 2

- Resolver el build de produccion de `apps/admin`
- Agregar pipeline CI con:
  - `pnpm run lint`
  - `pnpm -r test`
  - `pnpm run build`

### Prioridad 3

- Reducir uso de `any` en:
  - `contactMessageProcessingCoordinator.ts`
  - `cartRecoveryService.ts`
  - partes de `paymentService.ts`
- Reemplazar casts temporales por tipos Prisma generados o wrappers tipados

### Prioridad 4

- Revisar artefactos de texto con mojibake (`Ã`, `Â`) en mensajes y comentarios
- Estandarizar UTF-8 en todo el repo

## Aspectos positivos

- Cobertura funcional backend muy buena
- Modelado del dominio bastante completo para pedidos, handoff, pagos y recuperacion de carrito
- Separacion clara entre frontend admin, API y paquete compartido
- Buen uso de idempotencia y control de concurrencia en varias rutas criticas

## Conclusion

El sistema esta bien encaminado y tiene una base tecnica superior al promedio para este tipo de proyecto. Lo mas importante ahora no es rehacer arquitectura, sino cerrar la brecha de autorizacion backend, alinear permisos y dejar el build de `apps/admin` verdaderamente desplegable.
