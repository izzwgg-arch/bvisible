# DEBUGGING — B Visible

Operational runbook. Quick commands and recovery steps when things break.
**Never log secrets, app passwords, or raw tokens.**

> Convention: shell commands assume you SSH'd in as `deploy` unless stated
> otherwise. Use `sudo -i` only when needed.

## 0. Connect

```bash
ssh -i $env:USERPROFILE\.ssh\cursor_bvisible deploy@212.56.32.136   # PowerShell
ssh -i ~/.ssh/cursor_bvisible deploy@212.56.32.136                  # *nix
```

## 1. Deploy queue — failing or stuck

### Symptom: deploys keep going to `failed/`

```bash
bvisible-status
ls -t /opt/bvisible/deploy-queue/failed/ | head -5
JOB=<jobId-without-.json>
cat /opt/bvisible/deploy-queue/failed/${JOB}.json
tail -n 200 /opt/bvisible/deploy-queue/logs/${JOB}.log
```

Common causes:

- `commitHash` not pushed → push the commit, re-enqueue.
- Working tree dirty in `/opt/bvisible/app` → see § 2.
- `pnpm install` failed → check log for the missing dep, fix in repo, push,
  re-deploy.

### Symptom: stuck lock / a job sits in `running/` forever

```bash
ls /opt/bvisible/deploy-queue/running/
ps -ef | grep -E 'deploy-worker|deploy-once' | grep -v grep
```

If no process holds it but the file is still there, the worker died mid-run.
Move it to `failed/` and inspect the log:

```bash
sudo mv /opt/bvisible/deploy-queue/running/*.json /opt/bvisible/deploy-queue/failed/
```

`flock` releases automatically when the holding process exits, so the next
worker tick will pick up the next job.

### Symptom: timer not firing

```bash
systemctl status bvisible-deploy-worker.timer --no-pager
systemctl list-timers --all | grep bvisible
journalctl -u bvisible-deploy-worker.service --since "1 hour ago" --no-pager
```

## 2. Working-tree dirty in `/opt/bvisible/app`

**Never edit by hand.** If a tracked file got modified somehow:

```bash
cd /opt/bvisible/app
git status
git stash --include-untracked        # preserve evidence
# Then re-enqueue the deploy you wanted; deploy-once.sh will re-checkout cleanly.
```

## 3. systemd / journal

```bash
journalctl -u bvisible-deploy-worker.service --since "1 hour ago" --no-pager
journalctl -u nginx --since "30 min ago" --no-pager
journalctl -u docker --since "30 min ago" --no-pager
journalctl -u fail2ban --since "1 hour ago" --no-pager
```

## 4. Nginx

```bash
sudo nginx -t                                  # config sanity
sudo systemctl reload nginx                    # apply
sudo tail -n 200 /var/log/nginx/error.log
sudo tail -n 200 /var/log/nginx/access.log
sudo tail -n 200 /var/log/nginx/bvisible.error.log
sudo tail -n 200 /var/log/nginx/bvisible.access.log
```

If nginx won't start, `nginx -t` prints the offending file:line.

**Re-applying the repo nginx config without losing HTTPS:**

The on-server `/etc/nginx/sites-available/bvisible` contains certbot-managed
lines (`:443` block, `ssl_certificate`, the 301 redirect). Re-running
`server-scripts/setup-pm2-and-nginx.sh` re-applies the HTTP-only baseline
from the repo and then re-runs certbot, which re-deploys the cert into the
file. If LE is rate-limiting, the bootstrap script falls back to HTTP-only
with a warning rather than leaving the site broken.

## 4a. TLS / certbot

```bash
sudo certbot certificates                                  # list issued certs
sudo systemctl status certbot.timer --no-pager             # auto-renewal
sudo certbot renew --dry-run                               # smoke-test renewal
ls -la /etc/letsencrypt/live/vmi3270817.contaboserver.net/ # cert files
```

If `certbot --nginx` ever fails: check that the A record for the hostname
still resolves to `212.56.32.136` (`dig +short A <host> @1.1.1.1`), then
that nginx is up (`systemctl status nginx`), then re-run with
`--debug-challenges`.

## 4b. PM2 (production runtime)

PM2 daemon spawn is broken under `sudo -u` and `runuser -u` on Ubuntu
24.04 (`spawn /usr/bin/node EACCES`). Always use a login shell:

| You are… | Use this |
|---|---|
| **root** | `su - deploy -c 'pm2 ...'` |
| **deploy** (e.g. inside `deploy-once.sh` running under systemd) | `bash -lc 'pm2 ...'` |
| anywhere | NOT `sudo -u deploy pm2 ...` and NOT `runuser -u deploy pm2 ...` |

Common commands (assumes you SSH'd in as `deploy`):

```bash
bash -lc 'pm2 list'
bash -lc 'pm2 status bvisible-web'
bash -lc 'pm2 logs bvisible-web --lines 100'
bash -lc 'pm2 reload bvisible-web --update-env'
bash -lc 'pm2 restart bvisible-web --update-env'  # if reload misbehaves
bash -lc 'pm2 save'                               # snapshot for resurrect

# Raw log files (survive release swaps; live under shared/):
tail -f /opt/bvisible/shared/logs/pm2/bvisible-web.out.log
tail -f /opt/bvisible/shared/logs/pm2/bvisible-web.err.log

# systemd wrapper (resurrect-on-boot)
sudo systemctl status pm2-deploy.service --no-pager
sudo systemctl restart pm2-deploy.service        # cold-restart all PM2 apps
journalctl -u pm2-deploy.service --since '1 hour ago' --no-pager
```

If a PM2 process is stuck in `errored`:

```bash
bash -lc 'pm2 describe bvisible-web'
bash -lc 'pm2 logs bvisible-web --err --lines 200'
bash -lc 'pm2 delete bvisible-web && pm2 startOrReload /opt/bvisible/app/ecosystem.config.cjs --update-env && pm2 save'
```

If standalone server fails at boot complaining about `@bvisible/db` or
another workspace package: the standalone tracing missed it. Confirm
`outputFileTracingRoot` in `apps/web/next.config.mjs` points at the
workspace root; rebuild on the server with `NEXT_BUILD_STANDALONE=1
pnpm run build`; then `bash -lc 'pm2 reload bvisible-web --update-env'`.

## 4c. /api/health

```bash
curl -fsS http://127.0.0.1:3000/api/health      # direct to Node (deploy box)
curl -fsS https://vmi3270817.contaboserver.net/api/health   # public via Nginx
```

Expected body: `{"status":"ok","service":"bvisible-web"}`.

## 5. Docker

```bash
docker ps                                      # what's running
docker compose -f /opt/bvisible/app/docker-compose.yml ps
docker logs --tail 200 -f <container>
docker compose -f /opt/bvisible/app/docker-compose.yml restart <service>
docker system df                               # disk pressure
docker system prune -f                         # safe cleanup
```

Never `docker system prune --volumes` without confirming the DB volume is
backed up.

## 6. Build failures during deploy

- Look at the deploy log first: `tail -n 200 /opt/bvisible/deploy-queue/logs/<jobId>.log`.
- Reproduce locally with the same commit:
  `git checkout <sha> && pnpm install --frozen-lockfile && pnpm run build`.
- Lockfile drift? `pnpm install` (without `--frozen-lockfile`) locally, commit
  the updated `pnpm-lock.yaml`, push, re-deploy.

## 7. Healthcheck failures

`/opt/bvisible/deploy-queue/healthcheck.sh` is the gate that decides
whether a deploy succeeded. Non-zero exit → `deploy-once.sh` exits 9 →
the job lands in `failed/`. The script's failure output already includes
`pm2 list`, `pm2 jlist`, last 50 lines of stdout/stderr, and `:3000`
listeners — read the deploy log first:

```bash
JOB=$(ls -t /opt/bvisible/deploy-queue/failed/ | head -1 | sed 's/\.json$//')
tail -n 200 /opt/bvisible/deploy-queue/logs/${JOB}.log

# Re-run the healthcheck manually (after fixing the runtime):
/opt/bvisible/deploy-queue/healthcheck.sh

# Try the upstream directly to bypass nginx:
curl -fsS http://127.0.0.1:3000/api/health
# And via the public hostname through nginx:
curl -fsS https://vmi3270817.contaboserver.net/api/health
```

Common causes:

- PM2 process never bound `:3000` → check `bash -lc 'pm2 describe bvisible-web'`
  and the `.err.log` for a crash on boot.
- App is listening on `0.0.0.0` instead of `127.0.0.1` → wrong `HOSTNAME`
  in `ecosystem.config.cjs`.
- Standalone bundle missing a workspace package → see § 4b last paragraph.
- Healthcheck timed out → `/api/health` is returning HTTP 200 but a body
  that doesn't have `{"status":"ok","service":"bvisible-web"}`. Check the
  route handler.

## 8. Disk / memory / CPU

```bash
df -h /
du -h --max-depth=1 /opt/bvisible | sort -h
free -h
top -b -n 1 | head -n 20
iostat -x 1 5         # needs sysstat
```

If `/opt/bvisible/releases/` is bloated, prune the oldest snapshots — keep
the last 5.

## 9. Email ingestion failures

```bash
docker logs --tail 200 -f bvisible-email-ingest-1
# IMAP login test (don't log the password, even on screen):
docker exec -it bvisible-email-ingest-1 \
  python3 -c "import imaplib,os; m=imaplib.IMAP4_SSL('imap.gmail.com',993); \
              m.login(os.environ['IMAP_USER'], os.environ['IMAP_APP_PASSWORD']); \
              print(m.noop())"
```

If login fails:

- App password rotated/revoked → mint a new one in Google Workspace, update
  `.env`, redeploy `email-ingest`.
- 2-Step Verification disabled → re-enable; app passwords require it.
- Account locked → unlock via admin console.

If parsing produces lots of review-queue items:

- Check `IngestedEmail` rows for the offending vendor.
- Update `VendorContact` / `ItemAlias` to teach the matcher.

## 10. Tenant-scope bugs

Symptom: a user sees another tenant's data.

```bash
# Quick sanity in the DB shell (psql via docker):
docker exec -it bvisible-db-1 psql -U bv -d bvisible \
  -c "SELECT \"tenantId\", count(*) FROM \"Estimate\" GROUP BY 1 ORDER BY 2 DESC;"
```

Find the offending query — most likely a missing `tenantId` in a `where`.
Add a regression test (see `TESTING.md` § "tenant isolation").

## 11. Postgres / Prisma / DB issues

The web app runs under PM2 on the host (NOT in compose). Postgres runs
in compose as the `db` service of project `bvisible`, container
`bvisible-db`, port-published `127.0.0.1:5432:5432` only.

### Quick checks

```bash
# Container state and health (run as root or any user in docker group)
docker compose -p bvisible ps
docker compose -p bvisible logs --tail 100 db

# Is anything publicly listening on 5432? (Should be ONLY 127.0.0.1.)
ss -tlnp | grep ':5432'
ss -tln src 0.0.0.0:5432   # MUST be empty

# Smoke the live DB end-to-end:
sudo /opt/bvisible/deploy-queue/db-verify.sh
```

### Talk to the DB

```bash
# psql as the app user, sourcing the password from the live env file:
PW=$(sudo grep '^POSTGRES_PASSWORD=' /opt/bvisible/shared/env/.env | head -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')
docker compose -p bvisible exec -T -e PGPASSWORD="$PW" db psql -U bvisible -d bvisible
```

Useful one-liners:

```sql
\dt                                                -- list tables in public
SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at;
SELECT count(*) FROM tenants;
SELECT count(*) FROM users;
```

### Prisma migrations

```bash
# From the deploy box, as deploy:
( set -a && . /opt/bvisible/shared/env/.env && set +a && \
  cd /opt/bvisible/app && pnpm --filter @bvisible/db exec prisma migrate status )

# Apply pending (this is what deploy-once.sh does):
( set -a && . /opt/bvisible/shared/env/.env && set +a && \
  cd /opt/bvisible/app && pnpm --filter @bvisible/db exec prisma migrate deploy )
```

NEVER run `prisma migrate dev` or `prisma db push` against the
production DB — they can destroy data. Generate migrations against a
local Postgres (or a disposable scratch DB), commit the files, push,
deploy.

Stuck migration:

- `prisma migrate resolve --applied <migration>` if you've manually fixed it.
- `prisma migrate resolve --rolled-back <migration>` to mark a failed migration
  as rolled back (only after you have manually undone the partial SQL).
- Restore from a known-good `pg_dump` in `/opt/bvisible/backups/` if data was
  damaged.

### `.env` quoting gotcha (deploy-once exit 10)

`DATABASE_URL` contains an unquoted `&` (the connection-string query
separator). Bash sourcing of an unquoted `.env` line treats `&` as the
background operator and silently fails to set the variable. The deploy
will then fail at `prisma migrate deploy` with `Environment variable not
found: DATABASE_URL`.

Fix: ensure the line in `/opt/bvisible/shared/env/.env` is double-quoted:

```dotenv
DATABASE_URL="postgresql://bvisible:...@127.0.0.1:5432/bvisible?schema=public&connection_limit=20"
```

The bootstrap script (`server-scripts/db/.bootstrap-write-env.sh`)
writes it quoted. If you ever hand-edit `.env`, keep the quotes.

### Compose / docker-compose.yml drift

The repo has a single `docker-compose.yml` at the root. It pins:

- project `name: bvisible` (top-level), so `docker compose ps` from any
  cwd hits the same containers;
- `services.db.ports: ["127.0.0.1:5432:5432"]` — the `127.0.0.1:` prefix
  is mandatory, never delete it;
- named volume `bvisible_pgdata` with explicit `name:` so the volume
  survives `docker compose down`.

`docker compose down` removes the container but keeps the volume.
`docker compose down -v` ALSO removes the volume — never run it without
a recent `pg_dump`.

## 12. UI / sidebar / drawer / hydration

- Hydration mismatch warnings in browser console → look for `Date.now()` /
  `Math.random()` / `localStorage` access in a Server Component.
- Sidebar collapse not persisting → check the cookie name in
  `apps/web/lib/ui-prefs.ts`.
- Drawer state lost on navigation → confirm the deep-link query param is
  preserved in the link/router push.

## 13. Recovery posture

| Scenario | First move |
|---|---|
| Bad deploy in production | Re-enqueue the previous good `commitHash` |
| Compromised secret | Rotate in Google/QBO, update `.env`, redeploy, audit logs |
| Disk full | Prune `releases/` (keep 5), `docker system prune -f`, then look at uploads |
| DB down | `docker compose ps`, `docker logs db`, restore from latest dump if corrupt |
| Locked out by firewall | Use the hosting console's serial/VNC; `ufw allow OpenSSH` |
