#!/usr/bin/env bash
# /opt/bvisible/deploy-queue/db-verify.sh
#
# Confirms the Postgres database is reachable, has the Prisma migration
# history table, and contains the foundation tables (tenants, users).
# Used by deploy-once.sh as the post-migration sanity step, and runnable
# by hand for troubleshooting (see DEBUGGING.md).
#
# Reads connection details from /opt/bvisible/shared/env/.env (override
# with BV_ENV_FILE). All psql calls go through `docker compose exec` to
# avoid installing psql on the host.
#
# Exit codes:
#   0  healthy
#   2  env file or required vars missing
#   3  postgres container not running
#   4  cannot connect to postgres
#   5  _prisma_migrations table missing (no migrations applied)
#   6  expected foundation table missing (tenants / users)

set -uo pipefail

ENV_FILE="${BV_ENV_FILE:-/opt/bvisible/shared/env/.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "[db-verify] FATAL: env file not found at $ENV_FILE"
  exit 2
fi

# Minimal env parser: only DATABASE_URL / POSTGRES_DB / POSTGRES_USER /
# POSTGRES_PASSWORD. Strips matching surrounding quotes. Keeps the rest of
# the .env (which may hold app secrets) out of this script's environment.
read_env_var() {
  grep -E "^${1}=" "$ENV_FILE" | tail -n 1 | sed -E "s/^${1}=//; s/^\"(.*)\"$/\\1/; s/^'(.*)'$/\\1/"
}

POSTGRES_DB="$(read_env_var POSTGRES_DB)"
POSTGRES_USER="$(read_env_var POSTGRES_USER)"
PGPASSWORD="$(read_env_var POSTGRES_PASSWORD)"
export PGPASSWORD

if [ -z "${POSTGRES_DB:-}" ] || [ -z "${POSTGRES_USER:-}" ] || [ -z "${PGPASSWORD:-}" ]; then
  echo "[db-verify] FATAL: POSTGRES_{DB,USER,PASSWORD} must all be set in $ENV_FILE"
  exit 2
fi

# All compose calls use the project name pinned in docker-compose.yml so
# they hit the same container regardless of cwd.
COMPOSE_PROJECT_NAME="bvisible"
export COMPOSE_PROJECT_NAME

# Container running?
if ! docker compose -p bvisible ps db --format '{{.State}}' 2>/dev/null | grep -q running; then
  echo "[db-verify] FATAL: postgres container 'bvisible-db' not running"
  docker compose -p bvisible ps db | head -n 10
  exit 3
fi
echo "[db-verify] container running"

psql_q() {
  docker compose -p bvisible exec -T -e PGPASSWORD="$PGPASSWORD" db \
    psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"
}

# Connection
if ! psql_q "select 1" >/dev/null; then
  echo "[db-verify] FATAL: cannot connect to postgres"
  exit 4
fi
echo "[db-verify] connection OK"

# _prisma_migrations table exists
HAS_MIG_TABLE="$(psql_q "select to_regclass('public._prisma_migrations') is not null")"
if [ "$HAS_MIG_TABLE" != "t" ]; then
  echo "[db-verify] FATAL: _prisma_migrations table missing — run 'prisma migrate deploy'"
  exit 5
fi
echo "[db-verify] _prisma_migrations table OK"

# Foundation tables (the ones the init migration creates)
for t in tenants users; do
  HAS="$(psql_q "select to_regclass('public.${t}') is not null")"
  if [ "$HAS" != "t" ]; then
    echo "[db-verify] FATAL: table '${t}' missing"
    exit 6
  fi
done
echo "[db-verify] tenants, users tables OK"

# How many migrations applied (info only)
COUNT="$(psql_q "select count(*) from public._prisma_migrations where finished_at is not null")"
LAST="$(psql_q "select migration_name from public._prisma_migrations order by finished_at desc nulls last limit 1")"
echo "[db-verify] applied migrations: ${COUNT} (latest: ${LAST:-none})"

unset PGPASSWORD
exit 0
