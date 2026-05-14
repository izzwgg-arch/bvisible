-- CreateEnum
CREATE TYPE "EmailIngestStatus" AS ENUM ('PENDING', 'MATCHED', 'UNMATCHED', 'FAILED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "EmailMatchReason" AS ENUM ('QBO_NUMBER', 'PO_NUMBER', 'VENDOR_AND_RECENT', 'MANUAL', 'NONE');

-- AlterEnum
ALTER TYPE "POAttachmentKind" ADD VALUE 'EMAIL_ATTACHMENT';

-- AlterEnum
ALTER TYPE "POEventKind" ADD VALUE 'VENDOR_REPLY';

-- AlterTable
ALTER TABLE "po_attachments" ADD COLUMN     "sourceEmailId" TEXT;

-- AlterTable
ALTER TABLE "po_events" ADD COLUMN     "sourceEmailId" TEXT;

-- CreateTable
CREATE TABLE "tenant_email_inboxes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "secure" BOOLEAN NOT NULL DEFAULT true,
    "mailbox" TEXT NOT NULL DEFAULT 'INBOX',
    "username" TEXT NOT NULL,
    "passwordCipher" TEXT NOT NULL,
    "pollIntervalSeconds" INTEGER NOT NULL DEFAULT 60,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastPolledAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_email_inboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingested_emails" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "fromName" TEXT,
    "toAddress" TEXT,
    "subject" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "status" "EmailIngestStatus" NOT NULL DEFAULT 'PENDING',
    "matchReason" "EmailMatchReason" NOT NULL DEFAULT 'NONE',
    "matchedPurchaseOrderId" TEXT,
    "matchedVendorId" TEXT,
    "matchHint" TEXT,
    "bodyTextSnippet" TEXT,
    "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "attachmentCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "retriedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingested_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingested_email_attachments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ingestedEmailId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "skipReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingested_email_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_ingest_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "scannedCount" INTEGER NOT NULL DEFAULT 0,
    "ingestedCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "email_ingest_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_email_inboxes_tenantId_key" ON "tenant_email_inboxes"("tenantId");

-- CreateIndex
CREATE INDEX "ingested_emails_tenantId_status_createdAt_idx" ON "ingested_emails"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ingested_emails_tenantId_matchedPurchaseOrderId_idx" ON "ingested_emails"("tenantId", "matchedPurchaseOrderId");

-- CreateIndex
CREATE INDEX "ingested_emails_tenantId_fromAddress_createdAt_idx" ON "ingested_emails"("tenantId", "fromAddress", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ingested_emails_tenantId_messageId_key" ON "ingested_emails"("tenantId", "messageId");

-- CreateIndex
CREATE INDEX "ingested_email_attachments_tenantId_ingestedEmailId_idx" ON "ingested_email_attachments"("tenantId", "ingestedEmailId");

-- CreateIndex
CREATE INDEX "ingested_email_attachments_sha256_idx" ON "ingested_email_attachments"("sha256");

-- CreateIndex
CREATE INDEX "email_ingest_runs_tenantId_startedAt_idx" ON "email_ingest_runs"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "po_attachments_sourceEmailId_idx" ON "po_attachments"("sourceEmailId");

-- CreateIndex
CREATE INDEX "po_events_sourceEmailId_idx" ON "po_events"("sourceEmailId");

-- AddForeignKey
ALTER TABLE "po_attachments" ADD CONSTRAINT "po_attachments_sourceEmailId_fkey" FOREIGN KEY ("sourceEmailId") REFERENCES "ingested_emails"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_events" ADD CONSTRAINT "po_events_sourceEmailId_fkey" FOREIGN KEY ("sourceEmailId") REFERENCES "ingested_emails"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_email_inboxes" ADD CONSTRAINT "tenant_email_inboxes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingested_emails" ADD CONSTRAINT "ingested_emails_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingested_emails" ADD CONSTRAINT "ingested_emails_matchedPurchaseOrderId_fkey" FOREIGN KEY ("matchedPurchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingested_emails" ADD CONSTRAINT "ingested_emails_matchedVendorId_fkey" FOREIGN KEY ("matchedVendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingested_email_attachments" ADD CONSTRAINT "ingested_email_attachments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingested_email_attachments" ADD CONSTRAINT "ingested_email_attachments_ingestedEmailId_fkey" FOREIGN KEY ("ingestedEmailId") REFERENCES "ingested_emails"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_ingest_runs" ADD CONSTRAINT "email_ingest_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
