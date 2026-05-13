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

```bash
# ALWAYS use `su - deploy -c '...'` for PM2 commands. `sudo -u deploy`
# and `runuser -u deploy` both fail with `spawn /usr/bin/node EACCES`
# under Ubuntu 24.04.
su - deploy -c 'pm2 list'
su - deploy -c 'pm2 status bvisible-web'
su - deploy -c 'pm2 logs bvisible-web --lines 100'
su - deploy -c 'pm2 reload bvisible-web --update-env'
su - deploy -c 'pm2 restart bvisible-web --update-env'  # if reload misbehaves
su - deploy -c 'pm2 save'                               # snapshot for resurrect

sudo systemctl status pm2-deploy.service --no-pager     # systemd wrapper
sudo systemctl restart pm2-deploy.service               # cold-restart all PM2 apps
journalctl -u pm2-deploy.service --since '1 hour ago' --no-pager
```

If a PM2 process is stuck in `errored`:

```bash
su - deploy -c 'pm2 describe bvisible-web'              # inspect last error
su - deploy -c 'pm2 logs bvisible-web --err --lines 200'
su - deploy -c 'pm2 delete bvisible-web && pm2 startOrReload /opt/bvisible/app/ecosystem.config.cjs --update-env && pm2 save'
```

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

If `apps/web/scripts/healthcheck.sh` (when it exists) returns non-zero, the
deploy is marked failed but the previous release stays live (release symlink
not flipped). To investigate:

```bash
cd /opt/bvisible/app && bash scripts/healthcheck.sh
docker logs --tail 100 bvisible-web-1
curl -fsS http://127.0.0.1:3000/api/v1/health
```

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

## 11. Prisma / DB issues

```bash
docker exec -it bvisible-web-1 pnpm prisma migrate status
docker exec -it bvisible-web-1 pnpm prisma migrate deploy   # apply pending
docker exec -it bvisible-db-1 psql -U bv -d bvisible
```

Stuck migration:

- `prisma migrate resolve --applied <migration>` if you've manually fixed it.
- Restore from a known-good `pg_dump` in `/opt/bvisible/backups/` if data was
  damaged.

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
