CREATE TYPE "PricingEngine" AS ENUM (
  'MANUAL',
  'SQ_FT',
  'SHEET_GOODS',
  'ROLL_MATERIAL',
  'BANNER',
  'LABOR',
  'INSTALL',
  'MACHINE',
  'COST_PLUS',
  'CHANNEL_LETTERS',
  'BUNDLE'
);

CREATE TYPE "VendorCostSourceMode" AS ENUM (
  'CHEAPEST',
  'PREFERRED',
  'MANUAL',
  'INTERNAL'
);

ALTER TABLE "shop_material_items"
  ADD COLUMN "pricingEngine" "PricingEngine" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "pricingOutputJson" JSONB,
  ADD COLUMN "formulaVersion" VARCHAR(40),
  ADD COLUMN "selectedVendorId" TEXT,
  ADD COLUMN "selectedVendorMode" "VendorCostSourceMode" NOT NULL DEFAULT 'INTERNAL',
  ADD COLUMN "pricingCalculatedAt" TIMESTAMP(3),
  ADD COLUMN "pricingCalculatedById" TEXT;

UPDATE "shop_material_items"
SET "pricingEngine" = CASE
  WHEN "itemType" = 'BUNDLE' THEN 'BUNDLE'::"PricingEngine"
  WHEN "pricingMethod" = 'SQUARE_FOOTAGE' THEN 'SQ_FT'::"PricingEngine"
  WHEN "pricingMethod" = 'SHEET_GOODS' THEN 'SHEET_GOODS'::"PricingEngine"
  WHEN "pricingMethod" = 'ROLL_MATERIAL' THEN 'ROLL_MATERIAL'::"PricingEngine"
  WHEN "pricingMethod" = 'BANNER' THEN 'BANNER'::"PricingEngine"
  ELSE 'MANUAL'::"PricingEngine"
END;

UPDATE "shop_material_items"
SET "selectedVendorMode" = CASE
  WHEN "preferredVendorId" IS NOT NULL THEN 'PREFERRED'::"VendorCostSourceMode"
  WHEN "kind" = 'MATERIAL' THEN 'CHEAPEST'::"VendorCostSourceMode"
  ELSE 'INTERNAL'::"VendorCostSourceMode"
END;

ALTER TABLE "shop_material_items"
  ADD CONSTRAINT "shop_material_items_selectedVendorId_fkey"
  FOREIGN KEY ("selectedVendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "shop_material_items_pricingCalculatedById_fkey"
  FOREIGN KEY ("pricingCalculatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "shop_material_items_tenantId_selectedVendorId_idx"
  ON "shop_material_items"("tenantId", "selectedVendorId");

ALTER TABLE "estimate_line_items"
  ADD COLUMN "pricingMethod" VARCHAR(40),
  ADD COLUMN "pricingEngine" "PricingEngine",
  ADD COLUMN "pricingInputsSnapshotJson" JSONB,
  ADD COLUMN "pricingOutputSnapshotJson" JSONB,
  ADD COLUMN "formulaVersion" VARCHAR(40),
  ADD COLUMN "selectedVendorId" TEXT,
  ADD COLUMN "selectedVendorMode" "VendorCostSourceMode";

ALTER TABLE "estimate_line_items"
  ADD CONSTRAINT "estimate_line_items_selectedVendorId_fkey"
  FOREIGN KEY ("selectedVendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "estimate_line_items_tenantId_selectedVendorId_idx"
  ON "estimate_line_items"("tenantId", "selectedVendorId");
