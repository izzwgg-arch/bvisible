-- Deterministic operational review codes for /admin/email-ingestion (JSON string array).
ALTER TABLE "ingested_emails" ADD COLUMN "reviewReasonCodes" JSONB NOT NULL DEFAULT '[]';
