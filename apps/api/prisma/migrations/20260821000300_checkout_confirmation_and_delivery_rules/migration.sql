-- Checkout confirmation idempotency + delivery validation rules

ALTER TABLE "orders"
ADD COLUMN "confirmationId" TEXT;

CREATE UNIQUE INDEX "orders_confirmationId_key" ON "orders"("confirmationId");

ALTER TABLE "business_settings"
ADD COLUMN "acceptsDelivery" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "acceptsPickup" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "minimumDeliveryOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "deliveryCoverageKeywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
