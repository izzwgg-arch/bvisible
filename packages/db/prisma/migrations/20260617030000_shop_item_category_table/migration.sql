-- Tenant-level custom item categories for the catalog category dropdown.
-- Built-in categories remain EstimateLineKind values; custom categories
-- live here so they can be saved once and reused across all item forms.

CREATE TABLE "shop_item_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_item_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shop_item_categories_tenantId_name_key"
    ON "shop_item_categories"("tenantId", "name");

CREATE INDEX "shop_item_categories_tenantId_name_idx"
    ON "shop_item_categories"("tenantId", "name");

ALTER TABLE "shop_item_categories"
    ADD CONSTRAINT "shop_item_categories_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
