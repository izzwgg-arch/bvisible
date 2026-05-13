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
- `client_max_body_size 25m`. Bump per-feature.
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
8. **Wire standalone runtime:**
   - sanity-check `@bvisible/db` is in `.next/standalone/node_modules`,
   - copy `apps/web/.next/static` next to the standalone server,
   - copy `apps/web/public` if present,
   - symlink `apps/web/.next/standalone/apps/web/.env` →
     `/opt/bvisible/shared/env/.env`,
   - ensure `/opt/bvisible/shared/logs/pm2/` exists owned by `deploy`.
9. `bash -lc 'pm2 startOrReload /opt/bvisible/app/ecosystem.config.cjs --update-env'`.
10. `bash -lc 'pm2 save --force'`.
11. `sleep 2`.
12. `/opt/bvisible/deploy-queue/healthcheck.sh` — if non-zero, deploy
    fails (exit 9). If the healthcheck script is missing or non-executable,
    the deploy ALSO fails (we refuse to mark a deploy successful without
    runtime verification).

## Secrets / `.env`

- Single file: `/opt/bvisible/shared/env/.env` (mode 640, `deploy:deploy`).
- Symlinked into `app/.env` by `deploy-once.sh`.
- Never commit `.env`. Never log its contents.
- See `ENVIRONMENT_VARIABLES.md` for required keys.

## systemd

- `bvisible-deploy-worker.timer` — fires every 30s.
- `bvisible-deploy-worker.service` — `oneshot`, runs as `deploy:deploy`,
  invokes `/opt/bvisible/deploy-queue/deploy-worker.sh`.

## Quick health checks

```bash
ssh deploy@212.56.32.136
systemctl status bvisible-deploy-worker.timer --no-pager
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
| DB package | `packages/db` | Prisma 6 (postgresql), schema at `packages/db/prisma/schema.prisma` |
| Health endpoint | `apps/web/app/api/health/route.ts` | `GET /api/health → {"status":"ok","service":"bvisible-web"}` |
| PM2 ecosystem | `ecosystem.config.cjs` (repo root) | One app `bvisible-web`, fork mode, env `PORT=3000 HOSTNAME=127.0.0.1`. |
| Healthcheck   | `server-scripts/deploy-queue/healthcheck.sh` | Curl-with-retry against `/api/health`. Required by `deploy-once.sh`. |
| Nginx baseline | `server-scripts/nginx/bvisible.conf` | HTTP-only baseline; certbot mutates the on-server copy in place to add `:443`. |

## Manual / outstanding steps

1. Real `bvisible.*` domain + cert. Once the A record points at
   `212.56.32.136`, run
   `certbot --nginx -d <new-domain> --redirect`. The current Contabo-hostname
   cert keeps working until then.
3. Tighten `PermitRootLogin no` once `deploy` is fully proven (test deploy
   user first).
4. Add backup automation writing to `/opt/bvisible/backups/`.
5. (Optional) Add a small swapfile for safety.
6. Provide `DATABASE_URL` (and the rest of `ENVIRONMENT_VARIABLES.md`) at
   `/opt/bvisible/shared/env/.env`. `prisma generate` does not need it, so
   the foundation deploy passes without one — but feature deploys that read
   from the DB will fail until the `.env` is filled.
7. Add HSTS header (`Strict-Transport-Security`) to the Nginx config once
   the runtime has been stable on HTTPS for at least a week.
8. (Later) Add `docker-compose.yml` (db + redis) and any worker services.
   The web app itself runs under PM2, NOT Docker.
