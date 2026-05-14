-- SpendAlert lifecycle: SUPERSEDED status, identityKey, supersede provenance.
-- Removes legacy RESOLVED by migrating rows to SUPERSEDED.

ALTER TABLE "spend_alerts" ADD COLUMN "identityKey" VARCHAR(64);
ALTER TABLE "spend_alerts" ADD COLUMN "supersededAt" TIMESTAMP(3);
ALTER TABLE "spend_alerts" ADD COLUMN "supersededByReconciliationId" TEXT;

UPDATE "spend_alerts" SET "identityKey" = "dedupeKey" WHERE "identityKey" IS NULL;

ALTER TABLE "spend_alerts" ALTER COLUMN "identityKey" SET NOT NULL;

ALTER TABLE "spend_alerts" ADD CONSTRAINT "spend_alerts_supersededByReconciliationId_fkey"
  FOREIGN KEY ("supersededByReconciliationId") REFERENCES "po_reconciliations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "spend_alerts_tenant_po_status_idx" ON "spend_alerts"("tenantId", "purchaseOrderId", "status");

ALTER TABLE "spend_alerts" ALTER COLUMN "status" DROP DEFAULT;

CREATE TYPE "SpendAlertStatus_new" AS ENUM ('OPEN', 'DISMISSED', 'SUPERSEDED');

ALTER TABLE "spend_alerts" ALTER COLUMN "status" TYPE "SpendAlertStatus_new" USING (
  CASE "status"::text
    WHEN 'OPEN' THEN 'OPEN'::"SpendAlertStatus_new"
    WHEN 'DISMISSED' THEN 'DISMISSED'::"SpendAlertStatus_new"
    WHEN 'RESOLVED' THEN 'SUPERSEDED'::"SpendAlertStatus_new"
    ELSE 'SUPERSEDED'::"SpendAlertStatus_new"
  END
);

DROP TYPE "SpendAlertStatus";

ALTER TYPE "SpendAlertStatus_new" RENAME TO "SpendAlertStatus";

ALTER TABLE "spend_alerts" ALTER COLUMN "status" SET DEFAULT 'OPEN'::"SpendAlertStatus";
