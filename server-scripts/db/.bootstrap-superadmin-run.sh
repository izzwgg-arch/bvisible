#!/bin/bash
# Run bootstrap-super-admin.ts on the deploy server. Generates a strong
# random password locally, prints it ONCE for the operator to capture,
# then runs the script with it. Verifies the SUPER_ADMIN row exists +
# the audit log row exists.

set -euo pipefail

EMAIL="${BOOTSTRAP_EMAIL:-admin@bvisible.local}"
NAME="${BOOTSTRAP_NAME:-B Visible Admin}"
PW="$(openssl rand -base64 24 | tr -d '=+/' | cut -c1-24)"

echo "================================================================"
echo "BOOTSTRAP SUPER_ADMIN"
echo "  email:    $EMAIL"
echo "  name:     $NAME"
echo "  password: $PW"
echo "ROTATE THIS PASSWORD IMMEDIATELY AFTER SIGNING IN."
echo "================================================================"

cd /opt/bvisible/app
( set -a; . /opt/bvisible/shared/env/.env; set +a; \
  BOOTSTRAP_ADMIN_EMAIL="$EMAIL" \
  BOOTSTRAP_ADMIN_PASSWORD="$PW" \
  BOOTSTRAP_ADMIN_NAME="$NAME" \
  pnpm --filter @bvisible/web run bootstrap:super-admin )

echo "--- DB verification:"
PGPASS=$(grep '^POSTGRES_PASSWORD=' /opt/bvisible/shared/env/.env | head -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')
docker compose -p bvisible exec -T -e PGPASSWORD="$PGPASS" db psql -U bvisible -d bvisible -c \
  "SELECT id, email, role, name, \"tenantId\", \"createdAt\" FROM users WHERE role = 'SUPER_ADMIN';"
docker compose -p bvisible exec -T -e PGPASSWORD="$PGPASS" db psql -U bvisible -d bvisible -c \
  "SELECT id, action, \"userId\", metadata, \"createdAt\" FROM audit_logs WHERE action = 'super_admin_bootstrapped';"
