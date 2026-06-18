-- Add multi-contact and categories columns (safe to re-run with IF NOT EXISTS)
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS emails TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS phones TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE shop_material_items ADD COLUMN IF NOT EXISTS categories TEXT[] NOT NULL DEFAULT '{}';

UPDATE vendors
  SET emails = ARRAY[email]
  WHERE email IS NOT NULL AND email != '' AND cardinality(emails) = 0;

UPDATE vendors
  SET phones = ARRAY[phone]
  WHERE phone IS NOT NULL AND phone != '' AND cardinality(phones) = 0;

UPDATE shop_material_items
  SET categories = ARRAY[kind::TEXT]
  WHERE cardinality(categories) = 0;

SELECT 'migration done' AS status;
