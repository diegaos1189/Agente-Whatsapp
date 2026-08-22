# Configuracion de WhatsApp Cloud API (Meta)

El proyecto arranca en modo `mock` (`WHATSAPP_PROVIDER=mock` en `apps/api/.env`): no necesitas credenciales reales para desarrollar. Los mensajes salientes solo se loguean y se guardan en base de datos.

Cuando tengas numero real, sigue esto para pasar a modo `meta`.

## 1. Cuenta y app en Meta

1. Crea cuenta en [Meta Business Suite](https://business.facebook.com) si no tienes.
2. Ve a [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create App → tipo "Business"**.
3. En el dashboard de la app: **Add Product → WhatsApp → Set up**.
4. Meta te da automaticamente un **numero de prueba gratis**, un `Phone Number ID`, un `WhatsApp Business Account ID` y un **Temporary Access Token** (dura 24h) — sirve para desarrollar sin numero propio.

## 2. Variables de entorno

En `apps/api/.env`:

```
WHATSAPP_PROVIDER=meta
WHATSAPP_API_VERSION=v21.0
WHATSAPP_PHONE_NUMBER_ID=<Phone Number ID de Meta>
WHATSAPP_TOKEN=<token de acceso>
WHATSAPP_VERIFY_TOKEN=<un string que inventes tu>
```

Para produccion, el token temporal de 24h no sirve — genera un **token permanente** creando un System User en Meta Business Settings y asignandole el activo de WhatsApp.

## 3. Configurar el webhook

1. Necesitas una URL publica HTTPS que apunte a `apps/api`:
   - Desarrollo local: `ngrok http 4000` (o similar) y usa la URL que te da, agregando `/webhooks/whatsapp`.
   - Produccion (Railway u otro): la URL publica del servicio, con `/webhooks/whatsapp`.
2. En el panel de Meta (WhatsApp → Configuration → Webhook): pon esa URL y el mismo `WHATSAPP_VERIFY_TOKEN` que pusiste en tu `.env`.
3. Meta hace un `GET` a `/webhooks/whatsapp` con `hub.mode=subscribe` para verificar — el endpoint ya esta implementado en `apps/api/src/routes/whatsapp.webhook.ts`.
4. Suscribe el campo **`messages`**.

## 4. Probar

- Envio saliente de prueba (reemplaza valores):

```bash
curl -X POST "https://graph.facebook.com/v21.0/<PHONE_NUMBER_ID>/messages" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"messaging_product":"whatsapp","to":"<TU_NUMERO>","type":"template","template":{"name":"hello_world","language":{"code":"en_US"}}}'
```

- Mensaje entrante: escribe desde un numero verificado como destinatario de prueba (maximo 5 en el tier gratis) al numero de WhatsApp — debe llegar el POST al webhook y el bot debe responder.

## Limitaciones del numero de prueba

- Token expira cada 24h (regenerar manual o usar System User token permanente).
- Solo puede recibir mensajes de hasta 5 numeros verificados como destinatarios de prueba.
- Ideal para desarrollo y QA antes de tener el numero real de produccion aprobado.
