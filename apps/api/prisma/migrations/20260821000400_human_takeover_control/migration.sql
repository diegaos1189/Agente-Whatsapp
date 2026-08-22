ALTER TABLE "conversations"
ADD COLUMN "assignedAdminUserId" TEXT,
ADD COLUMN "takenAt" TIMESTAMP(3);

ALTER TABLE "messages"
ADD COLUMN "senderType" TEXT,
ADD COLUMN "adminUserId" TEXT;

ALTER TABLE "handoffs"
ADD COLUMN "requestedByAdminUserId" TEXT,
ADD COLUMN "resolvedByAdminUserId" TEXT;

CREATE TABLE "conversation_audit_events" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "adminUserId" TEXT,
    "eventType" TEXT NOT NULL,
    "reason" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "messages_adminUserId_idx" ON "messages"("adminUserId");
CREATE INDEX "conversation_audit_events_conversationId_createdAt_idx" ON "conversation_audit_events"("conversationId", "createdAt");

ALTER TABLE "conversations"
ADD CONSTRAINT "conversations_assignedAdminUserId_fkey"
FOREIGN KEY ("assignedAdminUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "messages"
ADD CONSTRAINT "messages_adminUserId_fkey"
FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "handoffs"
ADD CONSTRAINT "handoffs_requestedByAdminUserId_fkey"
FOREIGN KEY ("requestedByAdminUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "handoffs"
ADD CONSTRAINT "handoffs_resolvedByAdminUserId_fkey"
FOREIGN KEY ("resolvedByAdminUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "conversation_audit_events"
ADD CONSTRAINT "conversation_audit_events_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "conversation_audit_events"
ADD CONSTRAINT "conversation_audit_events_adminUserId_fkey"
FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
