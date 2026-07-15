-- Sheet-driven pricing foundation (Phase A of the estimate/PO redesign).
-- 1. R-EST-05 markup-exempt lines + guided-flow provenance on estimate lines.
-- 2. sheetKey marker on shop_material_items (Sheet is catalog source of truth).
-- 3. App price overrides, operating rates, and the Sheet sync cache.

-- CreateEnum
CREATE TYPE "SheetOverrideItemType" AS ENUM ('MATERIAL', 'MACHINE');

-- AlterTable
ALTER TABLE "estimate_line_items"
  ADD COLUMN "markupExempt" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sourceKind" VARCHAR(30);

-- AlterTable
ALTER TABLE "shop_material_items" ADD COLUMN "sheetKey" VARCHAR(400);

-- CreateTable
CREATE TABLE "sheet_price_overrides" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemType" "SheetOverrideItemType" NOT NULL,
    "itemKey" VARCHAR(400) NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sheet_price_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_operating_rates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shopLaborCentsPerHour" INTEGER NOT NULL DEFAULT 5000,
    "designFlatCents" INTEGER NOT NULL DEFAULT 15000,
    "installPerPersonHourCents" INTEGER NOT NULL DEFAULT 15000,
    "defaultMarkupPercentMilli" INTEGER NOT NULL DEFAULT 200000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_operating_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sheet_sync_state" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sheetId" VARCHAR(120) NOT NULL,
    "dataJson" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OK',
    "lastError" VARCHAR(2000),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sheet_sync_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sheet_price_overrides_tenantId_itemType_itemKey_key" ON "sheet_price_overrides"("tenantId", "itemType", "itemKey");

-- CreateIndex
CREATE INDEX "sheet_price_overrides_tenantId_itemType_idx" ON "sheet_price_overrides"("tenantId", "itemType");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_operating_rates_tenantId_key" ON "tenant_operating_rates"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "sheet_sync_state_tenantId_key" ON "sheet_sync_state"("tenantId");

-- AddForeignKey
ALTER TABLE "sheet_price_overrides" ADD CONSTRAINT "sheet_price_overrides_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_operating_rates" ADD CONSTRAINT "tenant_operating_rates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_sync_state" ADD CONSTRAINT "sheet_sync_state_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
