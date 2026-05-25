#!/usr/bin/env bash
# Run Playwright smoke suites with optional ~/.bvisible-smoke.env (never prints secrets).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
bash "${SCRIPT_DIR}/check-smoke-env.sh"

SMOKE_HOME="${HOME:-${USERPROFILE:-}}"
if [ -f "${SMOKE_HOME}/.bvisible-smoke.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "${SMOKE_HOME}/.bvisible-smoke.env"
  set +a
fi

export BVISIBLE_BASE_URL BVISIBLE_ADMIN_EMAIL BVISIBLE_ADMIN_PASSWORD

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
