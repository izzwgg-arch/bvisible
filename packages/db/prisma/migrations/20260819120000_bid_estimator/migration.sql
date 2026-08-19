-- Bid Estimator: guided seven-step estimate workflow.
--
-- Additive only. Existing estimates, lines, quotes, POs and the classic
-- editor are untouched:
--   * EstimateType gains BID; PricingEngine gains STANDARD_SIGN / BID_RATE.
--   * estimate_line_items.qbItem (nullable) — structured QuickBooks item so
--     the customer estimate and the QBME block share one mapping.
--   * tenant_operating_rates gains the Bid Estimator rates (design $/hr,
--     install crew $/hr and $/day, hours per install day) and salesTaxPercentMilli.
--     salesTaxPercentMilli (percent × 1000) defaults to 8125 = 8.125%, which is exactly what the
--     estimate PDF hardcoded until now, so existing estimates render
--     unchanged; admins change it on Pricing backend → Operating rates.
--   * New tables: bid_estimate_workflows (1:1 estimate: step, autosave
--     version, project details, design + install inputs), bid_source_files
--     (uploaded takeoffs / plans, revision chain), bid_source_rows (every
--     parsed spreadsheet row, linked to the line it feeds), bid_line_details
--     (1:1 line: source qty, match, review status, explanation), bid_questions
--     (office questions + answers), standard_signs (Sheet-synced or
--     app-promoted reusable signs; unique per tenant by signKey).
--
-- Rollback: this migration creates no data other than the defaults above.
-- To revert, drop the six new tables, the eight new enum types, the
-- estimate_line_items.qbItem column and the five tenant_operating_rates
-- columns. Enum VALUES (BID, STANDARD_SIGN, BID_RATE) cannot be removed
-- from a Postgres enum in place — leaving them is harmless.

-- CreateEnum
CREATE TYPE "QbItem" AS ENUM ('WRAPPING', 'SALES', 'THREE_D_LETTERING', 'DESIGN', 'SHIPPING', 'INSTALLATION', 'CHANNEL_LETTERS', 'CANOPY');

-- CreateEnum
CREATE TYPE "BidSourceRole" AS ENUM ('TAKEOFF', 'PLAN', 'SPECIFICATION', 'DRAWING', 'PHOTO', 'DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "BidSourceStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'READY', 'NEEDS_REVIEW', 'UNSUPPORTED', 'FAILED');

-- CreateEnum
CREATE TYPE "BidSourceRowKind" AS ENUM ('PRODUCT', 'HEADING', 'HEADER', 'BLANK', 'SUBTOTAL', 'TAX', 'TOTAL', 'NOTE', 'LEGEND', 'IGNORED');

-- CreateEnum
CREATE TYPE "BidLineReviewStatus" AS ENUM ('PENDING', 'AUTO_PRICED', 'NEEDS_REVIEW', 'OFFICE_QUESTION', 'BLOCKED', 'CONFIRMED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "BidMatchLevel" AS ENUM ('EXACT', 'PROBABLE', 'AMBIGUOUS', 'NONE');

-- CreateEnum
CREATE TYPE "BidQuestionKind" AS ENUM ('STANDARD_SIGN', 'MATERIAL', 'SIZE', 'PRICING_UNIT', 'RATE', 'ILLUMINATION', 'INSTALLATION_INCLUDED', 'ELECTRICAL', 'PROJECT_PRICE', 'MISSING_SPEC', 'OTHER');

-- CreateEnum
CREATE TYPE "BidQuestionStatus" AS ENUM ('OPEN', 'ANSWERED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "BidDecisionScope" AS ENUM ('PROJECT', 'PERMANENT');

-- CreateEnum
CREATE TYPE "BidInstallMode" AS ENUM ('HOURS', 'DAYS');

-- CreateEnum
CREATE TYPE "StandardSignSource" AS ENUM ('SHEET', 'APP');

-- AlterEnum
ALTER TYPE "EstimateType" ADD VALUE 'BID';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PricingEngine" ADD VALUE 'STANDARD_SIGN';
ALTER TYPE "PricingEngine" ADD VALUE 'BID_RATE';

-- AlterTable
ALTER TABLE "estimate_line_items" ADD COLUMN     "qbItem" "QbItem";

-- AlterTable
ALTER TABLE "tenant_operating_rates" ADD COLUMN     "designHourlyCents" INTEGER NOT NULL DEFAULT 15000,
ADD COLUMN     "installCrewDailyCents" INTEGER NOT NULL DEFAULT 280000,
ADD COLUMN     "installCrewHourlyCents" INTEGER NOT NULL DEFAULT 35000,
ADD COLUMN     "installDayHours" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "salesTaxPercentMilli" INTEGER NOT NULL DEFAULT 8125;

-- CreateTable
CREATE TABLE "bid_estimate_workflows" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "completedSteps" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "projectName" TEXT,
    "projectAddress" TEXT,
    "projectContactName" TEXT,
    "projectContactEmail" TEXT,
    "projectContactPhone" TEXT,
    "poNumber" VARCHAR(80),
    "customerReference" VARCHAR(120),
    "bidSource" VARCHAR(80),
    "dueDate" TIMESTAMP(3),
    "bidDeadline" TIMESTAMP(3),
    "internalNotes" TEXT,
    "importSummaryJson" JSONB,
    "designIncluded" BOOLEAN,
    "designHoursMilli" INTEGER,
    "designRateCents" INTEGER,
    "designInputsJson" JSONB,
    "designLineId" TEXT,
    "installIncluded" BOOLEAN,
    "installMode" "BidInstallMode",
    "installQtyMilli" INTEGER,
    "installRateCents" INTEGER,
    "installInputsJson" JSONB,
    "installLineId" TEXT,
    "lastSavedAt" TIMESTAMP(3),
    "lastSavedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bid_estimate_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_source_files" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "role" "BidSourceRole" NOT NULL DEFAULT 'OTHER',
    "status" "BidSourceStatus" NOT NULL DEFAULT 'UPLOADED',
    "originalFilename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedesId" TEXT,
    "supersededAt" TIMESTAMP(3),
    "isCurrentTakeoff" BOOLEAN NOT NULL DEFAULT false,
    "isEvidence" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "processingError" VARCHAR(1000),
    "processedAt" TIMESTAMP(3),
    "resultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bid_source_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_source_rows" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "sourceFileId" TEXT NOT NULL,
    "sheetName" VARCHAR(200) NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "page" INTEGER,
    "rowKind" "BidSourceRowKind" NOT NULL,
    "rawItem" TEXT,
    "rawDescription" TEXT,
    "rawQtyText" VARCHAR(60),
    "rawQtyMilli" INTEGER,
    "rawUnit" VARCHAR(40),
    "rawCostCents" INTEGER,
    "rawPriceCents" INTEGER,
    "rawExtendedCents" INTEGER,
    "sectionHeading" TEXT,
    "lineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bid_source_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_line_details" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "sourceFileId" TEXT,
    "sourceSheetName" VARCHAR(200),
    "sourceRowRef" VARCHAR(200),
    "sourceItem" TEXT,
    "sourceDescription" TEXT,
    "sourceQtyMilli" INTEGER NOT NULL DEFAULT 0,
    "sourceUnit" VARCHAR(40),
    "sectionHeading" TEXT,
    "normalizedDescription" TEXT,
    "standardSignId" TEXT,
    "standardSignKey" VARCHAR(120),
    "matchLevel" "BidMatchLevel" NOT NULL DEFAULT 'NONE',
    "matchConfidenceMilli" INTEGER NOT NULL DEFAULT 0,
    "reviewStatus" "BidLineReviewStatus" NOT NULL DEFAULT 'PENDING',
    "pricingUnit" VARCHAR(30),
    "pricingSource" VARCHAR(40),
    "explanationJson" JSONB,
    "overridesJson" JSONB,
    "aiSuggestionJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bid_line_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_questions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "lineId" TEXT,
    "kind" "BidQuestionKind" NOT NULL,
    "status" "BidQuestionStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "sourceRef" VARCHAR(300),
    "sourceText" TEXT,
    "systemFound" TEXT,
    "whyUnsafe" TEXT,
    "whyMatters" TEXT,
    "choicesJson" JSONB NOT NULL,
    "answerKey" VARCHAR(80),
    "answerValueJson" JSONB,
    "answerNote" TEXT,
    "answerScope" "BidDecisionScope",
    "answeredById" TEXT,
    "answeredAt" TIMESTAMP(3),
    "promotedStandardSignId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bid_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standard_signs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "signKey" VARCHAR(120) NOT NULL,
    "source" "StandardSignSource" NOT NULL DEFAULT 'SHEET',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "category" VARCHAR(120),
    "name" TEXT NOT NULL,
    "nameNormalized" VARCHAR(400) NOT NULL,
    "qbItem" "QbItem" NOT NULL DEFAULT 'SALES',
    "customerDescription" TEXT,
    "widthMilli" INTEGER,
    "heightMilli" INTEGER,
    "unit" VARCHAR(20),
    "material" VARCHAR(200),
    "thickness" VARCHAR(80),
    "construction" VARCHAR(200),
    "mounting" VARCHAR(200),
    "tactile" BOOLEAN,
    "braille" BOOLEAN,
    "illumination" VARCHAR(80),
    "pricingMethod" VARCHAR(30) NOT NULL DEFAULT 'PER_SIGN',
    "pricingUnit" VARCHAR(30) NOT NULL DEFAULT 'SIGN',
    "rateKey" VARCHAR(400),
    "rateCents" INTEGER,
    "minimumChargeCents" INTEGER,
    "wastePercentMilli" INTEGER,
    "defaultMachine" VARCHAR(120),
    "shopHoursMilli" INTEGER,
    "designUnitsMilli" INTEGER,
    "installHoursMilli" INTEGER,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "formulaVersion" VARCHAR(40),
    "notes" TEXT,
    "sheetRow" INTEGER,
    "syncedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "standard_signs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bid_estimate_workflows_estimateId_key" ON "bid_estimate_workflows"("estimateId");

-- CreateIndex
CREATE INDEX "bid_estimate_workflows_tenantId_currentStep_idx" ON "bid_estimate_workflows"("tenantId", "currentStep");

-- CreateIndex
CREATE INDEX "bid_estimate_workflows_tenantId_updatedAt_idx" ON "bid_estimate_workflows"("tenantId", "updatedAt");

-- CreateIndex
CREATE INDEX "bid_source_files_tenantId_estimateId_createdAt_idx" ON "bid_source_files"("tenantId", "estimateId", "createdAt");

-- CreateIndex
CREATE INDEX "bid_source_files_tenantId_estimateId_isCurrentTakeoff_idx" ON "bid_source_files"("tenantId", "estimateId", "isCurrentTakeoff");

-- CreateIndex
CREATE INDEX "bid_source_rows_tenantId_estimateId_sourceFileId_rowNumber_idx" ON "bid_source_rows"("tenantId", "estimateId", "sourceFileId", "rowNumber");

-- CreateIndex
CREATE INDEX "bid_source_rows_tenantId_lineId_idx" ON "bid_source_rows"("tenantId", "lineId");

-- CreateIndex
CREATE UNIQUE INDEX "bid_line_details_lineId_key" ON "bid_line_details"("lineId");

-- CreateIndex
CREATE INDEX "bid_line_details_tenantId_estimateId_reviewStatus_idx" ON "bid_line_details"("tenantId", "estimateId", "reviewStatus");

-- CreateIndex
CREATE INDEX "bid_line_details_tenantId_standardSignId_idx" ON "bid_line_details"("tenantId", "standardSignId");

-- CreateIndex
CREATE INDEX "bid_questions_tenantId_estimateId_status_sortOrder_idx" ON "bid_questions"("tenantId", "estimateId", "status", "sortOrder");

-- CreateIndex
CREATE INDEX "bid_questions_tenantId_lineId_idx" ON "bid_questions"("tenantId", "lineId");

-- CreateIndex
CREATE INDEX "standard_signs_tenantId_active_idx" ON "standard_signs"("tenantId", "active");

-- CreateIndex
CREATE INDEX "standard_signs_tenantId_nameNormalized_idx" ON "standard_signs"("tenantId", "nameNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "standard_signs_tenantId_signKey_key" ON "standard_signs"("tenantId", "signKey");

-- AddForeignKey
ALTER TABLE "bid_estimate_workflows" ADD CONSTRAINT "bid_estimate_workflows_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_estimate_workflows" ADD CONSTRAINT "bid_estimate_workflows_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "estimates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_estimate_workflows" ADD CONSTRAINT "bid_estimate_workflows_lastSavedById_fkey" FOREIGN KEY ("lastSavedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_source_files" ADD CONSTRAINT "bid_source_files_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_source_files" ADD CONSTRAINT "bid_source_files_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "estimates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_source_files" ADD CONSTRAINT "bid_source_files_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_source_files" ADD CONSTRAINT "bid_source_files_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "bid_source_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_source_rows" ADD CONSTRAINT "bid_source_rows_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_source_rows" ADD CONSTRAINT "bid_source_rows_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "estimates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_source_rows" ADD CONSTRAINT "bid_source_rows_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "bid_source_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_source_rows" ADD CONSTRAINT "bid_source_rows_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "estimate_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_line_details" ADD CONSTRAINT "bid_line_details_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_line_details" ADD CONSTRAINT "bid_line_details_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "estimates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_line_details" ADD CONSTRAINT "bid_line_details_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "estimate_line_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_line_details" ADD CONSTRAINT "bid_line_details_standardSignId_fkey" FOREIGN KEY ("standardSignId") REFERENCES "standard_signs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_questions" ADD CONSTRAINT "bid_questions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_questions" ADD CONSTRAINT "bid_questions_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "estimates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_questions" ADD CONSTRAINT "bid_questions_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "estimate_line_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_questions" ADD CONSTRAINT "bid_questions_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standard_signs" ADD CONSTRAINT "standard_signs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standard_signs" ADD CONSTRAINT "standard_signs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

