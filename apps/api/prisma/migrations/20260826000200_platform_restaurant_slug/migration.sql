-- AlterTable
ALTER TABLE "platform_restaurants" ADD COLUMN "slug" TEXT;

-- Backfill: slug desde el nombre (minusculas, solo a-z0-9), ej "Dely Combos" -> "delycombos"
UPDATE "platform_restaurants" SET "slug" = regexp_replace(lower("name"), '[^a-z0-9]+', '', 'g');
UPDATE "platform_restaurants" SET "slug" = 'restaurante' WHERE "slug" = '' OR "slug" IS NULL;

-- Nombres repetidos: se les agrega un sufijo del id para poder crear el indice unico
UPDATE "platform_restaurants" p
SET "slug" = p."slug" || '-' || substr(p."id", greatest(length(p."id") - 5, 1))
WHERE EXISTS (
  SELECT 1 FROM "platform_restaurants" q
  WHERE q."slug" = p."slug" AND q."id" < p."id"
);

ALTER TABLE "platform_restaurants" ALTER COLUMN "slug" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "platform_restaurants_slug_key" ON "platform_restaurants"("slug");
