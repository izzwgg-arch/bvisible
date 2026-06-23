ALTER TABLE "shop_material_items"
  ADD COLUMN "pricingMethod" VARCHAR(40),
  ADD COLUMN "pricingInputsJson" JSONB,
  ADD COLUMN "calculatedCostCents" INTEGER,
  ADD COLUMN "calculatedSellCents" INTEGER,
  ADD COLUMN "pricingNotes" VARCHAR(1000);
