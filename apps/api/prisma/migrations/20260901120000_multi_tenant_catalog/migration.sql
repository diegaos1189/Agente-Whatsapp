-- Multi-tenant, fase 1: el catalogo (categorias + productos) y la configuracion del negocio
-- pasan a estar acotados por restaurante. Todo lo que ya existe en esta base pertenece al
-- restaurante que corre en este deployment, asi que se le asigna a "local-deployment".
--
-- No borra ni modifica ningun dato de negocio: solo agrega la columna y la rellena.

-- 1) El restaurante "local-deployment" tiene que existir antes de apuntarle nada. Normalmente
--    ya esta (lo registra la API al abrir /super-admin/restaurantes); esto es la red de
--    seguridad para deployments que todavia no pasaron por esa pantalla.
DO $$
DECLARE
  base_slug TEXT;
  final_slug TEXT;
  bs RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM platform_restaurants WHERE id = 'local-deployment') THEN
    RETURN;
  END IF;

  -- Si no hay nada que reasignar, no hace falta inventar un restaurante.
  IF NOT EXISTS (SELECT 1 FROM business_settings)
     AND NOT EXISTS (SELECT 1 FROM categories)
     AND NOT EXISTS (SELECT 1 FROM products) THEN
    RETURN;
  END IF;

  SELECT * INTO bs FROM business_settings LIMIT 1;

  base_slug := regexp_replace(lower(COALESCE(bs."restaurantName", 'restaurante')), '[^a-z0-9]+', '', 'g');
  IF base_slug = '' THEN
    base_slug := 'restaurante';
  END IF;

  -- Mismo criterio que uniqueSlug() en la API: si el slug esta tomado, se numera.
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

-- 2) business_settings: una fila por restaurante. La invariante del sistema es que hay
--    exactamente una (getBusinessSettings usa findFirst); si hubiera mas, se corta aqui con
--    un mensaje claro en vez de reventar despues con una violacion de indice unico.
DO $$
DECLARE
  total INT;
BEGIN
  SELECT count(*) INTO total FROM business_settings;
  IF total > 1 THEN
    RAISE EXCEPTION 'business_settings tiene % filas y se esperaba maximo 1. Deja solo la que usa el negocio antes de migrar.', total;
  END IF;
END $$;

ALTER TABLE "business_settings" ADD COLUMN "restaurantId" TEXT;
UPDATE "business_settings" SET "restaurantId" = 'local-deployment' WHERE "restaurantId" IS NULL;
ALTER TABLE "business_settings" ALTER COLUMN "restaurantId" SET NOT NULL;

-- 3) categories: el slug deja de ser unico global y pasa a ser unico por restaurante.
ALTER TABLE "categories" ADD COLUMN "restaurantId" TEXT;
UPDATE "categories" SET "restaurantId" = 'local-deployment' WHERE "restaurantId" IS NULL;
ALTER TABLE "categories" ALTER COLUMN "restaurantId" SET NOT NULL;

DROP INDEX IF EXISTS "categories_slug_key";

-- 4) products
ALTER TABLE "products" ADD COLUMN "restaurantId" TEXT;
UPDATE "products" SET "restaurantId" = 'local-deployment' WHERE "restaurantId" IS NULL;
ALTER TABLE "products" ALTER COLUMN "restaurantId" SET NOT NULL;

-- 5) Indices y llaves foraneas
CREATE UNIQUE INDEX "business_settings_restaurantId_key" ON "business_settings"("restaurantId");
CREATE UNIQUE INDEX "categories_restaurantId_slug_key" ON "categories"("restaurantId", "slug");
CREATE INDEX "categories_restaurantId_idx" ON "categories"("restaurantId");
CREATE INDEX "products_restaurantId_idx" ON "products"("restaurantId");

ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "platform_restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "categories" ADD CONSTRAINT "categories_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "platform_restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_restaurantId_fkey"
  FOREIGN KEY ("restaurantId") REFERENCES "platform_restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
