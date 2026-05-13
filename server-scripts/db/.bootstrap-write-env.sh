#!/usr/bin/env bash
# One-off bootstrap: write Postgres credentials into the shared .env if not
# already present. Run as root on the server. Idempotent.
# This script lives in the repo with a leading-dot filename so it does not
# get scp'd by accident with the rest of server-scripts/db/. It is also
# tracked in git for audit, but contains NO secrets — only the logic that
# generates them at run time.
set -euo pipefail

ENV_FILE=/opt/bvisible/shared/env/.env

if grep -q '^DATABASE_URL=' "$ENV_FILE" 2>/dev/null; then
  echo "DATABASE_URL already present in $ENV_FILE — leaving it alone"
else
  PW="$(openssl rand -base64 24 | tr -d '=+/' | cut -c1-32)"
  umask 027
  {
    echo '# Postgres (managed by docker compose; bound to 127.0.0.1:5432 only)'
    echo 'POSTGRES_DB=bvisible'
    echo 'POSTGRES_USER=bvisible'
    echo "POSTGRES_PASSWORD=${PW}"
    # Double-quote the URL so bash sourcing handles the unquoted `&` in the
    # query string (otherwise `set -a; . .env` background-forks the line).
    echo "DATABASE_URL=\"postgresql://bvisible:${PW}@127.0.0.1:5432/bvisible?schema=public&connection_limit=20\""
  } >> "$ENV_FILE"
  chown deploy:deploy "$ENV_FILE"
  chmod 640 "$ENV_FILE"
  echo "wrote 5 env lines to $ENV_FILE (password generated, NOT echoed)"
fi

ls -la "$ENV_FILE"
echo '--- env keys present (values redacted) ---'
sed -E 's/=.*/=***/' "$ENV_FILE"
