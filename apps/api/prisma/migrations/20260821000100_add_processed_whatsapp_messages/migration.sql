-- CreateTable
CREATE TABLE "processed_whatsapp_messages" (
    "id" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "fromPhone" TEXT NOT NULL,
    "inboundType" TEXT NOT NULL,
    "providerTimestamp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "processed_whatsapp_messages_providerMessageId_key" ON "processed_whatsapp_messages"("providerMessageId");

-- CreateIndex
CREATE INDEX "processed_whatsapp_messages_createdAt_idx" ON "processed_whatsapp_messages"("createdAt");
