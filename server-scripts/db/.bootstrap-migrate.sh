#!/usr/bin/env bash
# One-off bootstrap: generate the Prisma init migration on the server,
# applied to the live Postgres. Run as root on the server. Idempotent
# (prisma migrate dev is a no-op if the migration is already in
# _prisma_migrations).
#
# This script lives in the repo with a leading-dot filename so it does
# not get rsync'd by accident with the rest of server-scripts/db/.
set -euo pipefail

ENV_FILE=/opt/bvisible/shared/env/.env

if [ ! -f "$ENV_FILE" ]; then
  echo "FATAL: $ENV_FILE not found"
  exit 1
fi

# Source the env so Prisma sees DATABASE_URL.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

if [ -z "${DATABASE_URL:-}" ]; then
  echo "FATAL: DATABASE_URL not present after sourcing $ENV_FILE"
  exit 1
fi

echo "DATABASE_URL parsed: ${DATABASE_URL:0:35}... (truncated)"

cd /opt/bvisible/app
exec pnpm --filter @bvisible/db exec prisma migrate dev --name init --skip-seed
