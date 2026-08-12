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

# Office reminder for retail (Amazon / Home Depot / …) purchase orders.
# Read server-side ONLY — it reaches the browser as a prefilled form value,
# never as configuration, and the server re-resolves it on every send.
# Optional: apps/web/lib/po/office-reminder.ts falls back to
# sales@bvisible.us when this is unset or malformed, so a missing value can
# never send an order reminder nowhere. An employee may override the address
# for one order; that override never changes this default.
AMAZON_OFFICE_REMINDER_EMAIL=sales@bvisible.us

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

# Vendor email ingestion — IMAP poller (Phase 8 + 9). The runtime
# prefers a per-tenant TenantEmailInbox row (with the password sealed
# via INGEST_SECRET); SUPER_ADMIN configures these via the in-app form
# at /admin/tenants/[id]/email-inbox (Phase 9). The env keys below are
# the *single-tenant fallback* used by apps/web/lib/email-ingest/
# config.ts when no DB row exists for the first tenant. Useful for
# the very first bootstrap before any inbox row has been written.
#
# Provider-agnostic IMAP (Gmail/Workspace, Fastmail, Office 365, etc.).
# We do NOT use the Gmail API or webhooks — pure UNSEEN polling.
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=ingest@yourdomain.com
IMAP_PASSWORD=                        # IMAP auth password / Google App Password (never logged)
IMAP_TLS=true                         # "true" = TLS-on-connect (993). "false" = plain/STARTTLS.
IMAP_MAILBOX=INBOX                    # optional; defaults to INBOX
IMAP_POLL_INTERVAL_SECONDS=60         # advisory; the systemd timer fires every 60s. Clamp 30..3600.

# AES-256-GCM key used by apps/web/lib/email-ingest/crypto.ts to seal
# IMAP passwords stored in TenantEmailInbox.passwordCipher. SHA-256 is
# applied internally so the input may be any reasonably-strong string
# (>= 32 chars recommended). REQUIRED before any per-tenant inbox row
# can be read or written.
INGEST_SECRET=

# Shared secret presented in the `x-bvisible-ingest-secret` header by
# /opt/bvisible/cron/bvisible-ingest-tick.sh when it pokes the
# /api/internal/email-ingest/tick route. Constant-time compared on the
# server. The route returns 503 if this is not set so a misconfigured
# server never silently 200s with no auth.
INGEST_TICK_SECRET=

# Shared secret for POST /api/internal/ocr/tick (header x-bvisible-ocr-secret).
# Optional when INGEST_TICK_SECRET is set — the OCR route falls back to it.
# Constant-time compared; 503 if neither secret is configured.
OCR_TICK_SECRET=

# Shared secret for POST /api/internal/po-draft-reminder/tick (header
# x-bvisible-po-reminder-secret) — the 07:00 America/New_York systemd timer
# that emails admins about POs still in DRAFT. Optional when
# INGEST_TICK_SECRET is set — the route falls back to it.
PO_REMINDER_TICK_SECRET=

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

# Storage — root for all per-tenant attachments. PO attachments live under
# <UPLOAD_ROOT>/<tenantId>/po/<purchaseOrderId>/<storageKey>. Mode 0750 on
# the directory, 0640 on files, owned by deploy:deploy. Nothing in this tree
# is web-served directly — every download goes through the tenant-gated
# Next.js route handler. Default if unset is /opt/bvisible/shared/uploads.
UPLOAD_ROOT=/opt/bvisible/shared/uploads

# QuickBooks (optional; required to finalize estimates)
QBO_CLIENT_ID=
QBO_CLIENT_SECRET=
QBO_REDIRECT_URI=

# Mobile push (optional — future)
EXPO_ACCESS_TOKEN=

# Mobile REST (`/api/v1/*`): HS256 key for access JWTs. Required before mobile
# login returns 200; login/refresh return 503 if unset. Min 32 chars; use a
# dedicated secret — do not reuse session or ingest material.
MOBILE_JWT_SECRET=

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

## Vendor email ingestion (Phase 8)

The IMAP poller has two layers of configuration:

1. **Per-tenant DB row (`TenantEmailInbox`)** — the production layout.
   Holds `host`, `port`, `secure`, `mailbox`, `username`,
   `passwordCipher` (sealed with `INGEST_SECRET`), `pollIntervalSeconds`,
   `enabled`, plus poll bookkeeping (`lastPolledAt`, `lastErrorAt`,
   `lastErrorMessage`). Multiple tenants → multiple inbox rows.
2. **Env-var fallback** — the bootstrap layout. When no `TenantEmailInbox`
   row exists for a tenant, the loader falls back to `IMAP_HOST` /
   `IMAP_USER` / `IMAP_PASSWORD` / `IMAP_PORT` / `IMAP_TLS` /
   `IMAP_MAILBOX` / `IMAP_POLL_INTERVAL_SECONDS` for the *first*
   tenant only. With the in-app inbox form available
   (`/admin/tenants/[id]/email-inbox`, SUPER_ADMIN), this path is
   only needed for the very first bootstrap. As soon as a
   `TenantEmailInbox` row exists for that tenant, the env values are
   ignored for it (the row wins).

Required for either layout:

| Var | Required | Notes |
|---|---|---|
| `INGEST_SECRET` | yes | AES-256-GCM input key. SHA-256-derived to 32 bytes inside `apps/web/lib/email-ingest/crypto.ts`. Without it, no per-tenant inbox row can be decrypted; the env-var fallback path still works. |
| `INGEST_TICK_SECRET` | yes | Shared secret presented by `bvisible-ingest-tick.sh` to `/api/internal/email-ingest/tick`. The route refuses the request with `503` if this is unset (no silent 200). Also used as fallback auth for `/api/internal/ocr/tick` when `OCR_TICK_SECRET` is unset. |
| `OCR_TICK_SECRET` | no | Dedicated secret for `/api/internal/ocr/tick` (`x-bvisible-ocr-secret`). When unset, the OCR tick route uses `INGEST_TICK_SECRET`. Set this only when you want OCR ticks rotated independently of email ingest. |
| `IMAP_HOST` | fallback only | Hostname of the IMAP server. |
| `IMAP_PORT` | fallback only | Default 993. |
| `IMAP_USER` | fallback only | Auth user. |
| `IMAP_PASSWORD` | fallback only | Auth password / app password. **Never logged**. |
| `IMAP_TLS` | fallback only | `"true"` = TLS-on-connect; default true. |
| `IMAP_MAILBOX` | fallback only | Default `INBOX`. |
| `IMAP_POLL_INTERVAL_SECONDS` | fallback only | Advisory lease window (clamped 30..3600). |

Logging discipline: only `messageId`, `senderDomain`, `attachmentCount`,
`matchResult`, and `durationMs` may be logged. Never the password,
never the full attachment bytes, never the raw IMAP frames (the
imapflow logger is hard-disabled in `client.ts`).

## Postgres bootstrap (one-off, server-side)

The `POSTGRES_*` and `DATABASE_URL` keys are populated once on the server
by `server-scripts/db/.bootstrap-write-env.sh`, which generates a
32-character password with `openssl rand`, writes the keys to
`/opt/bvisible/shared/env/.env` (mode 640, `deploy:deploy`), and never
echoes the password back. To regenerate (e.g. credential rotation):
remove the four lines from `.env` and re-run the bootstrap script. Then
update Postgres to accept the new password (`ALTER USER bvisible WITH
PASSWORD '...'`) inside the running container.
