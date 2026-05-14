-- Phase 13: local OCR + structured receipt candidates + human review foundation.
-- OCR output is never authoritative until operator confirms (application-enforced).

CREATE TYPE "OcrJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'REVIEW_REQUIRED', 'CONFIRMED', 'REJECTED', 'FAILED');

ALTER TYPE "VendorPriceExtractionMethod" ADD VALUE 'OCR_TEXT_REGEX';
ALTER TYPE "VendorPriceExtractionMethod" ADD VALUE 'OCR_APPROVED';

CREATE TABLE "ocr_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "OcrJobStatus" NOT NULL DEFAULT 'PENDING',
    "poAttachmentId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" VARCHAR(400),
    "lockedUntil" TIMESTAMP(3),
    "engineLabel" VARCHAR(80) NOT NULL DEFAULT 'tesseract.js',
    "rawTextCharCount" INTEGER,
    "rawTextSnippet" VARCHAR(8000),
    "vendorNameGuess" VARCHAR(500),
    "invoiceNumberGuess" VARCHAR(120),
    "receiptNumberGuess" VARCHAR(120),
    "subtotalCentsGuess" INTEGER,
    "taxCentsGuess" INTEGER,
    "totalCentsGuess" INTEGER,
    "documentDateGuess" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "reviewNotes" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ocr_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ocr_documents_poAttachmentId_key" ON "ocr_documents"("poAttachmentId");

CREATE INDEX "ocr_documents_tenantId_status_createdAt_idx" ON "ocr_documents"("tenantId", "status", "createdAt");

ALTER TABLE "ocr_documents" ADD CONSTRAINT "ocr_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ocr_documents" ADD CONSTRAINT "ocr_documents_poAttachmentId_fkey" FOREIGN KEY ("poAttachmentId") REFERENCES "po_attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ocr_documents" ADD CONSTRAINT "ocr_documents_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ocr_documents" ADD CONSTRAINT "ocr_documents_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ocr_line_items" (
    "id" TEXT NOT NULL,
    "ocrDocumentId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "rawLineText" VARCHAR(2000) NOT NULL,
    "itemLabelNormalized" VARCHAR(400),
    "quantityMilliGuess" INTEGER,
    "unitPriceCentsGuess" INTEGER,
    "confidence" "VendorPriceConfidence" NOT NULL DEFAULT 'LOW',
    "extractionSource" VARCHAR(80) NOT NULL,
    "mappedVendorCatalogItemId" TEXT,

    CONSTRAINT "ocr_line_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ocr_line_items_ocrDocumentId_sortOrder_idx" ON "ocr_line_items"("ocrDocumentId", "sortOrder");

ALTER TABLE "ocr_line_items" ADD CONSTRAINT "ocr_line_items_ocrDocumentId_fkey" FOREIGN KEY ("ocrDocumentId") REFERENCES "ocr_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ocr_line_items" ADD CONSTRAINT "ocr_line_items_mappedVendorCatalogItemId_fkey" FOREIGN KEY ("mappedVendorCatalogItemId") REFERENCES "vendor_catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vendor_price_histories" DROP CONSTRAINT "vendor_price_histories_sourceEmailId_fkey";

ALTER TABLE "vendor_price_histories" ALTER COLUMN "sourceEmailId" DROP NOT NULL;

ALTER TABLE "vendor_price_histories" ADD COLUMN "sourcePoAttachmentId" TEXT,
ADD COLUMN "ocrLineItemId" TEXT;

CREATE UNIQUE INDEX "vendor_price_histories_ocrLineItemId_key" ON "vendor_price_histories"("ocrLineItemId");

ALTER TABLE "vendor_price_histories" ADD CONSTRAINT "vendor_price_histories_sourceEmailId_fkey" FOREIGN KEY ("sourceEmailId") REFERENCES "ingested_emails"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vendor_price_histories" ADD CONSTRAINT "vendor_price_histories_sourcePoAttachmentId_fkey" FOREIGN KEY ("sourcePoAttachmentId") REFERENCES "po_attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vendor_price_histories" ADD CONSTRAINT "vendor_price_histories_ocrLineItemId_fkey" FOREIGN KEY ("ocrLineItemId") REFERENCES "ocr_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vendor_price_notifications" DROP CONSTRAINT "vendor_price_notifications_sourceEmailId_fkey";

ALTER TABLE "vendor_price_notifications" ALTER COLUMN "sourceEmailId" DROP NOT NULL;

ALTER TABLE "vendor_price_notifications" ADD COLUMN "sourceOcrDocumentId" TEXT;

ALTER TABLE "vendor_price_notifications" ADD CONSTRAINT "vendor_price_notifications_sourceEmailId_fkey" FOREIGN KEY ("sourceEmailId") REFERENCES "ingested_emails"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vendor_price_notifications" ADD CONSTRAINT "vendor_price_notifications_sourceOcrDocumentId_fkey" FOREIGN KEY ("sourceOcrDocumentId") REFERENCES "ocr_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "vendor_price_notifications_sourceOcrDocumentId_idx" ON "vendor_price_notifications"("sourceOcrDocumentId");
