# SECURITY_RULES — B Visible

## The non-negotiables

1. **Tenant isolation.** Every query against a tenant-scoped table includes
   `tenantId`. Reviewer must reject PRs that violate this.
2. **Never log secrets.** This includes:
   - Passwords (plain or hashed)
   - Google Workspace app passwords / OAuth tokens / refresh tokens
   - Vendor API keys
   - JWTs and session cookies
   - The full body of an inbound email (it may contain credentials)
   - `.env` contents
3. **Public surface is HTTP/HTTPS only.** Postgres, Redis, the workers, the
   IMAP poller, and the Node web app (`127.0.0.1:3000`) are not reachable
   from the internet. UFW only allows ports 22, 80, 443. All public traffic
   to the web app is terminated by Nginx and proxied to the localhost-only
   upstream. The `bvisible-web` PM2 process binds `HOSTNAME=127.0.0.1` per
   `ecosystem.config.cjs` — never change it to `0.0.0.0`. Postgres is
   published by docker compose as `127.0.0.1:5432:5432` ONLY — never
   `5432:5432` (which would silently bind `0.0.0.0` and bypass UFW because
   docker-proxy edits iptables directly). Verified by `ss -tln src
   0.0.0.0:5432` returning empty.
4. **Secrets live in `/opt/bvisible/shared/env/.env`** on the server, mode 640,
   owned by `deploy:deploy`. Never commit `.env` to Git.
5. **Uploads are sanitized.** No execution permission, no path traversal in
   filenames, content-type sniffing on download. Stored under
   `/opt/bvisible/shared/uploads/<tenantId>/...`. Implementation for the
   PO foundation (`apps/web/lib/po/uploads.ts`) is the canonical pattern
   for every future upload surface (see "Attachment posture" below).
6. **Mobile uploads use presigned URLs** with a short TTL and per-tenant
   prefix.

## Auth posture

- **Argon2id** for password hashes via `@node-rs/argon2` (memoryCost
  64 MiB, timeCost 3, parallelism 1). Length-only validation (12-128
  chars) — no composition theatre. Implemented at
  `apps/web/lib/auth/password.ts`.
- **DB-backed sessions.** Opaque 256-bit random token in cookie
  `bv_session` (`HttpOnly; Secure (prod); SameSite=Lax; Path=/;
  Max-Age=30d`). The DB stores SHA-256(token); a DB leak does not leak
  live tokens. Logout sets `Session.revokedAt` and clears the cookie.
  Implementation: `apps/web/lib/auth/session.ts`.
- **Session token never leaves the cookie jar.** Never logged, never in
  URL params, never in `localStorage`.
- **Invite + reset tokens** (256-bit random, base64url) are stored as
  SHA-256 hashes too. Reset TTL 30 min, invite TTL 7 days, both
  one-shot.
- **Email + password timing protection.** Login flow always runs
  argon2 (verify against the stored hash, OR a fresh `hashPassword()`
  of the input when the user is missing/has no hash) so response time
  doesn't leak whether an email is registered. See
  `apps/web/app/(auth)/login/actions.ts`.
- **CSRF** is handled by Next 15's same-origin POST check on server
  actions. All auth/admin mutations are server actions, not REST.
- **Failed-login throttling**: 5 `login_failure` audit rows for the
  same email within 15 min locks the email with a generic "too many
  attempts". Distributed (per-IP, cross-process) throttling needs
  Redis and lands later. fail2ban still protects SSH.
- **Audit log.** Every auth event writes an `AuditLog` row via
  `apps/web/lib/auth/audit.ts`. The metadata column NEVER holds
  plaintext passwords, password hashes, or raw token values.
- **JWT access tokens** for the mobile app (≤ 15 min, rotating refresh)
  land later — not in this phase.

## Mailer posture

- **Provider-agnostic SMTP** via Nodemailer in `apps/web/lib/mailer.ts`.
  No provider SDK is hard-wired; swapping to Postmark/Resend/SES later
  means rewriting only that one file.
- **`SMTP_PASSWORD` (or legacy `SMTP_APP_PASSWORD`) is NEVER logged**
  and NEVER displayed in the UI. The SUPER_ADMIN `/settings/email-test`
  page renders host/port/secure/maskedUser/from/replyTo only.
  `maskUser('alice@host.com') === 'a***e@host.com'`.
- **Allowed log fields** on every mailer line: `mailer: true`, `host`,
  `port`, `secure`, `maskedUser`, `from`, plus per-event fields
  (`messageId`, `acceptedCount`/`rejectedCount` on success;
  `kind`, `code`, `responseCode`, `message` on failure where `message`
  is run through a `sanitize()` regex that scrubs `pass(word)?[=:]\S+`
  and `\bauth\s+\S+`).
- **Forbidden log fields**: the password, the full nodemailer transporter
  object, raw invite/reset URLs (they grant account control), the
  recipient's plaintext password (impossible — the mailer only sends
  branded text), or any token hash.
- **Error sanitization for the UI**: every error message that reaches
  the browser comes from a typed `MailerSendError` with `kind ∈
  {connect, auth, timeout, recipient, sender, unknown}` or
  `MailerConfigError`. The action layer maps these to short,
  user-readable strings; raw `err.message` is never rendered.
- **CSRF** for the test-email action is the same as every other auth
  action: Next 15 server-action same-origin POST + `requireSuperAdmin()`
  inside the action body.
- **Bounded latency**: nodemailer transport is configured with
  `connectionTimeout`/`greetingTimeout`/`socketTimeout` of 10 s each.
  Worst case a server-action handler waits 10 s on a dead SMTP server,
  not indefinitely.
- **Audit trail**: invite + password-reset audit rows include
  `metadata.mailDelivery` (`sent` | `failed_<kind>` | `failed_no_config`
  | `skipped_no_user`) so an operator can correlate UI reports with
  the actual delivery outcome without grepping process logs.

## Attachment posture (PO foundation — pattern for all future uploads)

- **Storage root** is `/opt/bvisible/shared/uploads`, owned by
  `deploy:deploy`, mode `0750`. Per-PO files live under
  `<root>/<tenantId>/po/<purchaseOrderId>/<storageKey>`. The mkdir is
  recursive with mode `0750`; the file write is `0640`. Nothing in this
  tree is web-served directly — Nginx has no alias / static handler for
  it. All access goes through the Next.js route handler.
- **`storageKey` is server-generated** as
  `<timestamp>-<24-char-hex>.<extension>` via `crypto.randomBytes`. The
  client's filename is never used as the on-disk filename. The original
  filename is sanitized (allowlist `[A-Za-z0-9._-]`, max 200 chars,
  reduced to `file` if empty after sanitization) and stored only as
  display metadata.
- **Path traversal protection.** `resolveAttachmentPath()` resolves the
  absolute path with `path.resolve()` and refuses any result that does
  not start with the per-PO directory's resolved prefix + path separator.
  Stored `storageKey` values are also rejected if they contain `..`,
  forward or backward slashes, or NUL bytes.
- **Server-side MIME validation on upload.** The action reads the file
  bytes, runs `detectMimeFromBytes()` against an allowlist of magic-byte
  signatures (`%PDF-` → `application/pdf`, `\xFF\xD8\xFF` → JPEG,
  `\x89PNG\r\n\x1a\n` → PNG, `RIFF....WEBP` → WEBP), and refuses any
  blob whose magic doesn't match. Client `File.type` is **never trusted**
  — it is only used to pick the `accept` filter on the input.
- **Server-side MIME validation on download.** Even though the upload
  path enforced the allowlist, the route handler re-reads the head of
  the file on every download and re-runs `detectMimeFromBytes()` before
  setting `Content-Type`. If the on-disk bytes no longer match the
  allowlist (corruption, manual replacement) the download 404s rather
  than serving an unknown MIME.
- **`Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`** 
  on every download. The original filename is RFC 5987-encoded so
  non-ASCII characters never break the header; the on-disk filename is
  the random `storageKey`, never the user-visible name.
- **Size limit** is 25 MB per file, enforced both at the Next.js layer
  (`experimental.serverActions.bodySizeLimit: '25mb'` in
  `next.config.mjs`) and inside `uploadPoAttachmentAction` (defense in
  depth). Going higher requires updating both knobs *and* re-evaluating
  PM2 / Nginx limits.
- **Tenant gating.** The download route loads the attachment by
  `(tenantId, id, purchaseOrderId)` after `requireTenantId()`. Mismatches
  (cross-tenant id, soft-deleted PO, missing on-disk file) return 404
  without distinguishing the failure mode in the response body.
- **Audit + timeline.** Uploads write `po_attachment_added` to AuditLog
  AND insert a `POEvent` of kind `ATTACHMENT_ADDED`. Deletes write
  `po_attachment_deleted` + `ATTACHMENT_DELETED`. The on-disk `unlink`
  on delete is best-effort and failure is logged but not surfaced to
  the user (the row is gone, the orphan is harmless and reaped by
  future maintenance).

## Server posture (already in place)

- Root SSH allowed for now via key only — see `DEPLOYMENT.md` "remaining
  manual steps". Plan to disable once `deploy` is fully proven.
- `deploy` user has passwordless sudo; SSH key copied from root.
- `fail2ban` `[sshd]` jail enabled.
- UFW `active` with rules: `OpenSSH`, `22/tcp`, `80/tcp`, `443/tcp`.
- Public TLS via Let's Encrypt for `vmi3270817.contaboserver.net`. Auto-renews
  via the system `certbot.timer`.
- HTTP→HTTPS 301 redirect active at the Nginx layer.
- HSTS (`Strict-Transport-Security`) intentionally NOT set yet — enable
  after the runtime has been stable on HTTPS for at least a week (HSTS is
  a one-way commitment that breaks the site if HTTPS later regresses).
- Web app upstream is `127.0.0.1:3000` only; never bind Node to `0.0.0.0`.
- Postgres lives in docker compose (`bvisible-db`), data on the
  `bvisible_pgdata` named volume, port-published `127.0.0.1:5432:5432`
  only. Credentials are random 32-char password (`openssl rand -base64
  24 | tr -d '=+/' | cut -c1-32`), generated by
  `server-scripts/db/.bootstrap-write-env.sh` and never echoed to logs.
  No firewall rule for 5432 — there's nothing to allow because nothing
  external can reach it.

## Data classification

| Class | Examples | Storage rule |
|---|---|---|
| Public | Marketing copy | Anywhere |
| Internal | Estimates, POs | DB, tenant-scoped |
| Confidential | Vendor pricing, client lists | DB + uploads, tenant-scoped, never logged |
| Secret | Passwords, tokens, app passwords | `.env` on server, never logged, never in Git |

## Incident response (short)

- Suspected leak of credentials → rotate immediately, then audit logs.
- Suspected unauthorized access → revoke sessions for the tenant, force
  password reset, review `IngestedEmail` and `POEvent` timelines.
- See `DEBUGGING.md` for the operational commands.
