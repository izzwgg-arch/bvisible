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

- One placeholder site at `/etc/nginx/sites-available/bvisible.placeholder`
  serving plain text on `:80`.
- Real proxy config will replace it once app upstream ports are known.
- ACME challenge dir: `/var/www/html/.well-known/acme-challenge/`.
- TLS via certbot (not yet issued — needs a real domain).

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

## Manual / outstanding steps

1. Real domain + TLS via `certbot --nginx -d <domain>`.
2. Real nginx proxy config when app ports are known.
3. Tighten `PermitRootLogin no` once `deploy` is fully proven (test deploy
   user first).
4. Add backup automation writing to `/opt/bvisible/backups/`.
5. (Optional) Add a small swapfile for safety.
