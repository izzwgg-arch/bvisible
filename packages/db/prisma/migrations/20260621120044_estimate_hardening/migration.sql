-- Estimate hardening fields and repricing requests added after the prior production deploy.

CREATE TYPE "EstimateType" AS ENUM ('CUSTOM', 'STOCK_ITEM', 'SQUARE_FOOTAGE');
CREATE TYPE "RepricingRequestStatus" AS ENUM ('REQUESTED', 'IN_REVIEW', 'UPDATED', 'IGNORED');

ALTER TABLE "estimates"
  ADD COLUMN "estimateType" "EstimateType" NOT NULL DEFAULT 'CUSTOM';

ALTER TABLE "estimate_line_items"
  ADD COLUMN "customerDescription" TEXT,
  ADD COLUMN "designTimeMilli" INTEGER,
  ADD COLUMN "hiddenFromCustomer" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "installTimeMilli" INTEGER,
  ADD COLUMN "internalNotes" TEXT,
  ADD COLUMN "laborHoursMilli" INTEGER,
  ADD COLUMN "machineTimeMilli" INTEGER,
  ADD COLUMN "materialCostCents" INTEGER,
  ADD COLUMN "partialUsageMilli" INTEGER,
  ADD COLUMN "vendorCostCents" INTEGER;

ALTER TABLE "vendor_catalog_items"
  ADD COLUMN "leadTimeDays" INTEGER,
  ADD COLUMN "notes" VARCHAR(1000);

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

CREATE INDEX "repricing_requests_tenantId_status_createdAt_idx"
  ON "repricing_requests"("tenantId", "status", "createdAt");
CREATE INDEX "repricing_requests_tenantId_shopMaterialItemId_idx"
  ON "repricing_requests"("tenantId", "shopMaterialItemId");
CREATE INDEX "repricing_requests_tenantId_vendorId_idx"
  ON "repricing_requests"("tenantId", "vendorId");

ALTER TABLE "repricing_requests"
  ADD CONSTRAINT "repricing_requests_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "repricing_requests_shopMaterialItemId_fkey"
    FOREIGN KEY ("shopMaterialItemId") REFERENCES "shop_material_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "repricing_requests_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "repricing_requests_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "repricing_requests_completedById_fkey"
    FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
