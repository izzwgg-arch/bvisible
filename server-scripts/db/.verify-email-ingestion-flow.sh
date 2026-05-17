#!/usr/bin/env bash
# Deterministic checks that core ingest idempotency + routing markers exist.
# Run from repo root on Linux/macOS/Git Bash (deploy box or CI).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "== Prisma: IngestedEmail dedupe key @@unique([tenantId, messageId]) =="
grep -nF '@@unique([tenantId, messageId])' packages/db/prisma/schema.prisma

echo "== Prisma: IngestedEmail reviewReasonCodes column =="
grep -n 'reviewReasonCodes' packages/db/prisma/schema.prisma | head -n 5

echo "== Code: review reason builder =="
grep -n "EMAIL_REVIEW_REASON_CODES" apps/web/lib/email-ingest/review-reasons.ts | head -n 3

echo "== Code: ingest upsert keyed by tenantId + messageId =="
grep -n 'tenantId, messageId' apps/web/lib/email-ingest/run.ts | head -n 12

echo "== Code: matcher — internal PO tokens before QBO ladder =="
grep -n "before loose QBO" apps/web/lib/email-ingest/match.ts | head -n 3

echo "== Code: inbound attachment size cap before write =="
grep -nE 'size_exceeded|MAX_UPLOAD_BYTES' apps/web/lib/email-ingest/storage.ts | head -n 12

echo "== Code: materialize idempotency (existing VENDOR_REPLY) =="
grep -n "POEventKind.VENDOR_REPLY" apps/web/lib/email-ingest/run.ts | head -n 12

echo "== Code: OCR enqueue from promoted email attachment =="
grep -n "enqueueOcrJobForPoAttachment" apps/web/lib/email-ingest/run.ts | head -n 8

echo "== Code: manual link server action =="
grep -Rn "manualLinkEmailToPoAction" apps/web/app --include="*.ts" | head -n 6

echo "== Vitest: verify:email-ingestion =="
pnpm --filter @bvisible/web run verify:email-ingestion

echo "== Vitest: verify:email-ingestion-fixtures =="
pnpm --filter @bvisible/web run verify:email-ingestion-fixtures

echo "== Vitest: verify:email-operational-safety =="
pnpm --filter @bvisible/web run verify:email-operational-safety

echo "OK — email ingestion invariants present."
