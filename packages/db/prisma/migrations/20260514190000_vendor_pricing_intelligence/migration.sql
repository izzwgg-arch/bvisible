-- Vendor pricing intelligence foundation (deterministic extraction).
-- PO timeline: lower-price operational signal on matched PO.

ALTER TYPE "POEventKind" ADD VALUE 'VENDOR_LOWER_PRICE';

CREATE TYPE "VendorPriceConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

CREATE TYPE "VendorPriceExtractionMethod" AS ENUM ('LINE_REGEX', 'SUBJECT_REGEX', 'FILENAME_REGEX');

CREATE TABLE "vendor_catalog_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "nameNormalized" VARCHAR(400) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_catalog_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vendor_catalog_items_tenantId_vendorId_nameNormalized_key" ON "vendor_catalog_items"("tenantId", "vendorId", "nameNormalized");

CREATE INDEX "vendor_catalog_items_tenantId_vendorId_idx" ON "vendor_catalog_items"("tenantId", "vendorId");

CREATE TABLE "vendor_item_aliases" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vendorCatalogItemId" TEXT NOT NULL,
    "aliasNormalized" VARCHAR(400) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_item_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vendor_item_aliases_tenantId_vendorId_aliasNormalized_key" ON "vendor_item_aliases"("tenantId", "vendorId", "aliasNormalized");

CREATE INDEX "vendor_item_aliases_tenantId_vendorCatalogItemId_idx" ON "vendor_item_aliases"("tenantId", "vendorCatalogItemId");

CREATE TABLE "vendor_price_histories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vendorCatalogItemId" TEXT NOT NULL,
    "itemNameRaw" VARCHAR(500) NOT NULL,
    "itemNameNormalized" VARCHAR(400) NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "unit" VARCHAR(40),
    "quantityMilli" INTEGER,
    "sourceEmailId" TEXT NOT NULL,
    "sourceAttachmentId" TEXT,
    "confidence" "VendorPriceConfidence" NOT NULL,
    "extractionMethod" "VendorPriceExtractionMethod" NOT NULL,
    "dedupeKey" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_price_histories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vendor_price_histories_tenantId_dedupeKey_key" ON "vendor_price_histories"("tenantId", "dedupeKey");

CREATE INDEX "vendor_price_histories_tenantId_vendorCatalogItemId_createdAt_idx" ON "vendor_price_histories"("tenantId", "vendorCatalogItemId", "createdAt");

CREATE INDEX "vendor_price_histories_tenantId_vendorId_createdAt_idx" ON "vendor_price_histories"("tenantId", "vendorId", "createdAt");

CREATE INDEX "vendor_price_histories_sourceEmailId_idx" ON "vendor_price_histories"("sourceEmailId");

CREATE TABLE "vendor_price_notifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vendorCatalogItemId" TEXT NOT NULL,
    "oldPriceCents" INTEGER NOT NULL,
    "newPriceCents" INTEGER NOT NULL,
    "sourceEmailId" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_price_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vendor_price_notifications_tenantId_dismissedAt_createdAt_idx" ON "vendor_price_notifications"("tenantId", "dismissedAt", "createdAt");

CREATE INDEX "vendor_price_notifications_tenantId_vendorId_idx" ON "vendor_price_notifications"("tenantId", "vendorId");

ALTER TABLE "vendor_catalog_items" ADD CONSTRAINT "vendor_catalog_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vendor_catalog_items" ADD CONSTRAINT "vendor_catalog_items_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vendor_item_aliases" ADD CONSTRAINT "vendor_item_aliases_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vendor_item_aliases" ADD CONSTRAINT "vendor_item_aliases_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vendor_item_aliases" ADD CONSTRAINT "vendor_item_aliases_vendorCatalogItemId_fkey" FOREIGN KEY ("vendorCatalogItemId") REFERENCES "vendor_catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vendor_price_histories" ADD CONSTRAINT "vendor_price_histories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vendor_price_histories" ADD CONSTRAINT "vendor_price_histories_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vendor_price_histories" ADD CONSTRAINT "vendor_price_histories_vendorCatalogItemId_fkey" FOREIGN KEY ("vendorCatalogItemId") REFERENCES "vendor_catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vendor_price_histories" ADD CONSTRAINT "vendor_price_histories_sourceEmailId_fkey" FOREIGN KEY ("sourceEmailId") REFERENCES "ingested_emails"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vendor_price_histories" ADD CONSTRAINT "vendor_price_histories_sourceAttachmentId_fkey" FOREIGN KEY ("sourceAttachmentId") REFERENCES "ingested_email_attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vendor_price_notifications" ADD CONSTRAINT "vendor_price_notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vendor_price_notifications" ADD CONSTRAINT "vendor_price_notifications_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vendor_price_notifications" ADD CONSTRAINT "vendor_price_notifications_vendorCatalogItemId_fkey" FOREIGN KEY ("vendorCatalogItemId") REFERENCES "vendor_catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vendor_price_notifications" ADD CONSTRAINT "vendor_price_notifications_sourceEmailId_fkey" FOREIGN KEY ("sourceEmailId") REFERENCES "ingested_emails"("id") ON DELETE CASCADE ON UPDATE CASCADE;
