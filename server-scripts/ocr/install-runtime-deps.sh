#!/usr/bin/env bash
# Install host OCR runtime packages (Ubuntu/Debian apt only).
# Idempotent: safe to re-run; installs only tesseract-ocr + poppler-utils.
set -euo pipefail

log() { echo "== $* =="; }

if ! command -v apt-get >/dev/null 2>&1; then
  echo "FATAL: apt-get not found — this script supports Debian/Ubuntu only." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

log "apt update"
apt-get update -y

log "install tesseract-ocr + poppler-utils"
apt-get install -y --no-install-recommends tesseract-ocr poppler-utils

log "verify tesseract"
tesseract --version | head -n 1

log "verify pdftoppm"
pdftoppm -v 2>&1 | head -n 1

echo "OK — OCR host runtime dependencies installed."
