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

# Database
DATABASE_URL=postgresql://bv:***@db:5432/bvisible
DIRECT_URL=postgresql://bv:***@db:5432/bvisible   # for prisma migrate

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
