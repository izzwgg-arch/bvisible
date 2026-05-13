#!/usr/bin/env bash
# One-off bootstrap verification: confirms the live DB has the foundation
# tables and that 5432 is not exposed publicly.
set -euo pipefail
ENV_FILE=/opt/bvisible/shared/env/.env

PW=$(grep '^POSTGRES_PASSWORD=' "$ENV_FILE" | head -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')
USER=$(grep '^POSTGRES_USER=' "$ENV_FILE" | head -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')
DB=$(grep '^POSTGRES_DB=' "$ENV_FILE" | head -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')

echo '--- _prisma_migrations ---'
docker compose -p bvisible exec -T -e PGPASSWORD="$PW" db \
  psql -At -U "$USER" -d "$DB" \
  -c "select migration_name, finished_at is not null as applied from _prisma_migrations"

echo '--- tables ---'
docker compose -p bvisible exec -T -e PGPASSWORD="$PW" db \
  psql -At -U "$USER" -d "$DB" -c '\dt'

echo '--- 5432 listening ---'
ss -tlnp | grep ':5432' || echo 'nothing on 5432'
echo '--- 5432 publicly reachable? (should be empty) ---'
ss -tln src 0.0.0.0:5432 || true
echo '--- ufw status numbered (no 5432 expected) ---'
ufw status numbered | grep 5432 || echo 'no ufw rule for 5432 (good)'
