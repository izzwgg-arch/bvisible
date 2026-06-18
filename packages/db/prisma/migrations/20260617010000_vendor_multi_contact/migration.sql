-- AddColumns vendor_emails vendor_phones
-- Adds array columns for multiple email addresses and phone numbers per vendor.
-- Legacy single-value email/phone columns are preserved for backward compatibility;
-- the app now reads/writes the array columns and falls back to the legacy fields.

ALTER TABLE "vendors"
  ADD COLUMN "emails" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "phones" TEXT[] NOT NULL DEFAULT '{}';

-- Backfill: copy any existing single email/phone into the first array element
UPDATE "vendors"
  SET "emails" = ARRAY["email"]
  WHERE "email" IS NOT NULL AND "email" <> '';

UPDATE "vendors"
  SET "phones" = ARRAY["phone"]
  WHERE "phone" IS NOT NULL AND "phone" <> '';
