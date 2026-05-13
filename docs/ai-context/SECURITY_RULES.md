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
   `ecosystem.config.cjs` — never change it to `0.0.0.0`.
4. **Secrets live in `/opt/bvisible/shared/env/.env`** on the server, mode 640,
   owned by `deploy:deploy`. Never commit `.env` to Git.
5. **Uploads are sanitized.** No execution permission, no path traversal in
   filenames, content-type sniffing on download. Stored under
   `/opt/bvisible/shared/uploads/<tenantId>/...`.
6. **Mobile uploads use presigned URLs** with a short TTL and per-tenant
   prefix.

## Auth posture

- Argon2id for password hashes.
- Session cookies: `HttpOnly; Secure; SameSite=Lax`.
- JWT access tokens ≤ 15 min, refresh tokens rotate on use.
- Failed-login backoff per user + per IP. fail2ban already protects SSH.

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
