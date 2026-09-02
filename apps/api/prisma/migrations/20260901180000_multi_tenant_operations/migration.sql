-- Multi-tenant, fase 2: la operacion completa pasa a estar acotada por restaurante.
--
-- La fase 1 separo catalogo y configuracion. Faltaba lo que el negocio ve todos los dias:
-- contactos, conversaciones, pedidos, promociones, FAQs y reglas de recomendacion. Sin esto,
-- el panel de un cliente nuevo mostraria los pedidos y los chats de otro.
--
-- Igual que en la fase 1: no se borra ni se altera ningun dato de negocio, solo se agrega la
-- columna y se rellena. Todo lo que ya existe es del restaurante de este deployment.

-- 1) Red de seguridad: si hay operacion que reasignar, el restaurante local tiene que existir.
--    (Normalmente ya lo creo la migracion de la fase 1; esto cubre bases que llegaron aca
--    con contactos pero sin catalogo ni configuracion.)
DO $$
DECLARE
  base_slug TEXT;
  final_slug TEXT;
  bs RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM platform_restaurants WHERE id = 'local-deployment') THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM contacts)
     AND NOT EXISTS (SELECT 1 FROM promotions)
     AND NOT EXISTS (SELECT 1 FROM faqs)
     AND NOT EXISTS (SELECT 1 FROM product_recommendations) THEN
    RETURN;
  END IF;

  SELECT * INTO bs FROM business_settings LIMIT 1;

  base_slug := regexp_replace(lower(COALESCE(bs."restaurantName", 'restaurante')), '[^a-z0-9]+', '', 'g');
  IF base_slug = '' OR base_slug IS NULL THEN
    base_slug := 'restaurante';
  END IF;

  final_slug := base_slug;
  FOR i IN 2..50 LOOP
    EXIT WHEN NOT EXISTS (SELECT 1 FROM platform_restaurants WHERE slug = final_slug);
    final_slug := base_slug || i::text;
  END LOOP;

  INSERT INTO platform_restaurants
    (id, name, slug, city, address, "ownerPhone", "ownerEmail", currency, status, "createdAt", "updatedAt")
  VALUES
    ('local-deployment',
     COALESCE(bs."restaurantName", 'Mi restaurante'),
     final_slug,
     '',
     COALESCE(bs.address, ''),
     COALESCE(bs.phone, ''),
     '',
     COALESCE(bs.currency, 'COP'),
     'ACTIVE',
     now(),
     now());
END $$;

-- 2) contacts: el telefono deja de ser unico global y pasa a ser unico por restaurante. El
--    mismo celular puede escribirle a dos negocios de la plataforma sin pisarse el historial.
ALTER TABLE "contacts" ADD COLUMN "restaurantId" TEXT;
UPDATE "contacts" SET "restaurantId" = 'local-deployment' WHERE "restaurantId" IS NULL;
ALTER TABLE "contacts" ALTER COLUMN "restaurantId" SET NOT NULL;

DROP INDEX IF EXISTS "contacts_phone_key";
CREATE UNIQUE INDEX "contacts_restaurantId_phone_key" ON "contacts"("restaurantId", "phone");
CREATE INDEX "contacts_restaurantId_idx" ON "contacts"("restaurantId");

-- 3) conversations y orders: se heredan del contacto (que ya quedo asignado arriba), no de
--    un literal, para que la columna sea consistente con la relacion desde el primer dia.
ALTER TABLE "conversations" ADD COLUMN "restaurantId" TEXT;
UPDATE "conversations" c SET "restaurantId" = ct."restaurantId" FROM "contacts" ct WHERE ct.id = c."contactId";
UPDATE "conversations" SET "restaurantId" = 'local-deployment' WHERE "restaurantId" IS NULL;
ALTER TABLE "conversations" ALTER COLUMN "restaurantId" SET NOT NULL;
CREATE INDEX "conversations_restaurantId_status_lastMessageAt_idx"
  ON "conversations"("restaurantId", "status", "lastMessageAt");

ALTER TABLE "orders" ADD COLUMN "restaurantId" TEXT;
UPDATE "orders" o SET "restaurantId" = ct."restaurantId" FROM "contacts" ct WHERE ct.id = o."contactId";
UPDATE "orders" SET "restaurantId" = 'local-deployment' WHERE "restaurantId" IS NULL;
ALTER TABLE "orders" ALTER COLUMN "restaurantId" SET NOT NULL;
CREATE INDEX "orders_restaurantId_createdAt_idx" ON "orders"("restaurantId", "createdAt");
CREATE INDEX "orders_restaurantId_status_idx" ON "orders"("restaurantId", "status");

-- 4) Configuracion de contenido del agente: promociones, FAQs y reglas de recomendacion.
ALTER TABLE "promotions" ADD COLUMN "restaurantId" TEXT;
UPDATE "promotions" SET "restaurantId" = 'local-deployment' WHERE "restaurantId" IS NULL;
ALTER TABLE "promotions" ALTER COLUMN "restaurantId" SET NOT NULL;
CREATE INDEX "promotions_restaurantId_idx" ON "promotions"("restaurantId");

ALTER TABLE "faqs" ADD COLUMN "restaurantId" TEXT;
UPDATE "faqs" SET "restaurantId" = 'local-deployment' WHERE "restaurantId" IS NULL;
ALTER TABLE "faqs" ALTER COLUMN "restaurantId" SET NOT NULL;
CREATE INDEX "faqs_restaurantId_idx" ON "faqs"("restaurantId");

ALTER TABLE "product_recommendations" ADD COLUMN "restaurantId" TEXT;
UPDATE "product_recommendations" pr SET "restaurantId" = p."restaurantId"
  FROM "products" p WHERE p.id = pr."recommendedProductId";
UPDATE "product_recommendations" SET "restaurantId" = 'local-deployment' WHERE "restaurantId" IS NULL;
ALTER TABLE "product_recommendations" ALTER COLUMN "restaurantId" SET NOT NULL;
CREATE INDEX "product_recommendations_restaurantId_idx" ON "product_recommendations"("restaurantId");

-- 5) admin_users: nullable a proposito. Los usuarios que ya existen son los del dueño de la
--    plataforma (entran a /super-admin y al panel de cualquier cliente); los que se creen
--    para un restaurante quedan atados a el y no pueden salirse de su panel.
ALTER TABLE "admin_users" ADD COLUMN "restaurantId" TEXT;
CREATE INDEX "admin_users_restaurantId_idx" ON "admin_users"("restaurantId");

-- 6) Llaves foraneas. Borrar un restaurante se lleva su operacion completa (igual que su
--    catalogo en la fase 1): es lo que se espera al dar de baja a un cliente.
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "platform_restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "platform_restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "platform_restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "platform_restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "faqs" ADD CONSTRAINT "faqs_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "platform_restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_recommendations" ADD CONSTRAINT "product_recommendations_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "platform_restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "platform_restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
