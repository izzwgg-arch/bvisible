-- CreateEnum
CREATE TYPE "EstimateType" AS ENUM ('CUSTOM', 'STOCK_ITEM', 'SQUARE_FOOTAGE');

-- CreateEnum
CREATE TYPE "EstimateTimelineKind" AS ENUM ('QUOTE_ACCEPTED', 'QUOTE_DECLINED', 'INVOICE_CREATED_FROM_ESTIMATE');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('UNPAID', 'PAID', 'VOIDED');

-- CreateEnum
CREATE TYPE "ShopCatalogUnit" AS ENUM ('EACH', 'SHEET', 'SQ_FT', 'HOUR', 'LINEAR_FT', 'ROLL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "OcrJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'REVIEW_REQUIRED', 'CONFIRMED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "POReconciliationStatus" AS ENUM ('PENDING', 'PARTIAL', 'MATCHED', 'VARIANCE', 'REVIEW_REQUIRED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "POReconciliationLineMatch" AS ENUM ('MATCHED', 'PRICE_VARIANCE', 'QTY_VARIANCE', 'PRICE_AND_QTY_VARIANCE', 'UNMATCHED_PO_LINE', 'UNMATCHED_RECEIPT_LINE', 'AMBIGUOUS_PO_LINE', 'AMBIGUOUS_RECEIPT_LINE');

-- CreateEnum
CREATE TYPE "POReconciliationLineResolution" AS ENUM ('NONE', 'CONFIRMED_PAIR', 'ACCEPTED_VARIANCE', 'REJECTED_PAIR');

-- CreateEnum
CREATE TYPE "SpendAlertKind" AS ENUM ('PRICE_OVER_PO_EXPECTED', 'QTY_MISMATCH', 'UNMATCHED_RECEIPT_LINE', 'MISSING_PO_RECEIPT_LINE', 'RECONCILIATION_AMBIGUOUS', 'PO_TOTAL_OVER_EXPECTED');

-- CreateEnum
CREATE TYPE "SpendAlertStatus" AS ENUM ('OPEN', 'DISMISSED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "RepricingRequestStatus" AS ENUM ('REQUESTED', 'IN_REVIEW', 'UPDATED', 'IGNORED');

-- CreateEnum
CREATE TYPE "VehicleDimensionConfidenceLevel" AS ENUM ('MANUAL', 'IMPORTED', 'ESTIMATED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "VehiclePhotoType" AS ENUM ('FRONT', 'SIDE', 'REAR', 'INTERIOR', 'HERO', 'PLACEHOLDER');

-- CreateEnum
CREATE TYPE "VehicleTemplateFileType" AS ENUM ('SVG', 'PDF', 'AI', 'EPS', 'PNG', 'JPG', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "POEventKind" ADD VALUE 'OPERATOR_VENDOR_ACKNOWLEDGED';
ALTER TYPE "POEventKind" ADD VALUE 'OPERATOR_BLOCKED';
ALTER TYPE "POEventKind" ADD VALUE 'OPERATOR_BLOCKED_CLEARED';
ALTER TYPE "POEventKind" ADD VALUE 'OPERATOR_RECEIVED_COMPLETE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VendorPriceExtractionMethod" ADD VALUE 'OCR_TEXT_REGEX';
ALTER TYPE "VendorPriceExtractionMethod" ADD VALUE 'OCR_APPROVED';

-- DropForeignKey
ALTER TABLE "vendor_price_histories" DROP CONSTRAINT "vendor_price_histories_sourceEmailId_fkey";

-- DropForeignKey
ALTER TABLE "vendor_price_notifications" DROP CONSTRAINT "vendor_price_notifications_sourceEmailId_fkey";

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "address" TEXT,
ADD COLUMN     "alternatePhone" TEXT,
ADD COLUMN     "secondaryEmail" TEXT;

-- AlterTable
ALTER TABLE "estimate_line_items" ADD COLUMN     "customerDescription" TEXT,
ADD COLUMN     "designTimeMilli" INTEGER,
ADD COLUMN     "hiddenFromCustomer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "installTimeMilli" INTEGER,
ADD COLUMN     "internalNotes" TEXT,
ADD COLUMN     "laborHoursMilli" INTEGER,
ADD COLUMN     "machineTimeMilli" INTEGER,
ADD COLUMN     "materialCostCents" INTEGER,
ADD COLUMN     "partialUsageMilli" INTEGER,
ADD COLUMN     "vendorCostCents" INTEGER;

-- AlterTable
ALTER TABLE "estimates" ADD COLUMN     "estimateType" "EstimateType" NOT NULL DEFAULT 'CUSTOM';

-- AlterTable
ALTER TABLE "ingested_emails" ADD COLUMN     "reviewReasonCodes" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "operatorMarkedReconciledAt" TIMESTAMP(3),
ADD COLUMN     "operatorMarkedReconciledById" TEXT;

-- AlterTable
ALTER TABLE "shop_material_items" DROP COLUMN "category",
DROP COLUMN "defaultUnit",
ADD COLUMN     "catalogUnit" "ShopCatalogUnit" NOT NULL DEFAULT 'EACH',
ADD COLUMN     "categories" TEXT[],
ADD COLUMN     "customUnitLabel" VARCHAR(40),
ADD COLUMN     "defaultQtyMilli" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "defaultSellPriceCents" INTEGER,
ADD COLUMN     "internalCostCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kind" "EstimateLineKind" NOT NULL DEFAULT 'MATERIAL',
ADD COLUMN     "machineId" TEXT,
ADD COLUMN     "markupPercentMilli" INTEGER NOT NULL DEFAULT 200000;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "address" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "logoDataUrl" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "slogan" TEXT;

-- AlterTable
ALTER TABLE "vendor_catalog_items" ADD COLUMN     "leadTimeDays" INTEGER,
ADD COLUMN     "notes" VARCHAR(1000),
ADD COLUMN     "vendorSku" VARCHAR(120);

-- AlterTable
ALTER TABLE "vendor_price_histories" ADD COLUMN     "ocrLineItemId" TEXT,
ADD COLUMN     "sourcePoAttachmentId" TEXT,
ALTER COLUMN "sourceEmailId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "vendor_price_notifications" ADD COLUMN     "sourceOcrDocumentId" TEXT,
ALTER COLUMN "sourceEmailId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "emails" TEXT[],
ADD COLUMN     "phones" TEXT[];

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "estimateId" TEXT,
    "clientId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UNPAID',
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "kind" "EstimateLineKind" NOT NULL,
    "description" TEXT NOT NULL,
    "qtyMilli" INTEGER NOT NULL DEFAULT 1000,
    "lineTotalCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimate_quote_links" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByName" TEXT,
    "acceptedNote" TEXT,
    "declinedAt" TIMESTAMP(3),
    "declinedByName" TEXT,
    "declinedNote" TEXT,
    "respondedAt" TIMESTAMP(3),
    "responseIp" TEXT,
    "responseUserAgent" TEXT,

    CONSTRAINT "estimate_quote_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimate_timeline_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "kind" "EstimateTimelineKind" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estimate_timeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_makes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "country" VARCHAR(120),
    "logoUrl" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_makes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_models" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "makeId" TEXT NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "bodyClass" VARCHAR(120),
    "vehicleType" VARCHAR(120),
    "firstYear" INTEGER,
    "lastYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_trims" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "trimName" VARCHAR(180),
    "generation" VARCHAR(120),
    "bodyStyle" VARCHAR(120),
    "doors" INTEGER,
    "drivetrain" VARCHAR(80),
    "fuelType" VARCHAR(80),
    "engine" VARCHAR(160),
    "transmission" VARCHAR(120),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_trims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_dimension_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "trimId" TEXT NOT NULL,
    "sourceName" VARCHAR(180),
    "sourceUrl" VARCHAR(1000),
    "confidenceLevel" "VehicleDimensionConfidenceLevel" NOT NULL DEFAULT 'IMPORTED',
    "lengthIn" DOUBLE PRECISION,
    "widthIn" DOUBLE PRECISION,
    "heightIn" DOUBLE PRECISION,
    "wheelbaseIn" DOUBLE PRECISION,
    "curbWeightLb" DOUBLE PRECISION,
    "grossWeightLb" DOUBLE PRECISION,
    "cargoLengthIn" DOUBLE PRECISION,
    "cargoWidthIn" DOUBLE PRECISION,
    "cargoHeightIn" DOUBLE PRECISION,
    "bedLengthIn" DOUBLE PRECISION,
    "roofLengthIn" DOUBLE PRECISION,
    "roofWidthIn" DOUBLE PRECISION,
    "hoodLengthIn" DOUBLE PRECISION,
    "hoodWidthIn" DOUBLE PRECISION,
    "sideApproxSqFt" DOUBLE PRECISION,
    "roofApproxSqFt" DOUBLE PRECISION,
    "hoodApproxSqFt" DOUBLE PRECISION,
    "rearApproxSqFt" DOUBLE PRECISION,
    "frontApproxSqFt" DOUBLE PRECISION,
    "totalApproxWrapSqFt" DOUBLE PRECISION,
    "notes" VARCHAR(4000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_dimension_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_photos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "trimId" TEXT,
    "modelId" TEXT,
    "makeId" TEXT,
    "url" VARCHAR(1000) NOT NULL,
    "storageKey" VARCHAR(200),
    "altText" VARCHAR(240),
    "photoType" "VehiclePhotoType" NOT NULL DEFAULT 'HERO',
    "sourceName" VARCHAR(180),
    "sourceUrl" VARCHAR(1000),
    "licenseNote" VARCHAR(1000),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "trimId" TEXT NOT NULL,
    "templateName" VARCHAR(180) NOT NULL,
    "fileUrl" VARCHAR(1000) NOT NULL,
    "fileType" "VehicleTemplateFileType" NOT NULL DEFAULT 'OTHER',
    "sourceName" VARCHAR(180),
    "sourceUrl" VARCHAR(1000),
    "licenseNote" VARCHAR(1000),
    "driverSideUrl" VARCHAR(1000),
    "passengerSideUrl" VARCHAR(1000),
    "frontUrl" VARCHAR(1000),
    "rearUrl" VARCHAR(1000),
    "roofUrl" VARCHAR(1000),
    "notes" VARCHAR(4000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimate_vehicles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "trimId" TEXT,
    "year" INTEGER,
    "make" VARCHAR(160),
    "model" VARCHAR(180),
    "trim" VARCHAR(180),
    "vin" VARCHAR(80),
    "licensePlate" VARCHAR(40),
    "color" VARCHAR(80),
    "wrapType" VARCHAR(120),
    "coverageType" VARCHAR(120),
    "notes" VARCHAR(4000),
    "photoUrl" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estimate_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_item_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_item_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repricing_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shopMaterialItemId" TEXT NOT NULL,
    "vendorId" TEXT,
    "oldCostCents" INTEGER,
    "reason" VARCHAR(500) NOT NULL,
    "notes" VARCHAR(2000),
    "status" "RepricingRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repricing_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ocr_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "po_reconciliations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "status" "POReconciliationStatus" NOT NULL DEFAULT 'PENDING',
    "triggerDedupeKey" VARCHAR(64) NOT NULL,
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "po_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "po_reconciliation_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "poReconciliationId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "poLineItemId" TEXT,
    "vendorPriceHistoryId" TEXT,
    "match" "POReconciliationLineMatch" NOT NULL,
    "expectedQtyMilli" INTEGER,
    "expectedUnitCostCents" INTEGER,
    "observedQtyMilli" INTEGER,
    "observedUnitPriceCents" INTEGER,
    "priceVarianceCents" INTEGER,
    "qtyVarianceMilli" INTEGER,
    "resolution" "POReconciliationLineResolution" NOT NULL DEFAULT 'NONE',
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "po_reconciliation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spend_alerts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "vendorId" TEXT,
    "poReconciliationId" TEXT,
    "kind" "SpendAlertKind" NOT NULL,
    "status" "SpendAlertStatus" NOT NULL DEFAULT 'OPEN',
    "identityKey" VARCHAR(64) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(900) NOT NULL,
    "dedupeKey" VARCHAR(64) NOT NULL,
    "metadata" JSONB,
    "dismissedAt" TIMESTAMP(3),
    "dismissedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "supersededAt" TIMESTAMP(3),
    "supersededByReconciliationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spend_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "smtp_config" (
    "id" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "secure" BOOLEAN NOT NULL DEFAULT false,
    "user" TEXT NOT NULL,
    "passwordCipher" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "replyTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "smtp_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_tenantId_status_updatedAt_idx" ON "invoices"("tenantId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "invoices_tenantId_estimateId_idx" ON "invoices"("tenantId", "estimateId");

-- CreateIndex
CREATE INDEX "invoices_tenantId_deletedAt_idx" ON "invoices"("tenantId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenantId_number_key" ON "invoices"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenantId_estimateId_key" ON "invoices"("tenantId", "estimateId");

-- CreateIndex
CREATE INDEX "invoice_line_items_tenantId_invoiceId_sortOrder_idx" ON "invoice_line_items"("tenantId", "invoiceId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "estimate_quote_links_tokenHash_key" ON "estimate_quote_links"("tokenHash");

-- CreateIndex
CREATE INDEX "estimate_quote_links_tenantId_estimateId_idx" ON "estimate_quote_links"("tenantId", "estimateId");

-- CreateIndex
CREATE INDEX "estimate_timeline_events_tenantId_estimateId_createdAt_idx" ON "estimate_timeline_events"("tenantId", "estimateId", "createdAt");

-- CreateIndex
CREATE INDEX "vehicle_makes_tenantId_name_idx" ON "vehicle_makes"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_makes_tenantId_slug_key" ON "vehicle_makes"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "vehicle_models_tenantId_makeId_slug_idx" ON "vehicle_models"("tenantId", "makeId", "slug");

-- CreateIndex
CREATE INDEX "vehicle_models_tenantId_name_idx" ON "vehicle_models"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_models_tenantId_makeId_slug_key" ON "vehicle_models"("tenantId", "makeId", "slug");

-- CreateIndex
CREATE INDEX "vehicle_trims_tenantId_modelId_year_idx" ON "vehicle_trims"("tenantId", "modelId", "year");

-- CreateIndex
CREATE INDEX "vehicle_trims_tenantId_year_idx" ON "vehicle_trims"("tenantId", "year");

-- CreateIndex
CREATE INDEX "vehicle_trims_tenantId_deletedAt_idx" ON "vehicle_trims"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "vehicle_dimension_profiles_tenantId_trimId_idx" ON "vehicle_dimension_profiles"("tenantId", "trimId");

-- CreateIndex
CREATE INDEX "vehicle_dimension_profiles_tenantId_confidenceLevel_idx" ON "vehicle_dimension_profiles"("tenantId", "confidenceLevel");

-- CreateIndex
CREATE INDEX "vehicle_photos_tenantId_trimId_isPrimary_idx" ON "vehicle_photos"("tenantId", "trimId", "isPrimary");

-- CreateIndex
CREATE INDEX "vehicle_photos_tenantId_modelId_idx" ON "vehicle_photos"("tenantId", "modelId");

-- CreateIndex
CREATE INDEX "vehicle_photos_tenantId_makeId_idx" ON "vehicle_photos"("tenantId", "makeId");

-- CreateIndex
CREATE INDEX "vehicle_templates_tenantId_trimId_idx" ON "vehicle_templates"("tenantId", "trimId");

-- CreateIndex
CREATE UNIQUE INDEX "estimate_vehicles_estimateId_key" ON "estimate_vehicles"("estimateId");

-- CreateIndex
CREATE INDEX "estimate_vehicles_tenantId_estimateId_idx" ON "estimate_vehicles"("tenantId", "estimateId");

-- CreateIndex
CREATE INDEX "estimate_vehicles_tenantId_year_make_model_idx" ON "estimate_vehicles"("tenantId", "year", "make", "model");

-- CreateIndex
CREATE UNIQUE INDEX "estimate_vehicles_tenantId_estimateId_key" ON "estimate_vehicles"("tenantId", "estimateId");

-- CreateIndex
CREATE INDEX "shop_item_categories_tenantId_name_idx" ON "shop_item_categories"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "shop_item_categories_tenantId_name_key" ON "shop_item_categories"("tenantId", "name");

-- CreateIndex
CREATE INDEX "repricing_requests_tenantId_status_createdAt_idx" ON "repricing_requests"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "repricing_requests_tenantId_shopMaterialItemId_idx" ON "repricing_requests"("tenantId", "shopMaterialItemId");

-- CreateIndex
CREATE INDEX "repricing_requests_tenantId_vendorId_idx" ON "repricing_requests"("tenantId", "vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "ocr_documents_poAttachmentId_key" ON "ocr_documents"("poAttachmentId");

-- CreateIndex
CREATE INDEX "ocr_documents_tenantId_status_createdAt_idx" ON "ocr_documents"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ocr_line_items_ocrDocumentId_sortOrder_idx" ON "ocr_line_items"("ocrDocumentId", "sortOrder");

-- CreateIndex
CREATE INDEX "po_reconciliations_tenantId_purchaseOrderId_createdAt_idx" ON "po_reconciliations"("tenantId", "purchaseOrderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "po_reconciliations_tenantId_triggerDedupeKey_key" ON "po_reconciliations"("tenantId", "triggerDedupeKey");

-- CreateIndex
CREATE INDEX "po_reconciliation_lines_tenantId_poReconciliationId_idx" ON "po_reconciliation_lines"("tenantId", "poReconciliationId");

-- CreateIndex
CREATE UNIQUE INDEX "po_reconciliation_lines_poReconciliationId_sortOrder_key" ON "po_reconciliation_lines"("poReconciliationId", "sortOrder");

-- CreateIndex
CREATE INDEX "spend_alerts_tenantId_status_createdAt_idx" ON "spend_alerts"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "spend_alerts_tenantId_vendorId_idx" ON "spend_alerts"("tenantId", "vendorId");

-- CreateIndex
CREATE INDEX "spend_alerts_tenantId_purchaseOrderId_status_idx" ON "spend_alerts"("tenantId", "purchaseOrderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "spend_alerts_tenantId_dedupeKey_key" ON "spend_alerts"("tenantId", "dedupeKey");

-- CreateIndex
CREATE INDEX "shop_material_items_tenantId_kind_idx" ON "shop_material_items"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "shop_material_items_tenantId_machineId_idx" ON "shop_material_items"("tenantId", "machineId");

-- CreateIndex
CREATE INDEX "vendor_catalog_items_tenantId_nameNormalized_idx" ON "vendor_catalog_items"("tenantId", "nameNormalized");

-- CreateIndex
CREATE INDEX "vendor_item_aliases_tenantId_aliasNormalized_idx" ON "vendor_item_aliases"("tenantId", "aliasNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_price_histories_ocrLineItemId_key" ON "vendor_price_histories"("ocrLineItemId");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "estimates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_quote_links" ADD CONSTRAINT "estimate_quote_links_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_quote_links" ADD CONSTRAINT "estimate_quote_links_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "estimates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_quote_links" ADD CONSTRAINT "estimate_quote_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_timeline_events" ADD CONSTRAINT "estimate_timeline_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_timeline_events" ADD CONSTRAINT "estimate_timeline_events_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "estimates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_makes" ADD CONSTRAINT "vehicle_makes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_models" ADD CONSTRAINT "vehicle_models_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_models" ADD CONSTRAINT "vehicle_models_makeId_fkey" FOREIGN KEY ("makeId") REFERENCES "vehicle_makes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_trims" ADD CONSTRAINT "vehicle_trims_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_trims" ADD CONSTRAINT "vehicle_trims_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "vehicle_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_dimension_profiles" ADD CONSTRAINT "vehicle_dimension_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_dimension_profiles" ADD CONSTRAINT "vehicle_dimension_profiles_trimId_fkey" FOREIGN KEY ("trimId") REFERENCES "vehicle_trims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_photos" ADD CONSTRAINT "vehicle_photos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_photos" ADD CONSTRAINT "vehicle_photos_trimId_fkey" FOREIGN KEY ("trimId") REFERENCES "vehicle_trims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_photos" ADD CONSTRAINT "vehicle_photos_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "vehicle_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_photos" ADD CONSTRAINT "vehicle_photos_makeId_fkey" FOREIGN KEY ("makeId") REFERENCES "vehicle_makes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_templates" ADD CONSTRAINT "vehicle_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_templates" ADD CONSTRAINT "vehicle_templates_trimId_fkey" FOREIGN KEY ("trimId") REFERENCES "vehicle_trims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_vehicles" ADD CONSTRAINT "estimate_vehicles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_vehicles" ADD CONSTRAINT "estimate_vehicles_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "estimates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_vehicles" ADD CONSTRAINT "estimate_vehicles_trimId_fkey" FOREIGN KEY ("trimId") REFERENCES "vehicle_trims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_operatorMarkedReconciledById_fkey" FOREIGN KEY ("operatorMarkedReconciledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_material_items" ADD CONSTRAINT "shop_material_items_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_item_categories" ADD CONSTRAINT "shop_item_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_price_histories" ADD CONSTRAINT "vendor_price_histories_sourceEmailId_fkey" FOREIGN KEY ("sourceEmailId") REFERENCES "ingested_emails"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_price_histories" ADD CONSTRAINT "vendor_price_histories_sourcePoAttachmentId_fkey" FOREIGN KEY ("sourcePoAttachmentId") REFERENCES "po_attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_price_histories" ADD CONSTRAINT "vendor_price_histories_ocrLineItemId_fkey" FOREIGN KEY ("ocrLineItemId") REFERENCES "ocr_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_price_notifications" ADD CONSTRAINT "vendor_price_notifications_sourceEmailId_fkey" FOREIGN KEY ("sourceEmailId") REFERENCES "ingested_emails"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_price_notifications" ADD CONSTRAINT "vendor_price_notifications_sourceOcrDocumentId_fkey" FOREIGN KEY ("sourceOcrDocumentId") REFERENCES "ocr_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repricing_requests" ADD CONSTRAINT "repricing_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repricing_requests" ADD CONSTRAINT "repricing_requests_shopMaterialItemId_fkey" FOREIGN KEY ("shopMaterialItemId") REFERENCES "shop_material_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repricing_requests" ADD CONSTRAINT "repricing_requests_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repricing_requests" ADD CONSTRAINT "repricing_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repricing_requests" ADD CONSTRAINT "repricing_requests_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_documents" ADD CONSTRAINT "ocr_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_documents" ADD CONSTRAINT "ocr_documents_poAttachmentId_fkey" FOREIGN KEY ("poAttachmentId") REFERENCES "po_attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_documents" ADD CONSTRAINT "ocr_documents_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_documents" ADD CONSTRAINT "ocr_documents_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_line_items" ADD CONSTRAINT "ocr_line_items_ocrDocumentId_fkey" FOREIGN KEY ("ocrDocumentId") REFERENCES "ocr_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_line_items" ADD CONSTRAINT "ocr_line_items_mappedVendorCatalogItemId_fkey" FOREIGN KEY ("mappedVendorCatalogItemId") REFERENCES "vendor_catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_reconciliations" ADD CONSTRAINT "po_reconciliations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_reconciliations" ADD CONSTRAINT "po_reconciliations_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_reconciliations" ADD CONSTRAINT "po_reconciliations_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_reconciliation_lines" ADD CONSTRAINT "po_reconciliation_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_reconciliation_lines" ADD CONSTRAINT "po_reconciliation_lines_poReconciliationId_fkey" FOREIGN KEY ("poReconciliationId") REFERENCES "po_reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_reconciliation_lines" ADD CONSTRAINT "po_reconciliation_lines_poLineItemId_fkey" FOREIGN KEY ("poLineItemId") REFERENCES "po_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_reconciliation_lines" ADD CONSTRAINT "po_reconciliation_lines_vendorPriceHistoryId_fkey" FOREIGN KEY ("vendorPriceHistoryId") REFERENCES "vendor_price_histories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_reconciliation_lines" ADD CONSTRAINT "po_reconciliation_lines_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spend_alerts" ADD CONSTRAINT "spend_alerts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spend_alerts" ADD CONSTRAINT "spend_alerts_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spend_alerts" ADD CONSTRAINT "spend_alerts_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spend_alerts" ADD CONSTRAINT "spend_alerts_poReconciliationId_fkey" FOREIGN KEY ("poReconciliationId") REFERENCES "po_reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spend_alerts" ADD CONSTRAINT "spend_alerts_supersededByReconciliationId_fkey" FOREIGN KEY ("supersededByReconciliationId") REFERENCES "po_reconciliations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spend_alerts" ADD CONSTRAINT "spend_alerts_dismissedById_fkey" FOREIGN KEY ("dismissedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spend_alerts" ADD CONSTRAINT "spend_alerts_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "vendor_price_histories_tenantId_vendorCatalogItemId_createdAt_i" RENAME TO "vendor_price_histories_tenantId_vendorCatalogItemId_created_idx";

