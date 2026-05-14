# DEPLOYMENT — B Visible

The real, completed production server setup. If you change any of this on the
server, update this file in the same commit.

## Server

| Item | Value |
|---|---|
| Public IP | **`212.56.32.136`** |
| OS | **Ubuntu 24.04.4 LTS** (Noble Numbat) |
| Kernel | 6.8.0-111-generic |
| CPU | 12 vCPU AMD EPYC |
| RAM | 47 GB |
| Disk | 484 GB free on `/dev/sda1` (mounted at `/`) |

## Users

| User | Purpose | Notes |
|---|---|---|
| `root` | Bootstrap + emergency | SSH key only; `PermitRootLogin yes` for now |
| `deploy` | Runs the worker, owns `/opt/bvisible` | Passwordless sudo via `/etc/sudoers.d/90-deploy`; member of `sudo`, `docker` |

Same SSH key (`cursor_bvisible`) authorizes both. Confirmed working after
firewall enable.

## Filesystem layout

```
/opt/bvisible/
├── app/                      Git working tree (deploy-managed)
├── releases/                 Timestamped release snapshots
│   └── current → <ts-sha12>  Symlink to active release
├── shared/
│   ├── env/                  /opt/bvisible/shared/env/.env  (mode 640, deploy:deploy)
│   ├── uploads/              Symlinked into app/uploads
│   └── logs/
├── backups/                  (deploy:deploy 750)
└── deploy-queue/             See DEPLOY_QUEUE.md
```

Owner: `deploy:deploy`. Modes: 755 except `shared/env/` (750), `backups/`
(750), `.env` (640).

## Installed runtimes

| Component | Version |
|---|---|
| git | 2.43.0 |
| Docker | 29.4.3 |
| Docker Compose plugin | v5.1.3 |
| Node.js | v22.22.2 (LTS) |
| pnpm (corepack) | 11.1.1 |
| nginx | 1.24.0 |
| fail2ban | 1.0.2 |
| ufw | 0.36.2 |
| certbot + python3-certbot-nginx | (latest noble) |

## Network / firewall

UFW **active**, default `deny (incoming)`, `allow (outgoing)`.

Allowed inbound:

```
22/tcp   (OpenSSH)   v4 + v6
80/tcp                v4 + v6
443/tcp               v4 + v6
```

**Only SSH/HTTP/HTTPS are exposed publicly.** Postgres, Redis, and the
workers are bound to the Docker internal network and never reach the host
firewall.

`fail2ban` `[sshd]` jail is active and was already banning brute-force IPs at
install time.

## Git-first deploy

- Source of truth: https://github.com/izzwgg-arch/blob/main (the
  `izzwgg-arch/bvisible` repository).
- Server **pulls from Git only**. Nobody hand-edits production files.
- Deploys require an **exact `commitHash`** — branch tips are rejected
  (`deploy-once.sh` calls `git cat-file -e <sha>^{commit}`).
- A dirty working tree on the server makes the deploy fail (safety belt).

See `DEPLOY_QUEUE.md` for the queue mechanics and the exact
`bvisible-deploy` / `bvisible-status` commands.

## Nginx

- Real reverse-proxy site at `/etc/nginx/sites-available/bvisible`, enabled
  via `/etc/nginx/sites-enabled/bvisible`. Source of truth for the HTTP
  baseline lives in the repo at `server-scripts/nginx/bvisible.conf`. The
  on-server file additionally contains certbot-managed lines (`:443`
  server block, `ssl_certificate` paths, the HTTP→HTTPS 301 redirect).
- Upstream: `127.0.0.1:3000` (Node app, localhost-only — never exposed
  publicly; UFW also blocks `:3000` from the outside).
- gzip on for text-ish responses, security headers in place
  (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`). HSTS intentionally NOT set yet.
- `client_max_body_size 25m`. Matches the Phase 7 PO attachment limit
  (`experimental.serverActions.bodySizeLimit: '25mb'` in
  `apps/web/next.config.mjs`). If you ever raise the app-side limit,
  raise this nginx limit in the same commit or uploads will be cut off
  upstream of Node with no useful error in PM2 logs.
- WebSocket upgrade headers wired through.
- ACME challenge dir: `/var/www/html/.well-known/acme-challenge/` (kept
  reachable on `:80` so renewals succeed).
- The old placeholder file is preserved at
  `/etc/nginx/sites-available/bvisible.placeholder` for emergency
  rollback; it is disabled (no symlink in `sites-enabled/`).

## TLS / certbot

- Cert issued for `vmi3270817.contaboserver.net` (Contabo's PTR record for
  this VPS) on 2026-05-13, valid until 2026-08-11.
- Cert files at `/etc/letsencrypt/live/vmi3270817.contaboserver.net/`.
- `certbot.timer` (system-wide) runs auto-renewal twice daily.
- HTTP→HTTPS 301 redirect active.
- When a real `bvisible.*` domain exists: point its A record at
  `212.56.32.136`, then run
  `certbot --nginx -d <new-domain> --redirect --agree-tos --register-unsafely-without-email --no-eff-email`.
  The Contabo-hostname cert keeps working until then.

## Runtime — PM2

- PM2 v7.0.1 installed globally (`/usr/bin/pm2 → /usr/lib/node_modules/pm2/bin/pm2`).
- PM2 systemd unit at `/etc/systemd/system/pm2-deploy.service` runs as
  `deploy`, `Type=forking`, `ExecStart=… pm2 resurrect`. Enabled — survives
  reboot.
- App spec lives in `ecosystem.config.cjs` at the repo root. Process name
  `bvisible-web`, fork mode, single instance, `cwd` is the standalone tree
  at `/opt/bvisible/app/apps/web/.next/standalone/apps/web`,
  `script: server.js`, env `NODE_ENV=production PORT=3000 HOSTNAME=127.0.0.1`,
  `max_memory_restart: 512M`, `kill_timeout: 10000`, separate stdout/stderr
  log files under `/opt/bvisible/shared/logs/pm2/`.
- IMPORTANT: invocation rules for PM2 (Ubuntu 24.04 has a daemon-spawn
  EACCES under sudo / runuser without a login shell):
  - From **root**: `su - deploy -c 'pm2 ...'` (login shell).
  - From **deploy** (e.g. inside `deploy-once.sh`, which runs as `deploy`
    under systemd): `bash -lc 'pm2 ...'`. Do NOT use `su - deploy -c` from
    deploy itself — that prompts for a password.
  - Never `sudo -u deploy pm2 ...` or `runuser -u deploy pm2 ...`.

## Build pipeline (now in deploy-once.sh)

1. Fetch origin; verify the requested `commitHash` exists.
2. Reject a dirty tracked working tree.
3. Detached checkout of the exact commit.
4. Snapshot release into `releases/<ts>-<sha12>/` and flip
   `releases/current` symlink.
5. Symlink `shared/env/.env` and `shared/uploads` into the working tree.
6. `pnpm install --frozen-lockfile`.
7. `NEXT_BUILD_STANDALONE=1 pnpm run build` (root build runs `prisma generate`
   then `next build`; the env var triggers Next standalone output gated in
   `apps/web/next.config.mjs`).
8. **Database phase** (skipped if `docker-compose.yml` or
   `packages/db/prisma/schema.prisma` is missing in the working tree):
   - `docker compose up -d db` from `$APP_DIR` (project name `bvisible`,
     idempotent — no-op if already running).
   - Wait for `pg_isready` (up to 60 s).
   - Source `/opt/bvisible/shared/env/.env` in a subshell (so prisma sees
     `DATABASE_URL`), then
     `pnpm --filter @bvisible/db exec prisma migrate deploy`. Migration
     failure → `exit 10`.
   - Run `/opt/bvisible/deploy-queue/db-verify.sh`. Failure → `exit 11`.
9. **Wire standalone runtime:**
   - copy `apps/web/.next/static` next to the standalone server,
   - copy `apps/web/public` if present,
   - symlink `apps/web/.next/standalone/apps/web/.env` →
     `/opt/bvisible/shared/env/.env`,
   - ensure `/opt/bvisible/shared/logs/pm2/` exists owned by `deploy`.
10. `bash -lc 'pm2 startOrReload /opt/bvisible/app/ecosystem.config.cjs --update-env'`.
11. `bash -lc 'pm2 save --force'`.
12. `sleep 2`.
13. `/opt/bvisible/deploy-queue/healthcheck.sh` — if non-zero, deploy
    fails (exit 9). If the healthcheck script is missing or non-executable,
    the deploy ALSO fails (we refuse to mark a deploy successful without
    runtime verification).

## Secrets / `.env`

- Single file: `/opt/bvisible/shared/env/.env` (mode 640, `deploy:deploy`).
- Symlinked into `app/.env` by `deploy-once.sh`.
- Never commit `.env`. Never log its contents.
- See `ENVIRONMENT_VARIABLES.md` for required keys. Phase 5 added
  `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`
  (and optional `SMTP_SECURE`, `SMTP_REPLY_TO`) which the mailer reads
  at runtime via `apps/web/lib/mailer.ts`. The keys may be edited
  on the server in place; the next PM2 reload (which `deploy-once.sh`
  always does) flushes the cached transport and picks up new values.
- Phase 7 (purchase orders) added no new env keys, but it does write
  attachments to `UPLOAD_ROOT` (defaults to `/opt/bvisible/shared/uploads`).
  The directory is owned by `deploy:deploy` and **must be preserved
  across deploys** — `deploy-once.sh` already symlinks
  `/opt/bvisible/shared/uploads` into the working tree (step 5 of the
  build pipeline), so attachments uploaded against one release are
  visible to every subsequent release. Per-PO files live at
  `/opt/bvisible/shared/uploads/<tenantId>/po/<purchaseOrderId>/<storageKey>`
  with directory mode `0750` and file mode `0640`.

## systemd

- `bvisible-deploy-worker.timer` — fires every 30s.
- `bvisible-deploy-worker.service` — `oneshot`, runs as `deploy:deploy`,
  invokes `/opt/bvisible/deploy-queue/deploy-worker.sh`.
- `bvisible-ingest-tick.timer` — fires every 60s. Provisioned and
  upgraded automatically by `deploy-once.sh` from
  `server-scripts/cron/`. Never run more than one tick at a time —
  the route handler claims a per-tenant lease via
  `TenantEmailInbox.lastPolledAt` so two overlapping ticks become a
  no-op, and PM2 restarts mid-tick are safe (idempotency anchor is
  `IngestedEmail (tenantId, messageId)` UNIQUE; the next tick re-fetches
  and the unique constraint short-circuits the second write).
- `bvisible-ingest-tick.service` — `oneshot`, runs as `deploy:deploy`,
  invokes `/opt/bvisible/cron/bvisible-ingest-tick.sh` which curls the
  loopback `bvisible-web` upstream at
  `http://127.0.0.1:3000/api/internal/email-ingest/tick` with the
  `x-bvisible-ingest-secret` header. The script + service + timer are
  installed under `/opt/bvisible/cron/` and `/etc/systemd/system/` by
  the deploy pipeline (sudo install). Polling survives PM2 restarts
  and reboots.

## Quick health checks

```bash
ssh deploy@212.56.32.136
systemctl status bvisible-deploy-worker.timer --no-pager
systemctl status bvisible-ingest-tick.timer --no-pager
journalctl -u bvisible-ingest-tick.service --since '15 min ago' --no-pager
ufw status verbose
ss -tulpn | grep LISTEN
docker ps
df -h /
free -h
```

## Repo runtime stack (now in tree)

| Component | Where | Notes |
|---|---|---|
| pnpm workspace | repo root | `packageManager: pnpm@11.1.1` (matches server) |
| Web app | `apps/web` | Next.js 15, React 19, Tailwind 4, App Router, TS strict |
| DB package | `packages/db` | Prisma 6 (postgresql), schema at `packages/db/prisma/schema.prisma`, first migration `20260513180326_init` |
| Health endpoint | `apps/web/app/api/health/route.ts` | `GET /api/health → {"status":"ok","service":"bvisible-web"}` |
| PM2 ecosystem | `ecosystem.config.cjs` (repo root) | One app `bvisible-web`, fork mode, env `PORT=3000 HOSTNAME=127.0.0.1`. |
| Healthcheck   | `server-scripts/deploy-queue/healthcheck.sh` | Curl-with-retry against `/api/health`. Required by `deploy-once.sh`. |
| Nginx baseline | `server-scripts/nginx/bvisible.conf` | HTTP-only baseline; certbot mutates the on-server copy in place to add `:443`. |
| Compose | `docker-compose.yml` (repo root) | Project name `bvisible`. Service `db` = `postgres:16-alpine`, port published `127.0.0.1:5432:5432` ONLY, named volume `bvisible_pgdata`, init scripts mounted from `server-scripts/db/init/`. The web app does NOT run in compose. |
| DB verify | `server-scripts/db/db-verify.sh` | Confirms postgres reachable, `_prisma_migrations` table present, and `tenants`/`users` tables exist. Run by `deploy-once.sh` after `prisma migrate deploy`. |

## Database (Postgres in Docker Compose)

- Single service in `docker-compose.yml`: `db` = `postgres:16-alpine`,
  container `bvisible-db`, project `bvisible`, named volume `bvisible_pgdata`.
- Port binding is hard-coded to `127.0.0.1:5432:5432`. Docker would
  otherwise default to `0.0.0.0:5432` and bypass UFW — never write
  `"5432:5432"` here. Verified via `ss -tlnp | grep 5432` (only
  `127.0.0.1:5432` LISTEN; `ss -tln src 0.0.0.0:5432` empty).
- Persistent data lives in the named docker volume
  `bvisible_pgdata` (`/var/lib/docker/volumes/bvisible_pgdata/_data`).
- Init scripts in `server-scripts/db/init/` are mounted read-only into
  `/docker-entrypoint-initdb.d/` and run only on a fresh data volume.
  Today: `01-extensions.sql` enables `pgcrypto`.
- Compose reads env from `/opt/bvisible/app/.env` (the deploy-managed
  symlink → `/opt/bvisible/shared/env/.env`). Required keys:
  `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`. The matching
  `DATABASE_URL` is consumed by Prisma at app/runtime time.
- The PM2 web app runs on the host and connects via
  `127.0.0.1:5432`, NOT via a docker network DNS name. This is
  deliberate: keeping PM2 outside Docker keeps reload/restart fast and
  avoids dragging the compose lifecycle into runtime.
- Migrations are applied by `prisma migrate deploy`, invoked from
  `deploy-once.sh` BEFORE PM2 reload. A failed migration fails the
  deploy (`exit 10`); the previous-good PM2 process keeps serving.
  `db-verify.sh` then runs and fails the deploy at `exit 11` if the
  expected tables aren't present.

## First-time SUPER_ADMIN bootstrap

After the auth-and-tenant-foundation deploy lands, the DB has the
auth tables but no users. The first SUPER_ADMIN is created by the
CLI at `apps/web/scripts/bootstrap-super-admin.ts`. Run **once**, on
the deploy server, as `deploy`:

```bash
cd /opt/bvisible/app
( set -a; . /opt/bvisible/shared/env/.env; set +a; \
  BOOTSTRAP_ADMIN_EMAIL='you@example.com' \
  BOOTSTRAP_ADMIN_PASSWORD='strong-passphrase-here' \
  BOOTSTRAP_ADMIN_NAME='Your Name' \
  pnpm --filter @bvisible/web run bootstrap:super-admin )
```

The script refuses to run if any SUPER_ADMIN already exists (exit 3).
The password is Argon2id-hashed; plaintext is never logged. After
sign-in, the SUPER_ADMIN creates a Tenant under **Tenants** in the
sidebar and invites tenant admins under **Users**. See
`apps/web/scripts/README.md` and `AUTH_AND_PERMISSIONS.md`.

## Manual / outstanding steps

1. Real `bvisible.*` domain + cert. Once the A record points at
   `212.56.32.136`, run
   `certbot --nginx -d <new-domain> --redirect`. The current Contabo-hostname
   cert keeps working until then.
2. Tighten `PermitRootLogin no` once `deploy` is fully proven (test deploy
   user first).
3. Add backup automation writing to `/opt/bvisible/backups/`. For Postgres
   specifically, a daily `pg_dump bvisible | gzip > backups/db-<ts>.sql.gz`
   from inside `bvisible-db` is the obvious next step.
4. (Optional) Add a small swapfile for safety.
5. Add HSTS header (`Strict-Transport-Security`) to the Nginx config once
   the runtime has been stable on HTTPS for at least a week.
6. (Later) Add Redis + any worker services to `docker-compose.yml`. The
   web app itself stays under PM2, NOT Docker.
