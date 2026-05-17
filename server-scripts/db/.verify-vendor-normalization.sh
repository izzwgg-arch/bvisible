#!/usr/bin/env bash
# Deterministic vendor material normalization + estimator rail verification (no DB required).
#
# Usage (repo root or production deploy box):
#   bash server-scripts/db/.verify-vendor-normalization.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
WEB_DIR="${REPO_ROOT}/apps/web"

cd "${WEB_DIR}"

echo "== vitest: verify:vendor-catalog (normalization + catalog merge) =="
pnpm run verify:vendor-catalog

echo "== vitest: verify:estimate-pricing (pricing aggregate + trends) =="
pnpm run verify:estimate-pricing

echo "== vitest: verify:ocr-quality (OCR safety; no auto-apply) =="
pnpm run verify:ocr-quality

echo "PASS: vendor normalization regression bundles"
