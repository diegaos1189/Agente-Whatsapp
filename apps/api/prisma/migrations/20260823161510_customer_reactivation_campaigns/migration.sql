-- AlterTable
ALTER TABLE "business_settings" ADD COLUMN     "reactivationCooldownDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "reactivationDormantDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "reactivationEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reactivationTemplateLanguage" TEXT NOT NULL DEFAULT 'es_CO',
ADD COLUMN     "reactivationTemplateName" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "marketingOptInAt" TIMESTAMP(3),
ADD COLUMN     "marketingOptInSource" TEXT,
ADD COLUMN     "marketingOptOutAt" TIMESTAMP(3),
ADD COLUMN     "marketingOptOutReason" TEXT;

-- AlterTable
ALTER TABLE "payment_refunds" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "customer_reactivation_campaigns" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "templateName" TEXT NOT NULL,
    "templateLanguage" TEXT NOT NULL,
    "dormantDays" INTEGER NOT NULL,
    "lastOrderAt" TIMESTAMP(3) NOT NULL,
    "providerMessageId" TEXT,
    "skipReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "convertedOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_reactivation_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_reactivation_campaigns_contactId_createdAt_idx" ON "customer_reactivation_campaigns"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "customer_reactivation_campaigns_status_createdAt_idx" ON "customer_reactivation_campaigns"("status", "createdAt");

-- CreateIndex
CREATE INDEX "payments_orderId_createdAt_idx" ON "payments"("orderId", "createdAt");

-- AddForeignKey
ALTER TABLE "customer_reactivation_campaigns" ADD CONSTRAINT "customer_reactivation_campaigns_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
