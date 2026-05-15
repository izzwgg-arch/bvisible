-- Public quote customer accept/decline + estimate timeline events.

CREATE TYPE "EstimateTimelineKind" AS ENUM ('QUOTE_ACCEPTED', 'QUOTE_DECLINED');

CREATE TABLE "estimate_timeline_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "kind" "EstimateTimelineKind" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estimate_timeline_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "estimate_timeline_events_tenantId_estimateId_createdAt_idx" ON "estimate_timeline_events"("tenantId", "estimateId", "createdAt");

ALTER TABLE "estimate_timeline_events" ADD CONSTRAINT "estimate_timeline_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "estimate_timeline_events" ADD CONSTRAINT "estimate_timeline_events_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "estimates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "estimate_quote_links" ADD COLUMN "acceptedAt" TIMESTAMP(3),
ADD COLUMN "acceptedByName" TEXT,
ADD COLUMN "acceptedNote" TEXT,
ADD COLUMN "declinedAt" TIMESTAMP(3),
ADD COLUMN "declinedByName" TEXT,
ADD COLUMN "declinedNote" TEXT,
ADD COLUMN "respondedAt" TIMESTAMP(3),
ADD COLUMN "responseIp" TEXT,
ADD COLUMN "responseUserAgent" TEXT;
