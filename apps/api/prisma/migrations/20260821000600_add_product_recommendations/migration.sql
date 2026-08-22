ALTER TABLE "business_settings"
ADD COLUMN "upsellEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "maxUpsellOffers" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "product_recommendations" (
  "id" TEXT NOT NULL,
  "sourceProductId" TEXT,
  "sourceCategoryId" TEXT,
  "recommendedProductId" TEXT NOT NULL,
  "recommendationType" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "product_recommendations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_recommendations_sourceProductId_idx" ON "product_recommendations"("sourceProductId");
CREATE INDEX "product_recommendations_sourceCategoryId_idx" ON "product_recommendations"("sourceCategoryId");

ALTER TABLE "product_recommendations"
ADD CONSTRAINT "product_recommendations_sourceProductId_fkey"
FOREIGN KEY ("sourceProductId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_recommendations"
ADD CONSTRAINT "product_recommendations_sourceCategoryId_fkey"
FOREIGN KEY ("sourceCategoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_recommendations"
ADD CONSTRAINT "product_recommendations_recommendedProductId_fkey"
FOREIGN KEY ("recommendedProductId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
