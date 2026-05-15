-- Shop Items catalog + manual vendor price observations + catalog linkage.

ALTER TYPE "VendorPriceExtractionMethod" ADD VALUE 'MANUAL';

CREATE TABLE "shop_material_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" VARCHAR(400) NOT NULL,
    "nameNormalized" VARCHAR(400) NOT NULL,
    "category" VARCHAR(120),
    "defaultUnit" VARCHAR(40),
    "notes" VARCHAR(2000),
    "preferredVendorId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_material_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shop_material_items_tenantId_nameNormalized_key" ON "shop_material_items"("tenantId", "nameNormalized");
CREATE INDEX "shop_material_items_tenantId_isActive_idx" ON "shop_material_items"("tenantId", "isActive");

ALTER TABLE "shop_material_items" ADD CONSTRAINT "shop_material_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shop_material_items" ADD CONSTRAINT "shop_material_items_preferredVendorId_fkey" FOREIGN KEY ("preferredVendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "shop_material_item_aliases" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shopMaterialItemId" TEXT NOT NULL,
    "aliasNormalized" VARCHAR(400) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_material_item_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shop_material_item_aliases_tenantId_aliasNormalized_key" ON "shop_material_item_aliases"("tenantId", "aliasNormalized");
CREATE INDEX "shop_material_item_aliases_tenantId_shopMaterialItemId_idx" ON "shop_material_item_aliases"("tenantId", "shopMaterialItemId");

ALTER TABLE "shop_material_item_aliases" ADD CONSTRAINT "shop_material_item_aliases_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shop_material_item_aliases" ADD CONSTRAINT "shop_material_item_aliases_shopMaterialItemId_fkey" FOREIGN KEY ("shopMaterialItemId") REFERENCES "shop_material_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vendor_catalog_items" ADD COLUMN "shopMaterialItemId" TEXT;

CREATE INDEX "vendor_catalog_items_tenantId_shopMaterialItemId_idx" ON "vendor_catalog_items"("tenantId", "shopMaterialItemId");

ALTER TABLE "vendor_catalog_items" ADD CONSTRAINT "vendor_catalog_items_shopMaterialItemId_fkey" FOREIGN KEY ("shopMaterialItemId") REFERENCES "shop_material_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vendor_price_histories" ADD COLUMN "effectiveAt" TIMESTAMP(3);
