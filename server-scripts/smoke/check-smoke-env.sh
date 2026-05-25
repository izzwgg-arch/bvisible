#!/usr/bin/env bash
# Read-only smoke credential check — never prints passwords or mutates files.
# Usage: bash server-scripts/smoke/check-smoke-env.sh
set -euo pipefail

SMOKE_HOME="${HOME:-${USERPROFILE:-}}"
ENV_FILE="${SMOKE_HOME}/.bvisible-smoke.env"

if [ -z "$SMOKE_HOME" ]; then
  echo "[smoke-env] ERROR: HOME and USERPROFILE are unset — cannot locate ~/.bvisible-smoke.env"
  exit 2
fi

if [ -f "$ENV_FILE" ]; then
  echo "[smoke-env] Found credential file: $ENV_FILE"
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
else
  echo "[smoke-env] No credential file at: $ENV_FILE"
  echo "[smoke-env] Copy server-scripts/smoke/.bvisible-smoke.env.example and set BVISIBLE_ADMIN_PASSWORD locally."
fi

missing=0
for v in BVISIBLE_BASE_URL BVISIBLE_ADMIN_EMAIL BVISIBLE_ADMIN_PASSWORD; do
  if [ -z "${!v:-}" ]; then
    echo "[smoke-env] MISSING: $v"
    missing=1
  fi
done

if [ "$missing" -ne 0 ]; then
  echo "[smoke-env] FAIL — export missing vars or add them to $ENV_FILE (never commit passwords)."
  exit 2
fi

echo "[smoke-env] OK — credentials present"
echo "[smoke-env] BVISIBLE_BASE_URL=${BVISIBLE_BASE_URL}"
echo "[smoke-env] BVISIBLE_ADMIN_EMAIL=${BVISIBLE_ADMIN_EMAIL}"
echo "[smoke-env] BVISIBLE_ADMIN_PASSWORD=(set, not shown)"
exit 0
