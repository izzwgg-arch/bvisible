# ENVIRONMENT_VARIABLES — B Visible

`.env` lives **only** at `/opt/bvisible/shared/env/.env` on the server (mode
640, owned by `deploy:deploy`). It is symlinked into `/opt/bvisible/app/.env`
by `deploy-once.sh`. Do not commit it.

## Required keys (target)

```dotenv
# Core
NODE_ENV=production
APP_BASE_URL=https://app.example.com
# Session cookie name is hardcoded as `bv_session` in
# apps/web/lib/auth/session.ts (SESSION_COOKIE_NAME constant). Not env-tunable.
# We do NOT use NextAuth — sessions are DB-backed via the `Session` table.

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

# Email ingestion (Google Workspace) — IMAP side is unimplemented;
# these keys are placeholders for when the ingestion worker lands.
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=ingest@yourdomain.com
IMAP_APP_PASSWORD=                    # Google Workspace app password

# Outbound mailer (Phase 5) — used by invite, password reset, and
# the SUPER_ADMIN /settings/email-test page. Read at runtime by
# apps/web/lib/mailer.ts via Nodemailer (provider-agnostic SMTP).
SMTP_HOST=smtp.gmail.com              # any SMTP server; Gmail/Workspace works
SMTP_PORT=465                         # 465 (TLS-on-connect) or 587 (STARTTLS)
SMTP_USER=ingest@yourdomain.com       # SMTP auth user
SMTP_PASSWORD=                        # SMTP auth password / app password
SMTP_FROM="B Visible <ingest@yourdomain.com>"  # From: header
SMTP_SECURE=                          # optional; "true" forces TLS-on-connect, "false" forces STARTTLS/plain. Auto-inferred from port (465 → true) when blank.
SMTP_REPLY_TO=                        # optional; appears as Reply-To: on outbound mail

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

## SUPER_ADMIN bootstrap (one-off, never written to `.env`)

The first SUPER_ADMIN is created by
`apps/web/scripts/bootstrap-super-admin.ts`. It reads three env vars
**inline at invocation time** (NOT from `.env`) so they exist only in
the script's process:

| Var | Required | Notes |
|---|---|---|
| `BOOTSTRAP_ADMIN_EMAIL` | yes | Lowercased, RFC-shaped. |
| `BOOTSTRAP_ADMIN_PASSWORD` | yes | 12-128 chars. Argon2id-hashed before storage. |
| `BOOTSTRAP_ADMIN_NAME` | no | Display name. |

The exact one-shot command lives in `apps/web/scripts/README.md`.
Do not put `BOOTSTRAP_ADMIN_PASSWORD` in `/opt/bvisible/shared/env/.env`.

## Outbound SMTP (used by Phase 5 mailer)

The mailer at `apps/web/lib/mailer.ts` is provider-agnostic over SMTP.
Any SMTP server works (Gmail/Workspace, Postmark SMTP, SES SMTP,
Mailgun SMTP, etc.) — no provider SDK is hard-wired.

| Var | Required | Notes |
|---|---|---|
| `SMTP_HOST` | yes | Hostname of the SMTP server. |
| `SMTP_PORT` | yes | Integer 1-65535. 465 = implicit TLS. 587 = STARTTLS. |
| `SMTP_USER` | yes | Auth user. |
| `SMTP_PASSWORD` | yes | Auth password / app password. **Never logged**. The legacy `SMTP_APP_PASSWORD` key is honored as a fallback if `SMTP_PASSWORD` is unset. |
| `SMTP_FROM` | yes | `From:` header. RFC-5322 format works (`"B Visible <addr@host>"` or just `addr@host`). |
| `SMTP_SECURE` | no | `"true"` forces TLS-on-connect; `"false"` forces STARTTLS/plain. Blank → inferred from port (465 → true, anything else → false). |
| `SMTP_REPLY_TO` | no | Optional `Reply-To:` header for outbound mail. |

The transport is created lazily on first use and cached for the
process lifetime. A PM2 reload (which `deploy-once.sh` always does)
flushes the cache, so editing `.env` and redeploying is enough to pick
up new credentials.

Sanity-check after editing: sign in as a SUPER_ADMIN, open
**Settings → Email test**, and send a test message. The page runs
SMTP `verify()` first, then sends a branded message. Errors are
sanitized (no credentials displayed).

## Postgres bootstrap (one-off, server-side)

The `POSTGRES_*` and `DATABASE_URL` keys are populated once on the server
by `server-scripts/db/.bootstrap-write-env.sh`, which generates a
32-character password with `openssl rand`, writes the keys to
`/opt/bvisible/shared/env/.env` (mode 640, `deploy:deploy`), and never
echoes the password back. To regenerate (e.g. credential rotation):
remove the four lines from `.env` and re-run the bootstrap script. Then
update Postgres to accept the new password (`ALTER USER bvisible WITH
PASSWORD '...'`) inside the running container.
