-- Bundle grouping on estimate lines. Components of a bundle stay real
-- line rows (keeping their kind, catalog link, markup rule and PO
-- expansion) and are tied together by a shared lineGroupId so the
-- editor can render them as one collapsible bundle row.

-- AlterTable
ALTER TABLE "estimate_line_items" ADD COLUMN "lineGroupId" VARCHAR(40);
ALTER TABLE "estimate_line_items" ADD COLUMN "lineGroupLabel" TEXT;

-- CreateIndex
CREATE INDEX "estimate_line_items_estimateId_lineGroupId_idx" ON "estimate_line_items"("estimateId", "lineGroupId");
