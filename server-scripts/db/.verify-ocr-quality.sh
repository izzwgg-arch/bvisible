#!/usr/bin/env bash
# OCR extraction quality checks (fixtures + parsing rules). No secrets printed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "== host: tesseract =="
command -v tesseract >/dev/null
tesseract --version | head -n 1

echo "== host: pdftoppm =="
command -v pdftoppm >/dev/null
pdftoppm -v 2>&1 | head -n 1

echo "== vitest: verify:ocr-quality =="
pnpm --filter @bvisible/web run verify:ocr-quality

echo "== vitest: verify:ocr-reconciliation-flow =="
pnpm --filter @bvisible/web run verify:ocr-reconciliation-flow

if [ -f server-scripts/db/.verify-ocr-runtime.sh ]; then
  echo "== runtime tick posture =="
  bash server-scripts/db/.verify-ocr-runtime.sh
fi

echo "OK — OCR quality verification complete."
