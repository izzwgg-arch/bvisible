#!/usr/bin/env bash
# Run fixture-backed email ingestion smoke on the server (no IMAP).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
if [ -f /opt/bvisible/shared/env/.env ]; then
  set -a
  # shellcheck disable=SC1091
  source /opt/bvisible/shared/env/.env
  set +a
fi
cd /opt/bvisible/app
pnpm --filter @bvisible/web exec tsx --tsconfig tsconfig.json scripts/smoke-email-ingestion-live.ts
