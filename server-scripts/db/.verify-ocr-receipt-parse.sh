#!/usr/bin/env bash
# Deterministic OCR parsing checks (no DB, no filesystem OCR).
set -euo pipefail
cd "$(dirname "$0")/../.."
pnpm --filter @bvisible/web exec vitest run \
  lib/ocr/parse-receipt.test.ts \
  lib/ocr/enqueue.test.ts \
  lib/vendor-pricing/dedupe-key.test.ts
