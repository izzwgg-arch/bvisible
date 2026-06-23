CREATE TYPE "ShopMaterialItemType" AS ENUM ('SINGLE', 'BUNDLE');

ALTER TABLE "shop_material_items"
  ADD COLUMN "itemType" "ShopMaterialItemType" NOT NULL DEFAULT 'SINGLE',
  ADD COLUMN "customerDescription" VARCHAR(2000);

ALTER TABLE "estimate_line_items"
  ADD COLUMN "catalogItemId" TEXT;

CREATE TABLE "bundle_components" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "bundleCatalogItemId" TEXT NOT NULL,
  "componentCatalogItemId" TEXT,
  "componentName" VARCHAR(400) NOT NULL,
  "componentType" "EstimateLineKind" NOT NULL DEFAULT 'MATERIAL',
  "categories" TEXT[],
  "quantityMilli" INTEGER NOT NULL DEFAULT 1000,
  "unit" "ShopCatalogUnit" NOT NULL DEFAULT 'EACH',
  "customUnitLabel" VARCHAR(40),
  "internalUnitCostCents" INTEGER NOT NULL DEFAULT 0,
  "markupPercentMilli" INTEGER NOT NULL DEFAULT 200000,
  "defaultSellCents" INTEGER,
  "totalCostCents" INTEGER NOT NULL DEFAULT 0,
  "totalSellCents" INTEGER NOT NULL DEFAULT 0,
  "preferredVendorId" TEXT,
  "cheapestVendorId" TEXT,
  "selectedVendorId" TEXT,
  "vendorSnapshotJson" JSONB,
  "pricingMethod" VARCHAR(40),
  "pricingInputsJson" JSONB,
  "hiddenFromCustomer" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "notes" VARCHAR(2000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bundle_components_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "estimate_line_items"
  ADD CONSTRAINT "estimate_line_items_catalogItemId_fkey"
  FOREIGN KEY ("catalogItemId") REFERENCES "shop_material_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bundle_components"
  ADD CONSTRAINT "bundle_components_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "bundle_components_bundleCatalogItemId_fkey"
  FOREIGN KEY ("bundleCatalogItemId") REFERENCES "shop_material_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "bundle_components_componentCatalogItemId_fkey"
  FOREIGN KEY ("componentCatalogItemId") REFERENCES "shop_material_items"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "bundle_components_preferredVendorId_fkey"
  FOREIGN KEY ("preferredVendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "bundle_components_cheapestVendorId_fkey"
  FOREIGN KEY ("cheapestVendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "bundle_components_selectedVendorId_fkey"
  FOREIGN KEY ("selectedVendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "shop_material_items_tenantId_itemType_idx" ON "shop_material_items"("tenantId", "itemType");
CREATE INDEX "estimate_line_items_tenantId_catalogItemId_idx" ON "estimate_line_items"("tenantId", "catalogItemId");
CREATE INDEX "bundle_components_tenantId_bundleCatalogItemId_sortOrder_idx" ON "bundle_components"("tenantId", "bundleCatalogItemId", "sortOrder");
CREATE INDEX "bundle_components_tenantId_componentCatalogItemId_idx" ON "bundle_components"("tenantId", "componentCatalogItemId");
CREATE INDEX "bundle_components_tenantId_selectedVendorId_idx" ON "bundle_components"("tenantId", "selectedVendorId");
