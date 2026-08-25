-- Per-estimate sales tax exemption.
--
-- Until now the only tax control was the company-wide rate
-- (tenant_operating_rates."salesTaxPercentMilli"), so a single tax-exempt
-- customer could not be quoted without zeroing tax for everyone. These
-- columns scope the exemption to one estimate.
--
-- Default false: every existing estimate keeps its current taxed total.
ALTER TABLE "estimates" ADD COLUMN "taxExempt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "estimates" ADD COLUMN "taxExemptReason" TEXT;
