# SERVER.md — B Visible production server

Reference for connecting to and operating the production host. **No secrets in this
file** — SSH keys are referenced by path only. Never commit a private key here.

## Host

| | |
|---|---|
| **IP** | `212.56.32.136` |
| **Hostname** | `vmi3270817` |
| **OS** | Ubuntu 24.04.4 LTS (KVM/QEMU VM) |
| **Resources** | 12 vCPU · 47 GB RAM · 484 GB root disk |
| **Login users** | `root` (admin) · `deploy` (runs the app) |

## Connecting

Use **your own** SSH key. Connect with:

```bash
ssh -i <path-to-your-private-key> root@212.56.32.136
```

Example (the key path used from the Cursor/dev machine):

```powershell
ssh -i $env:USERPROFILE\.ssh\cursor_bvisible root@212.56.32.136
```

### Granting a new person/agent access (preferred over sharing a key)

Each user should add **their own** public key so access is individually
revocable. From an account that already has access:

```bash
ssh -i <existing-key> root@212.56.32.136 \
  "echo '<paste-new-PUBLIC-key>' >> ~/.ssh/authorized_keys"
```

Revoke by deleting that person's line from `~/.ssh/authorized_keys`.
Review current keys with: `cat ~/.ssh/authorized_keys`.

> Do **not** paste private keys into this repo, chat logs, or shared files.
> A leaked key here grants root on production. Keep keys on the machines that own them.

## Stack / layout

Public traffic → **Nginx** (:80 / :443) → **Next.js** app (PM2, `127.0.0.1:3000`)
→ **Postgres 16** (Docker, `127.0.0.1:5432`).

| Layer | Detail |
|---|---|
| Web server | Nginx (reverse proxy + TLS) |
| App | Next.js 15 standalone, PM2 process `bvisible-web`, run as `deploy` |
| App path | `/opt/bvisible/app` |
| PM2 config | `ecosystem.config.cjs` → `cwd: /opt/bvisible/app/apps/web/.next/standalone/apps/web` |
| Logs | `/opt/bvisible/shared/logs/pm2/bvisible-web.{out,err}.log` |
| Database | `postgres:16-alpine`, container `bvisible-db`, bound to localhost only |
| Deploy | build → `pm2 startOrReload ecosystem.config.cjs --update-env` (see `server-scripts/`) |

Only ports **22, 80, 443** are exposed publicly; app and DB are localhost-bound
and UFW blocks `:3000` externally.

## Common operations

```bash
# App status / logs (as deploy)
sudo -u deploy pm2 list
sudo -u deploy pm2 logs bvisible-web --lines 100
sudo -u deploy pm2 startOrReload /opt/bvisible/app/ecosystem.config.cjs --update-env

# Nginx
nginx -t && systemctl reload nginx

# Database container
docker ps | grep bvisible-db
docker logs --tail 100 bvisible-db

# Health
systemctl status nginx docker fail2ban
df -h /   # disk
free -h   # memory
```

## Security notes

- **fail2ban** and **unattended-upgrades** are active; **UFW** restricts inbound.
- Uptime has been long (~60+ days) — check for a **pending kernel reboot** after
  security updates: `ls /var/run/reboot-required 2>/dev/null && echo "reboot needed"`.
- Postgres and the Node app are never exposed publicly — keep them localhost-bound.
