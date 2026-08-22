-- CreateTable
CREATE TABLE "inbound_whatsapp_messages" (
    "id" BIGSERIAL NOT NULL,
    "waMessageId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "fromPhone" TEXT NOT NULL,
    "customerName" TEXT,
    "inboundType" TEXT NOT NULL,
    "text" TEXT,
    "mediaId" TEXT,
    "providerTimestamp" TEXT,
    "processingStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processingStartedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_message_processing_leases" (
    "contactId" TEXT NOT NULL,
    "leaseToken" TEXT NOT NULL,
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "processingState" TEXT NOT NULL,
    "currentMessageId" BIGINT,
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastFinishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_message_processing_leases_pkey" PRIMARY KEY ("contactId")
);

-- CreateIndex
CREATE UNIQUE INDEX "inbound_whatsapp_messages_waMessageId_key" ON "inbound_whatsapp_messages"("waMessageId");

-- CreateIndex
CREATE INDEX "inbound_whatsapp_messages_contactId_id_idx" ON "inbound_whatsapp_messages"("contactId", "id");

-- CreateIndex
CREATE INDEX "inbound_whatsapp_messages_contactId_processingStatus_id_idx" ON "inbound_whatsapp_messages"("contactId", "processingStatus", "id");

-- CreateIndex
CREATE INDEX "inbound_whatsapp_messages_processingStatus_leaseExpiresAt_idx" ON "inbound_whatsapp_messages"("processingStatus", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "contact_message_processing_leases_leaseExpiresAt_idx" ON "contact_message_processing_leases"("leaseExpiresAt");

-- AddForeignKey
ALTER TABLE "inbound_whatsapp_messages" ADD CONSTRAINT "inbound_whatsapp_messages_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_message_processing_leases" ADD CONSTRAINT "contact_message_processing_leases_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
