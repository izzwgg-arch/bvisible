#!/usr/bin/env bash
# Deterministic checks that core ingest idempotency + routing markers exist.
# Run from repo root on Linux/macOS/Git Bash (deploy box or CI).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "== Prisma: IngestedEmail dedupe key @@unique([tenantId, messageId]) =="
grep -nF '@@unique([tenantId, messageId])' packages/db/prisma/schema.prisma

echo "== Code: ingest upsert keyed by tenantId + messageId =="
grep -n 'tenantId, messageId' apps/web/lib/email-ingest/run.ts | head -n 12

echo "OK — email ingestion invariants present."
