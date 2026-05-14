-- PO reconciliation + spend intelligence foundation (Phase).
-- Deterministic PO-line ↔ OCR_APPROVED VendorPriceHistory pairing snapshots + SpendAlert rows.
-- Nothing mutates PO financial fields automatically.

CREATE TYPE "POReconciliationStatus" AS ENUM ('PENDING', 'PARTIAL', 'MATCHED', 'VARIANCE', 'REVIEW_REQUIRED', 'RESOLVED');

CREATE TYPE "POReconciliationLineMatch" AS ENUM (
  'MATCHED',
  'PRICE_VARIANCE',
  'QTY_VARIANCE',
  'PRICE_AND_QTY_VARIANCE',
  'UNMATCHED_PO_LINE',
  'UNMATCHED_RECEIPT_LINE',
  'AMBIGUOUS_PO_LINE',
  'AMBIGUOUS_RECEIPT_LINE'
);

CREATE TYPE "POReconciliationLineResolution" AS ENUM ('NONE', 'CONFIRMED_PAIR', 'ACCEPTED_VARIANCE', 'REJECTED_PAIR');

CREATE TYPE "SpendAlertKind" AS ENUM (
  'PRICE_OVER_PO_EXPECTED',
  'QTY_MISMATCH',
  'UNMATCHED_RECEIPT_LINE',
  'MISSING_PO_RECEIPT_LINE',
  'RECONCILIATION_AMBIGUOUS',
  'PO_TOTAL_OVER_EXPECTED'
);

CREATE TYPE "SpendAlertStatus" AS ENUM ('OPEN', 'DISMISSED', 'RESOLVED');

ALTER TABLE "purchase_orders"
  ADD COLUMN "operatorMarkedReconciledAt" TIMESTAMP(3),
  ADD COLUMN "operatorMarkedReconciledById" TEXT;

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_operatorMarkedReconciledById_fkey"
  FOREIGN KEY ("operatorMarkedReconciledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "po_reconciliations" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "status" "POReconciliationStatus" NOT NULL DEFAULT 'PENDING',
  "triggerDedupeKey" VARCHAR(64) NOT NULL,
  "summary" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,

  CONSTRAINT "po_reconciliations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "po_reconciliations_tenantId_triggerDedupeKey_key" ON "po_reconciliations"("tenantId", "triggerDedupeKey");
CREATE INDEX "po_reconciliations_tenantId_purchaseOrderId_createdAt_idx" ON "po_reconciliations"("tenantId", "purchaseOrderId", "createdAt");

ALTER TABLE "po_reconciliations"
  ADD CONSTRAINT "po_reconciliations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "po_reconciliations"
  ADD CONSTRAINT "po_reconciliations_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "po_reconciliations"
  ADD CONSTRAINT "po_reconciliations_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "po_reconciliation_lines" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "poReconciliationId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "poLineItemId" TEXT,
  "vendorPriceHistoryId" TEXT,
  "match" "POReconciliationLineMatch" NOT NULL,
  "expectedQtyMilli" INTEGER,
  "expectedUnitCostCents" INTEGER,
  "observedQtyMilli" INTEGER,
  "observedUnitPriceCents" INTEGER,
  "priceVarianceCents" INTEGER,
  "qtyVarianceMilli" INTEGER,
  "resolution" "POReconciliationLineResolution" NOT NULL DEFAULT 'NONE',
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,

  CONSTRAINT "po_reconciliation_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "po_reconciliation_lines_poReconciliationId_sortOrder_key" ON "po_reconciliation_lines"("poReconciliationId", "sortOrder");
CREATE INDEX "po_reconciliation_lines_tenantId_poReconciliationId_idx" ON "po_reconciliation_lines"("tenantId", "poReconciliationId");

ALTER TABLE "po_reconciliation_lines"
  ADD CONSTRAINT "po_reconciliation_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "po_reconciliation_lines"
  ADD CONSTRAINT "po_reconciliation_lines_poReconciliationId_fkey" FOREIGN KEY ("poReconciliationId") REFERENCES "po_reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "po_reconciliation_lines"
  ADD CONSTRAINT "po_reconciliation_lines_poLineItemId_fkey" FOREIGN KEY ("poLineItemId") REFERENCES "po_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "po_reconciliation_lines"
  ADD CONSTRAINT "po_reconciliation_lines_vendorPriceHistoryId_fkey" FOREIGN KEY ("vendorPriceHistoryId") REFERENCES "vendor_price_histories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "po_reconciliation_lines"
  ADD CONSTRAINT "po_reconciliation_lines_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "spend_alerts" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "purchaseOrderId" TEXT,
  "vendorId" TEXT,
  "poReconciliationId" TEXT,
  "kind" "SpendAlertKind" NOT NULL,
  "status" "SpendAlertStatus" NOT NULL DEFAULT 'OPEN',
  "title" VARCHAR(200) NOT NULL,
  "body" VARCHAR(900) NOT NULL,
  "dedupeKey" VARCHAR(64) NOT NULL,
  "metadata" JSONB,
  "dismissedAt" TIMESTAMP(3),
  "dismissedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "spend_alerts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "spend_alerts_tenantId_dedupeKey_key" ON "spend_alerts"("tenantId", "dedupeKey");
CREATE INDEX "spend_alerts_tenantId_status_createdAt_idx" ON "spend_alerts"("tenantId", "status", "createdAt");
CREATE INDEX "spend_alerts_tenantId_vendorId_idx" ON "spend_alerts"("tenantId", "vendorId");

ALTER TABLE "spend_alerts"
  ADD CONSTRAINT "spend_alerts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "spend_alerts"
  ADD CONSTRAINT "spend_alerts_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "spend_alerts"
  ADD CONSTRAINT "spend_alerts_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "spend_alerts"
  ADD CONSTRAINT "spend_alerts_poReconciliationId_fkey" FOREIGN KEY ("poReconciliationId") REFERENCES "po_reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "spend_alerts"
  ADD CONSTRAINT "spend_alerts_dismissedById_fkey" FOREIGN KEY ("dismissedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "spend_alerts"
  ADD CONSTRAINT "spend_alerts_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
