ALTER TABLE "contacts"
ADD COLUMN "cartRecoveryOptOutAt" TIMESTAMP(3),
ADD COLUMN "cartRecoveryOptOutReason" TEXT;

ALTER TABLE "business_settings"
ADD COLUMN "cartRecoveryEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "cartRecoveryDelayMinutes" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN "cartRecoveryMaxAttempts" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "cartRecoveryMessage" TEXT NOT NULL DEFAULT 'Hola 👋 Dejaste un pedido pendiente. Si quieres, seguimos desde donde quedamos.';

CREATE TABLE "cart_recoveries" (
  "id" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "cartFingerprint" TEXT NOT NULL,
  "scheduledCheckAt" TIMESTAMP(3) NOT NULL,
  "lastCustomerMessageAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "reminderSentAt" TIMESTAMP(3),
  "resumedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "convertedOrderId" TEXT,
  "notEligibleReason" TEXT,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "lastEvaluatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "cart_recoveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cart_recoveries_status_scheduledCheckAt_idx" ON "cart_recoveries"("status", "scheduledCheckAt");
CREATE INDEX "cart_recoveries_conversationId_updatedAt_idx" ON "cart_recoveries"("conversationId", "updatedAt");
CREATE INDEX "cart_recoveries_contactId_createdAt_idx" ON "cart_recoveries"("contactId", "createdAt");

ALTER TABLE "cart_recoveries"
ADD CONSTRAINT "cart_recoveries_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cart_recoveries"
ADD CONSTRAINT "cart_recoveries_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
