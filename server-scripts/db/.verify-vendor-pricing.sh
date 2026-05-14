#!/usr/bin/env bash
# Deterministic vendor pricing verification (Postgres + Prisma, no IMAP).
#
# Usage (production deploy box as deploy):
#   bash server-scripts/db/.verify-vendor-pricing.sh
#
# Loads DATABASE_URL from /opt/bvisible/shared/env/.env when present.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
WEB_DIR="${REPO_ROOT}/apps/web"

if [[ -f /opt/bvisible/shared/env/.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source /opt/bvisible/shared/env/.env
  set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  printf '%s\n' "FAIL: DATABASE_URL is unset (source .env or export DATABASE_URL)" >&2
  exit 1
fi

cd "${WEB_DIR}"
pnpm exec tsx --tsconfig tsconfig.json scripts/verify-vendor-pricing.ts
