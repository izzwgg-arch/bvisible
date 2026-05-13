#!/bin/bash
# Reset SUPER_ADMIN password to a fresh known value, then run the
# Phase 5 mailer verification.

set -euo pipefail
EMAIL="${EMAIL:-admin@bvisible.local}"
APP_WEB="/opt/bvisible/app/apps/web"

PW=$(openssl rand -base64 24 | tr -d '=+/' | head -c 24)
echo "Generated SUPER_ADMIN password (rotate after verify): $PW"

HASH=$(cd "$APP_WEB" && PW="$PW" node --input-type=module -e "
import { hash } from '@node-rs/argon2';
const h = await hash(process.env.PW, { algorithm: 2, memoryCost: 65536, timeCost: 3, parallelism: 1 });
process.stdout.write(h);
")

if [[ -z "$HASH" || "$HASH" != \$argon2id* ]]; then
  echo "FAIL: bad hash (got: ${HASH:0:30})" >&2; exit 1
fi
echo "Hash prefix: ${HASH:0:30}..."

PGPASS=$(grep '^POSTGRES_PASSWORD=' /opt/bvisible/shared/env/.env | head -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')
cd /opt/bvisible/app
docker compose -p bvisible exec -T -e PGPASSWORD="$PGPASS" db psql -U bvisible -d bvisible <<SQL
UPDATE users SET "passwordHash" = '$HASH', "disabledAt" = NULL
 WHERE email = '$EMAIL' AND role = 'SUPER_ADMIN'
RETURNING id, email, role;
SQL

export BOOTSTRAP_EMAIL="$EMAIL"
export BOOTSTRAP_PASSWORD="$PW"
echo
echo "=== Running .verify-mailer.sh ==="
bash /tmp/.verify-mailer.sh
