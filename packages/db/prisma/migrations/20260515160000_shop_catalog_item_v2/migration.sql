-- Items v2: estimating catalog fields + vendor SKU on catalog rows.

CREATE TYPE "ShopCatalogUnit" AS ENUM ('EACH', 'SHEET', 'SQ_FT', 'HOUR', 'LINEAR_FT', 'ROLL', 'CUSTOM');

ALTER TABLE "shop_material_items" ADD COLUMN "kind" "EstimateLineKind" NOT NULL DEFAULT 'MATERIAL';
ALTER TABLE "shop_material_items" ADD COLUMN "catalogUnit" "ShopCatalogUnit" NOT NULL DEFAULT 'EACH';
ALTER TABLE "shop_material_items" ADD COLUMN "customUnitLabel" VARCHAR(40);
ALTER TABLE "shop_material_items" ADD COLUMN "internalCostCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "shop_material_items" ADD COLUMN "markupPercentMilli" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "shop_material_items" ADD COLUMN "defaultSellPriceCents" INTEGER;
ALTER TABLE "shop_material_items" ADD COLUMN "defaultQtyMilli" INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE "shop_material_items" ADD COLUMN "machineId" TEXT;

UPDATE "shop_material_items"
SET "notes" = CONCAT('Legacy category: ', "category", E'\n\n', COALESCE("notes", ''))
WHERE "category" IS NOT NULL AND TRIM("category") <> '';

UPDATE "shop_material_items"
SET "customUnitLabel" = LEFT(TRIM("defaultUnit"), 40),
    "catalogUnit" = 'CUSTOM'
WHERE "defaultUnit" IS NOT NULL AND TRIM("defaultUnit") <> '';

ALTER TABLE "shop_material_items" DROP COLUMN "category";
ALTER TABLE "shop_material_items" DROP COLUMN "defaultUnit";

ALTER TABLE "vendor_catalog_items" ADD COLUMN "vendorSku" VARCHAR(120);

ALTER TABLE "shop_material_items"
ADD CONSTRAINT "shop_material_items_machineId_fkey"
FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "shop_material_items_tenantId_kind_idx" ON "shop_material_items"("tenantId", "kind");
CREATE INDEX "shop_material_items_machineId_idx" ON "shop_material_items"("machineId");
