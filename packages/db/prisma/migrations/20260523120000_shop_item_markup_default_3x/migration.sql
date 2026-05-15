-- New ShopMaterialItem rows default to 200% markup (≈3× sell hint vs cost). Existing rows unchanged.
ALTER TABLE "shop_material_items" ALTER COLUMN "markupPercentMilli" SET DEFAULT 200000;
