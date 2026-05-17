#!/usr/bin/env bash
# Run Playwright smoke suites with optional ~/.bvisible-smoke.env (never prints secrets).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [ -f "${HOME}/.bvisible-smoke.env" ]; then
  echo "[smoke] Loading ${HOME}/.bvisible-smoke.env (values not echoed)"
  set -a
  # shellcheck source=/dev/null
  source "${HOME}/.bvisible-smoke.env"
  set +a
else
  echo "[smoke] No ~/.bvisible-smoke.env — set BVISIBLE_* env vars or create from server-scripts/smoke/.bvisible-smoke.env.example"
fi

missing=0
for v in BVISIBLE_BASE_URL BVISIBLE_ADMIN_EMAIL BVISIBLE_ADMIN_PASSWORD; do
  if [ -z "${!v:-}" ]; then
    echo "[smoke] MISSING: $v"
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  echo "[smoke] Aborting — credentials required for Playwright smoke."
  exit 2
fi

export BVISIBLE_BASE_URL
export BVISIBLE_ADMIN_EMAIL
export BVISIBLE_ADMIN_PASSWORD

echo "[smoke] Target: ${BVISIBLE_BASE_URL}"
echo "[smoke] Installing chromium if needed..."
pnpm --filter @bvisible/web exec playwright install chromium

SUITE="${1:-all}"
case "$SUITE" in
  core) pnpm --filter @bvisible/web run smoke:core ;;
  vendor) pnpm --filter @bvisible/web run smoke:vendor-normalization ;;
  po-lifecycle) pnpm --filter @bvisible/web run smoke:po-lifecycle ;;
  all)
    pnpm --filter @bvisible/web run smoke:core
    pnpm --filter @bvisible/web run smoke:vendor-normalization
    pnpm --filter @bvisible/web run smoke:po-lifecycle
    ;;
  *) echo "usage: $0 [core|vendor|po-lifecycle|all]" >&2; exit 64 ;;
esac

echo "[smoke] Done."
