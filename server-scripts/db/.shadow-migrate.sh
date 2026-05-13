#!/bin/bash
# Generate a Prisma migration on the production server WITHOUT touching
# the production database, by applying existing migrations to a shadow
# Postgres on 127.0.0.1:5433, then running `prisma migrate dev
# --create-only` against it. Manually appends the partial unique index
# for SUPER_ADMIN emails (Prisma's schema language can't express it).
# Tears down the shadow at the end.
#
# Usage on server:
#   /tmp/.shadow-migrate.sh /tmp/new-schema.prisma auth_and_invites
#   /tmp/.shadow-migrate.sh /tmp/new-schema.prisma auth_and_invites --append-superadmin-index
#
# Outputs the new migration directory path to stdout. Caller scp's it
# back to the local repo.
#
# The third argument controls whether to hand-append the SUPER_ADMIN
# partial unique index. Pass `--append-superadmin-index` ONLY for the
# initial auth migration that introduces the constraint; subsequent
# migrations leave it out (the index already exists in production and
# re-creating it in another migration's SQL would error).

set -euo pipefail

SCHEMA_SRC="${1:-}"
MIGRATION_NAME="${2:-}"
APPEND_SUPERADMIN_INDEX="${3:-}"

if [[ -z "$SCHEMA_SRC" || -z "$MIGRATION_NAME" ]]; then
  echo "usage: $0 <path-to-new-schema.prisma> <migration-name> [--append-superadmin-index]" >&2
  exit 64
fi

SHADOW_DIR=/tmp/shadow-migrate
SHADOW_PG_DIR=/tmp/shadow-pg
SHADOW_DB_NAME=bvisible_shadow
SHADOW_DB_USER=shadow
SHADOW_DB_PASS=shadow_pass_dev_only
SHADOW_PORT=5433
SHADOW_PROJECT=bvisible-shadow
APP_DIR=/opt/bvisible/app

cleanup() {
  echo "--- shadow-migrate: tearing down shadow Postgres" >&2
  docker compose -p "$SHADOW_PROJECT" -f "$SHADOW_PG_DIR/docker-compose.yml" down -v 2>/dev/null || true
}
trap cleanup EXIT

# Hard-clean any prior run.
docker compose -p "$SHADOW_PROJECT" -f "$SHADOW_PG_DIR/docker-compose.yml" down -v 2>/dev/null || true
rm -rf "$SHADOW_DIR" "$SHADOW_PG_DIR"
mkdir -p "$SHADOW_DIR/prisma/migrations" "$SHADOW_PG_DIR"

# 1. Copy existing migrations into the shadow workspace.
cp -r "$APP_DIR/packages/db/prisma/migrations/." "$SHADOW_DIR/prisma/migrations/"

# 2. Place the new schema.prisma.
cp "$SCHEMA_SRC" "$SHADOW_DIR/prisma/schema.prisma"

echo "--- shadow-migrate: workspace contents" >&2
ls -la "$SHADOW_DIR/prisma/" >&2
ls -la "$SHADOW_DIR/prisma/migrations/" >&2

# 3. Compose for shadow Postgres on 127.0.0.1:5433 only.
cat > "$SHADOW_PG_DIR/docker-compose.yml" <<EOF
services:
  shadow:
    image: postgres:16-alpine
    container_name: bvisible-shadow-db
    environment:
      POSTGRES_DB: $SHADOW_DB_NAME
      POSTGRES_USER: $SHADOW_DB_USER
      POSTGRES_PASSWORD: $SHADOW_DB_PASS
    ports:
      - "127.0.0.1:$SHADOW_PORT:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $SHADOW_DB_USER -d $SHADOW_DB_NAME"]
      interval: 2s
      timeout: 3s
      retries: 30
EOF

echo "--- shadow-migrate: starting shadow Postgres" >&2
docker compose -p "$SHADOW_PROJECT" -f "$SHADOW_PG_DIR/docker-compose.yml" up -d

echo "--- shadow-migrate: waiting for ready" >&2
for i in $(seq 1 30); do
  if docker compose -p "$SHADOW_PROJECT" -f "$SHADOW_PG_DIR/docker-compose.yml" exec -T shadow pg_isready -U "$SHADOW_DB_USER" -d "$SHADOW_DB_NAME" >/dev/null 2>&1; then
    echo "--- shadow-migrate: shadow ready after ${i}s" >&2
    break
  fi
  sleep 1
  if [[ $i -eq 30 ]]; then
    echo "--- shadow-migrate: shadow never became ready" >&2
    exit 70
  fi
done

# 4. Apply existing migrations to the shadow.
export DATABASE_URL="postgresql://$SHADOW_DB_USER:$SHADOW_DB_PASS@127.0.0.1:$SHADOW_PORT/$SHADOW_DB_NAME?schema=public"
echo "--- shadow-migrate: applying existing migrations to shadow" >&2
( cd "$APP_DIR" && pnpm --filter @bvisible/db exec prisma migrate deploy --schema "$SHADOW_DIR/prisma/schema.prisma" )

# 5. Generate the new migration (--create-only does NOT apply yet).
echo "--- shadow-migrate: generating $MIGRATION_NAME" >&2
( cd "$APP_DIR" && pnpm --filter @bvisible/db exec prisma migrate dev --create-only --name "$MIGRATION_NAME" --schema "$SHADOW_DIR/prisma/schema.prisma" )

# 6. Locate the new migration dir.
NEW_DIR=$(ls -1d "$SHADOW_DIR/prisma/migrations/"*"_$MIGRATION_NAME" | head -n1)
if [[ -z "$NEW_DIR" || ! -d "$NEW_DIR" ]]; then
  echo "--- shadow-migrate: new migration directory not found" >&2
  ls -la "$SHADOW_DIR/prisma/migrations/" >&2
  exit 71
fi
echo "--- shadow-migrate: new migration at $NEW_DIR" >&2

# 7. (Optional) append partial unique index for SUPER_ADMIN emails.
#    Composite @@unique([tenantId, email]) doesn't catch NULL tenantIds
#    because Postgres treats NULLs as distinct. Only useful for the
#    one migration that originally introduced the User table; later
#    migrations would re-create an existing index and fail with 42P07.
if [[ "$APPEND_SUPERADMIN_INDEX" == "--append-superadmin-index" ]]; then
  cat >> "$NEW_DIR/migration.sql" <<'PSQL'

-- Partial unique index: SUPER_ADMIN users have tenantId = NULL. The
-- composite unique above does not catch them because Postgres treats
-- NULLs as distinct. Hand-added because Prisma's schema language can't
-- express partial indexes.
CREATE UNIQUE INDEX "users_email_super_admin_key"
  ON "users"("email")
  WHERE "tenantId" IS NULL;
PSQL
  echo "--- shadow-migrate: appended SUPER_ADMIN partial unique index" >&2
else
  echo "--- shadow-migrate: skipping SUPER_ADMIN partial unique index (pass --append-superadmin-index to include)" >&2
fi

# 8. Apply the new migration to the shadow to validate the SQL.
echo "--- shadow-migrate: applying new migration to shadow (validation)" >&2
( cd "$APP_DIR" && pnpm --filter @bvisible/db exec prisma migrate deploy --schema "$SHADOW_DIR/prisma/schema.prisma" )

# 9. Final report.
echo "--- shadow-migrate: SUCCESS"
echo "NEW_DIR=$NEW_DIR"
echo "--- migration.sql contents:"
cat "$NEW_DIR/migration.sql"
