#!/usr/bin/env bash
# server-scripts/db/.verify-single-company-mode.sh
#
# Run on the deploy host from the repo root that holds docker-compose.yml, e.g.
#   cd /opt/bvisible/app && bash server-scripts/db/.verify-single-company-mode.sh
#
# Exit codes:
#   0 — checks passed
#   2 — env / compose / DB connectivity failure
#   3 — slug `bvisible` missing or duplicate
#   4 — more than one tenants row (ambiguous single-company mode)

set -uo pipefail

ENV_FILE="${BV_ENV_FILE:-/opt/bvisible/shared/env/.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "[verify-single-company] FATAL: env file not found at $ENV_FILE"
  exit 2
fi

read_env_var() {
  grep -E "^${1}=" "$ENV_FILE" | tail -n 1 | sed -E "s/^${1}=//; s/^\"(.*)\"$/\\1/; s/^'(.*)'$/\\1/"
}

POSTGRES_DB="$(read_env_var POSTGRES_DB)"
POSTGRES_USER="$(read_env_var POSTGRES_USER)"
PGPASSWORD="$(read_env_var POSTGRES_PASSWORD)"
export PGPASSWORD

if [ -z "${POSTGRES_DB:-}" ] || [ -z "${POSTGRES_USER:-}" ] || [ -z "${PGPASSWORD:-}" ]; then
  echo "[verify-single-company] FATAL: POSTGRES_{DB,USER,PASSWORD} required in $ENV_FILE"
  exit 2
fi

COMPOSE_PROJECT_NAME="bvisible"
export COMPOSE_PROJECT_NAME

if ! docker compose -p bvisible ps db --format '{{.State}}' 2>/dev/null | grep -q running; then
  echo "[verify-single-company] FATAL: postgres container not running"
  exit 2
fi

psql_q() {
  docker compose -p bvisible exec -T -e PGPASSWORD="$PGPASSWORD" db \
    psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"
}

TOTAL="$(psql_q "SELECT COUNT(*)::text FROM tenants")"
BV_COUNT="$(psql_q "SELECT COUNT(*)::text FROM tenants WHERE slug = 'bvisible'")"
BV_NAME="$(psql_q "SELECT name FROM tenants WHERE slug = 'bvisible' ORDER BY \"createdAt\" ASC LIMIT 1")"

if ! [[ "$BV_COUNT" =~ ^[0-9]+$ ]] || ! [[ "$TOTAL" =~ ^[0-9]+$ ]]; then
  echo "[verify-single-company] FATAL: unexpected SQL output (TOTAL='$TOTAL' BV_COUNT='$BV_COUNT')"
  exit 2
fi

if [ "$BV_COUNT" != "1" ]; then
  echo "[verify-single-company] FAIL: expected exactly 1 row with slug=bvisible, got $BV_COUNT"
  exit 3
fi

if [ "$TOTAL" -gt 1 ]; then
  echo "[verify-single-company] FAIL: multiple companies ($TOTAL rows). Resolve extras before relying on single-company mode."
  exit 4
fi

if [ "$BV_NAME" != "B Visible" ]; then
  echo "[verify-single-company] WARN: canonical name is '$BV_NAME' (expected 'B Visible')"
fi

ADMIN_EXISTS="$(psql_q "SELECT COUNT(*)::text FROM users WHERE email = 'admin@bvisible.local'")"
if [ "$ADMIN_EXISTS" != "1" ]; then
  echo "[verify-single-company] WARN: expected exactly 1 admin@bvisible.local user, found $ADMIN_EXISTS"
fi

unset PGPASSWORD

echo "[verify-single-company] OK tenants_total=$TOTAL slug_bvisible_rows=$BV_COUNT name='$BV_NAME'"
