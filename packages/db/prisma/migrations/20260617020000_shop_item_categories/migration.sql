-- AddColumn shop_material_items.categories
-- Adds a TEXT[] array to store multiple categories (line kinds) per catalog item.
-- Backfills each existing row from its current single `kind` value.
-- The legacy `kind` column is kept for backward compatibility with estimate logic
-- and is kept in sync with the first element of `categories` by the application.

ALTER TABLE "shop_material_items"
  ADD COLUMN "categories" TEXT[] NOT NULL DEFAULT '{}';

-- Backfill: seed from existing kind
UPDATE "shop_material_items"
  SET "categories" = ARRAY["kind"]::TEXT[];
