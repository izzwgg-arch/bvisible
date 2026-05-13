# ENVIRONMENT_VARIABLES — B Visible

`.env` lives **only** at `/opt/bvisible/shared/env/.env` on the server (mode
640, owned by `deploy:deploy`). It is symlinked into `/opt/bvisible/app/.env`
by `deploy-once.sh`. Do not commit it.

## Required keys (target)

```dotenv
# Core
NODE_ENV=production
APP_BASE_URL=https://app.example.com
NEXTAUTH_SECRET=                      # 32+ random bytes
SESSION_COOKIE_NAME=bv_session

# Database — Postgres in docker compose, bound to 127.0.0.1:5432 only.
# The `bvisible-web` PM2 process runs on the host (NOT in compose), so it
# reaches Postgres via localhost, not via a docker-network DNS name.
# IMPORTANT: double-quote the URL because the query string contains an
# unquoted `&` which would otherwise background-fork when bash sources the
# .env file. See DEBUGGING.md.
POSTGRES_DB=bvisible
POSTGRES_USER=bvisible
POSTGRES_PASSWORD=                    # 32+ random chars (openssl rand -base64 24 | tr -d '=+/' | cut -c1-32)
DATABASE_URL="postgresql://bvisible:***@127.0.0.1:5432/bvisible?schema=public&connection_limit=20"

# Redis (queues / cache)
REDIS_URL=redis://redis:6379

# Email ingestion (Google Workspace)
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=ingest@yourdomain.com
IMAP_APP_PASSWORD=                    # Google Workspace app password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=ingest@yourdomain.com
SMTP_APP_PASSWORD=                    # Google Workspace app password

# Storage
UPLOAD_ROOT=/opt/bvisible/shared/uploads

# QuickBooks (optional; required to finalize estimates)
QBO_CLIENT_ID=
QBO_CLIENT_SECRET=
QBO_REDIRECT_URI=

# Mobile push (optional)
EXPO_ACCESS_TOKEN=

# Observability
LOG_LEVEL=info
```

## Local dev

- Each developer keeps a personal `.env.local` in `apps/web/` (gitignored).
- Dev DB defaults to a local Postgres in Docker; never connect a dev box to
  the production DB.

## How to update server `.env`

1. SSH as `deploy`.
2. `sudo nano /opt/bvisible/shared/env/.env` (or `vim`).
3. `chmod 640 /opt/bvisible/shared/env/.env`
4. Re-deploy the affected services (the symlink already points at the file —
   restart picks up new values). See `DEPLOY_QUEUE.md`.

## Things that must NEVER be in this file

- Anything user-specific (use a per-user secrets store).
- TLS private keys (Let's Encrypt manages those under `/etc/letsencrypt/`).
- Other tenants' credentials — single tenant in this file; per-tenant secrets
  live in the DB encrypted at rest.

## Postgres bootstrap (one-off, server-side)

The `POSTGRES_*` and `DATABASE_URL` keys are populated once on the server
by `server-scripts/db/.bootstrap-write-env.sh`, which generates a
32-character password with `openssl rand`, writes the keys to
`/opt/bvisible/shared/env/.env` (mode 640, `deploy:deploy`), and never
echoes the password back. To regenerate (e.g. credential rotation):
remove the four lines from `.env` and re-run the bootstrap script. Then
update Postgres to accept the new password (`ALTER USER bvisible WITH
PASSWORD '...'`) inside the running container.
