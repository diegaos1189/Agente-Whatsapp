ALTER TABLE "payments"
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'COP',
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "checkoutVersion" INTEGER,
  ADD COLUMN "providerPaymentId" TEXT,
  ADD COLUMN "providerReference" TEXT,
  ADD COLUMN "externalReference" TEXT,
  ADD COLUMN "paidAmount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "refundedAmount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "paymentUrl" TEXT,
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "failureCode" TEXT,
  ADD COLUMN "failureMessage" TEXT,
  ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "authorizedAt" TIMESTAMP(3),
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "failedAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "payments"
SET
  "provider" = 'MANUAL',
  "currency" = 'COP',
  "providerReference" = COALESCE("providerReference", (
    SELECT "code" FROM "orders" WHERE "orders"."id" = "payments"."orderId"
  ));

CREATE UNIQUE INDEX "payments_provider_providerPaymentId_key"
  ON "payments"("provider", "providerPaymentId");

CREATE UNIQUE INDEX "payments_provider_idempotencyKey_key"
  ON "payments"("provider", "idempotencyKey");

CREATE INDEX "payments_status_createdAt_idx"
  ON "payments"("status", "createdAt");

CREATE INDEX "payments_provider_providerReference_idx"
  ON "payments"("provider", "providerReference");

CREATE TABLE "payment_refunds" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'COP',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" TEXT,
  "providerRefundId" TEXT,
  "reasonCode" TEXT,
  "requestedBy" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_refunds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_refunds_paymentId_idempotencyKey_key"
  ON "payment_refunds"("paymentId", "idempotencyKey");

CREATE INDEX "payment_refunds_paymentId_createdAt_idx"
  ON "payment_refunds"("paymentId", "createdAt");

ALTER TABLE "payment_refunds"
  ADD CONSTRAINT "payment_refunds_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payment_webhook_events" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT,
  "provider" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "providerReference" TEXT,
  "rawPayload" JSONB NOT NULL DEFAULT '{}',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_webhook_events_provider_eventId_key"
  ON "payment_webhook_events"("provider", "eventId");

CREATE INDEX "payment_webhook_events_provider_providerReference_idx"
  ON "payment_webhook_events"("provider", "providerReference");

ALTER TABLE "payment_webhook_events"
  ADD CONSTRAINT "payment_webhook_events_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "payment_reconciliation_issues" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT,
  "issueType" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'WARNING',
  "expectedAmount" INTEGER,
  "providerAmount" INTEGER,
  "expectedCurrency" TEXT,
  "providerCurrency" TEXT,
  "providerReference" TEXT,
  "note" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_reconciliation_issues_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_reconciliation_issues_issueType_createdAt_idx"
  ON "payment_reconciliation_issues"("issueType", "createdAt");

CREATE INDEX "payment_reconciliation_issues_paymentId_createdAt_idx"
  ON "payment_reconciliation_issues"("paymentId", "createdAt");

ALTER TABLE "payment_reconciliation_issues"
  ADD CONSTRAINT "payment_reconciliation_issues_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
