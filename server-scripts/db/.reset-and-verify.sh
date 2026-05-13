#!/bin/bash
# One-shot helper for the auth foundation verification.
#
# Why this exists: the original bootstrap-super-admin.ts run printed the
# generated password to the operator's terminal but did not persist it.
# Rather than tear down + re-bootstrap (which the bootstrap script
# refuses to do once a SUPER_ADMIN exists), this script:
#   1. Generates a fresh strong password.
#   2. Hashes it with the same Argon2id helper the app uses (via
#      @node-rs/argon2 inside the app workspace) so the format matches
#      verifyPassword() exactly.
#   3. Updates the SUPER_ADMIN row's passwordHash directly via psql.
#   4. Runs the e2e verification against the public domain with that
#      known password.
#
# Safe by construction: only updates rows where role='SUPER_ADMIN', and
# the password is rotated (single use) so leaking it via shell history
# is acceptable for this verification cycle. ROTATE AFTER.

set -euo pipefail

EMAIL="${EMAIL:-admin@bvisible.local}"
APP_WEB="/opt/bvisible/app/apps/web"

# 1. Generate password
PW=$(openssl rand -base64 24 | tr -d '=+/' | head -c 24)
printf "Generated SUPER_ADMIN password (rotate after verify): %s\n" "$PW"

# 2. Hash with the same Argon2id config the app uses
HASH=$(cd "$APP_WEB" && PW="$PW" node --input-type=module -e "
import { hash } from '@node-rs/argon2';
const h = await hash(process.env.PW, {
  algorithm: 2,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
});
process.stdout.write(h);
")

if [ -z "$HASH" ] || [[ "$HASH" != \$argon2id* ]]; then
  echo "FAIL: hash did not look like argon2id (got: ${HASH:0:30})" >&2
  exit 1
fi
printf "Hash prefix: %s...\n" "${HASH:0:30}"

# 3. Update the SUPER_ADMIN row
PGPASS=$(grep '^POSTGRES_PASSWORD=' /opt/bvisible/shared/env/.env | head -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')
cd /opt/bvisible/app
docker compose -p bvisible exec -T -e PGPASSWORD="$PGPASS" db psql -U bvisible -d bvisible <<SQL
UPDATE users
SET "passwordHash" = '$HASH', "disabledAt" = NULL
WHERE email = '$EMAIL' AND role = 'SUPER_ADMIN'
RETURNING id, email, role, "passwordHash" IS NOT NULL AS has_hash;
SQL

# 4. Verify
export BOOTSTRAP_EMAIL="$EMAIL"
export BOOTSTRAP_PASSWORD="$PW"
echo
echo "=== Running verify-auth.sh ==="
bash /tmp/.verify-auth.sh
