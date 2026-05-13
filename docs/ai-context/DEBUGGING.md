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

### Prisma engine missing from standalone bundle

Symptom (in `pm2 logs bvisible-web --err`):

```
Error [PrismaClientInitializationError]: Prisma Client could not locate
the Query Engine for runtime "debian-openssl-3.0.x".
This is likely caused by a bundler that has not copied
"libquery_engine-debian-openssl-3.0.x.so.node" next to the resulting
bundle.
```

The boot itself succeeds (healthcheck `{"status":"ok"}` passes because
the route doesn't touch Prisma) but every Prisma call in any handler
crashes with the unhandled rejection above. Browsers see HTTP 500 on
the failing route only.

Root cause: Next's static tracer doesn't follow the `dlopen()` Prisma
uses to load its native engine, so `.next/standalone/.../node_modules/
.pnpm/@prisma+client@*/node_modules/.prisma/client/` is empty in the
deployed bundle.

Fix is automated in `deploy-once.sh` (block labelled "Prisma's
query-engine .so.node binary is dlopen()'d at runtime"). It mirrors the
live workspace's `.prisma/client` directory into the matching `.pnpm`
hash path inside the standalone tree. Look for this line in the deploy
log:

```
[YYYY-MM-DDTHH:MM:SSZ] Prisma client mirrored into standalone:
  /opt/bvisible/app/apps/web/.next/standalone/node_modules/.pnpm/
  @prisma+client@<hash>/node_modules/.prisma/client (engines:
  libquery_engine-debian-openssl-3.0.x.so.node …)
```

If it's missing or warns `WARN: could not find source .prisma/client`
… you've hit it again. Recover with:

```bash
ssh deploy@bvisible
cd /opt/bvisible/app
SRC=$(find node_modules/.pnpm -maxdepth 5 -type d -path "*@prisma+client*/node_modules/.prisma/client" | head -n1)
DST="apps/web/.next/standalone/${SRC}"
mkdir -p "$(dirname "$DST")" && rm -rf "$DST" && cp -r "$SRC" "$DST"
ls "$DST" | grep '\.so\.node$'   # should list the engine
bash -lc 'pm2 reload bvisible-web --update-env'
```

Then file-fix `deploy-once.sh` so the next deploy re-mirrors automatically.

### Middleware redirect Location points at `localhost:3000`

Symptom: `curl -ksSI https://vmi…/dashboard` returns
`Location: https://localhost:3000/login?next=...`. Browsers then
navigate to localhost (broken) instead of the public host.

Root cause: `req.nextUrl.host` reflects the `Host` header nginx
forwards. Nginx's default `proxy_pass http://127.0.0.1:3000` sends
`Host: 127.0.0.1:3000` (or `localhost:3000` with a different proxy_set_header),
so `NextResponse.redirect(req.nextUrl.clone())` builds the wrong absolute
URL. Fix lives in `apps/web/middleware.ts`: redirect URL is constructed
from `x-forwarded-host` + `x-forwarded-proto` headers, which nginx
*does* set. Trust those headers ONLY because port 3000 binds to
127.0.0.1 — nginx is the only thing that can reach this Node process.

If you change nginx config and the test below regresses, read the
middleware comment block at the top of the redirect path and add the
forwarded headers to nginx's `location /` block.

```bash
curl -ksSI https://vmi3270817.contaboserver.net/dashboard | grep -i location
# expected: Location: https://vmi3270817.contaboserver.net/login?next=%2Fdashboard
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

## 11a. Auth / sessions / invites

The auth surface lives at `apps/web/lib/auth/*`. All auth events write
an `AuditLog` row.

### Quick sanity

```bash
# psql shortcut from § 11:
PW=$(sudo grep '^POSTGRES_PASSWORD=' /opt/bvisible/shared/env/.env | head -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')
PSQL="docker compose -p bvisible exec -T -e PGPASSWORD=$PW db psql -U bvisible -d bvisible"

# Active sessions (not revoked, not expired):
$PSQL -c "SELECT u.email, s.\"createdAt\", s.\"lastSeenAt\", s.\"ipAddress\"
          FROM sessions s JOIN users u ON u.id = s.\"userId\"
          WHERE s.\"revokedAt\" IS NULL AND s.\"expiresAt\" > now()
          ORDER BY s.\"lastSeenAt\" DESC;"

# Recent audit log (last 50):
$PSQL -c "SELECT \"createdAt\", action, \"userId\", \"tenantId\", \"ipAddress\"
          FROM audit_logs ORDER BY \"createdAt\" DESC LIMIT 50;"

# Failed logins for an email in the last hour (throttle visibility):
$PSQL -c "SELECT \"createdAt\", \"ipAddress\", metadata
          FROM audit_logs
          WHERE action = 'login_failure'
            AND metadata->>'email' = 'someone@example.com'
            AND \"createdAt\" > now() - interval '1 hour'
          ORDER BY \"createdAt\" DESC;"

# Pending invites and reset tokens (expiry visibility):
$PSQL -c "SELECT email, role, \"expiresAt\", \"acceptedAt\"
          FROM user_invites WHERE \"acceptedAt\" IS NULL ORDER BY \"createdAt\" DESC;"
$PSQL -c "SELECT u.email, t.\"expiresAt\", t.\"usedAt\"
          FROM password_reset_tokens t JOIN users u ON u.id = t.\"userId\"
          WHERE t.\"usedAt\" IS NULL ORDER BY t.\"createdAt\" DESC;"
```

### Symptom: "I'm locked out"

If the user has no SUPER_ADMIN at all (fresh install) → see
`apps/web/scripts/README.md` for the bootstrap command.

If a single user is locked out by failed-login throttling, wait 15
minutes OR clear their recent failures:

```bash
$PSQL -c "DELETE FROM audit_logs
          WHERE action = 'login_failure'
            AND metadata->>'email' = 'them@example.com'
            AND \"createdAt\" > now() - interval '15 minutes';"
```

If a user's password is forgotten and the reset email is stubbed
(SMTP unwired), have the admin issue an invite OR have someone with
DB access generate a reset token by clicking "Forgot" on the user's
behalf and reading the inline link from the same browser session.

To force-revoke ALL sessions for a user (e.g. compromised account):

```bash
$PSQL -c "UPDATE sessions SET \"revokedAt\" = now()
          WHERE \"userId\" = (SELECT id FROM users WHERE email = 'them@example.com')
            AND \"revokedAt\" IS NULL;"
```

To soft-disable a user (login is rejected; existing sessions also
rejected on next request because `getCurrentUser()` checks
`disabledAt`):

```bash
$PSQL -c "UPDATE users SET \"disabledAt\" = now() WHERE email = 'them@example.com';"
```

### Symptom: bootstrap script refuses to run

Exit code 3 means a SUPER_ADMIN already exists. List them:

```bash
$PSQL -c "SELECT id, email, name, \"createdAt\" FROM users WHERE role = 'SUPER_ADMIN';"
```

If the existing SUPER_ADMIN's password is unrecoverable, generate a
fresh password reset token directly in the DB (after manually hashing,
or by deleting the user and rerunning the bootstrap — destructive).

### Symptom: "I get redirected to /login forever"

The middleware is doing only a cookie presence check. If the cookie is
set but the page still redirects, the page-level `requireUser()` is
finding the session invalid (expired, revoked, or user disabled). Check:

```bash
$PSQL -c "SELECT s.id, s.\"expiresAt\", s.\"revokedAt\", u.\"disabledAt\"
          FROM sessions s JOIN users u ON u.id = s.\"userId\"
          WHERE u.email = 'them@example.com'
          ORDER BY s.\"createdAt\" DESC LIMIT 5;"
```

## 11b. SMTP / mailer

Mailer code lives at `apps/web/lib/mailer.ts`. Templates live at
`apps/web/lib/emails/{render,invite,reset,test}.ts`. Auth flows that
actually send mail: `inviteUserAction`, `requestResetAction`, and
`sendTestEmailAction` (SUPER_ADMIN-only).

### Quick verification

The fastest probe is the in-app diagnostic page. Sign in as a
SUPER_ADMIN, open **Settings → Email test**. The page renders host /
port / secure / maskedUser / from / replyTo (passwords are NEVER
displayed) and a single-input form. Submitting the form runs SMTP
`verify()` first, then sends a branded test email. Errors come back
sanitized with the SMTP error code/responseCode visible.

### Required env keys (set in `/opt/bvisible/shared/env/.env`)

| Var | Required | Notes |
|---|---|---|
| `SMTP_HOST` | yes | hostname |
| `SMTP_PORT` | yes | 465 (TLS-on-connect) or 587 (STARTTLS) |
| `SMTP_USER` | yes | auth user |
| `SMTP_PASSWORD` | yes | auth password / app password. Legacy `SMTP_APP_PASSWORD` is honored as a fallback. |
| `SMTP_FROM` | yes | `From:` header |
| `SMTP_SECURE` | no | `"true"` / `"false"` to override; blank → inferred from port |
| `SMTP_REPLY_TO` | no | optional `Reply-To:` |

After editing `.env`, the next deploy (or PM2 reload) picks up the
new values — the transport is cached for the process lifetime, so a
stale config will only flush on PM2 reload.

### What the logs look like

Every mailer event emits one JSON line on stdout/stderr with a
`mailer: true` field. Allowed fields: `host, port, secure, maskedUser,
from, kind, code, responseCode, messageId, acceptedCount, rejectedCount,
message`. Tail with:

```bash
ssh deploy@212.56.32.136 \
  "tail -f /opt/bvisible/shared/logs/pm2/bvisible-web.out.log /opt/bvisible/shared/logs/pm2/bvisible-web.err.log | grep --line-buffered '\"mailer\":true'"
```

Common patterns:

| Log message | Meaning | Fix |
|---|---|---|
| `smtp_send_skipped_no_config` | env keys missing | Set `SMTP_HOST/PORT/USER/PASSWORD/FROM`, redeploy |
| `kind:"connect" code:"ECONNREFUSED"` | server not reachable | Check `SMTP_HOST`/`SMTP_PORT`; egress firewall on 465/587 |
| `kind:"auth" responseCode:535` | bad credentials | Rotate `SMTP_PASSWORD` (Gmail: regenerate app password) |
| `kind:"timeout" code:"ETIMEDOUT"` | server hung | Server-side issue; bounded to 10 s |
| `kind:"sender" command:"MAIL FROM"` | sender rejected | SPF/DKIM not aligned with `SMTP_FROM` |
| `kind:"recipient" responseCode:550-559` | recipient rejected | Bad address or relay refused |

### Audit trail

Every invite + password-reset row records the delivery outcome in
`audit_logs.metadata.mailDelivery`. Useful queries:

```bash
PW=$(sudo grep '^POSTGRES_PASSWORD=' /opt/bvisible/shared/env/.env | head -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')
PSQL="docker compose -p bvisible exec -T -e PGPASSWORD=$PW db psql -U bvisible -d bvisible"

# Outcome of last 20 invite + reset attempts:
$PSQL -c "SELECT \"createdAt\", action, metadata->>'email' AS email,
                 metadata->>'mailDelivery' AS mail
          FROM audit_logs
          WHERE action IN ('invite_created','password_reset_requested')
          ORDER BY \"createdAt\" DESC LIMIT 20;"

# Find every SMTP failure today:
$PSQL -c "SELECT \"createdAt\", action, metadata->>'mailDelivery' AS mail,
                 metadata->>'email' AS email
          FROM audit_logs
          WHERE metadata->>'mailDelivery' LIKE 'failed_%'
            AND \"createdAt\" > now() - interval '1 day'
          ORDER BY \"createdAt\" DESC;"
```

### Symptom: "test email never arrives"

1. Check the diagnostic page first. If `verify()` failed the page tells
   you exactly which kind of error.
2. If `verify()` passed but `sendMail()` failed, check the recipient
   inbox's spam folder, then check `audit_logs.mailDelivery` for the
   exact `failed_*` kind.
3. If `verify()` passed AND `sendMail()` returned `ok` but the message
   never arrives, the SMTP server accepted the message but a downstream
   filter (Gmail's spam, recipient's MX) dropped it. The `messageId`
   shown on the page is the right thing to grep your SMTP provider's
   delivery log for.

### Symptom: "invite UI shows the amber link panel instead of the green toast"

The mailer returned an error. The amber panel includes a one-line
description of which `kind` of failure. The invite token is single-use
either way — copying the link from the amber panel and delivering it
manually is fine; it's the same guarantee the pre-mailer state had.

### Symptom: Prisma is fine but `/settings/email-test` 500s on import

Nodemailer is plain JS with no native deps; standalone bundling
should work without intervention. If a future Next minor regresses
this, the symptom is `Cannot find module 'nodemailer'` in the PM2 err
log. Workaround is the same one we use for Prisma: copy the missing
package's `node_modules/.pnpm/nodemailer@*` into the standalone tree
post-build. There is no automation for this today — file an issue
and add a deploy-once.sh block similar to the Prisma engine mirror
if it ever happens.

## 11c. Estimates / pricing

### Symptom: list shows wrong subtotal/sell, but the editor shows the right one

Both the editor (browser, every keystroke) and `saveEstimateAction` (server,
on save) call the same `computeEstimate(...)` from `@bvisible/pricing`. The
list reads cached `Estimate.subtotalCostCents` / `finalPriceCents` columns.
A divergence means a save did not run — usually because the browser tab was
closed before clicking Save. Re-open the estimate, hit Save (or `Cmd/Ctrl+S`),
and the cached totals snap back into sync.

To verify the cache is correct for a specific estimate:

```bash
docker compose -p bvisible exec -T -e PGPASSWORD="$PG_PASS" db \
  psql -At -U "$PG_USER" -d "$PG_DB" -c "
    SELECT e.number, e.subtotal_cost_cents, e.final_price_cents,
           COALESCE(SUM(li.computed_cost_cents), 0) AS line_sum
    FROM estimates e
    LEFT JOIN estimate_line_items li ON li.estimate_id = e.id
    WHERE e.id = '<estimateId>'
    GROUP BY e.id;"
```

`subtotal_cost_cents` should equal `line_sum + design_flat_cents` (when no
DESIGN-kind lines are present); `final_price_cents` should equal
`subtotal_cost_cents * multiplier_milli / 1000` rounded to the nearest cent.
A mismatch is a save bug — file with the estimate number and the diff.

### Symptom: estimate saves but cells "snap back" on blur

`<NumericCell>` (`apps/web/components/grid/cell-input.tsx`) parses the typed
string on blur. If `parseMoney` / `parseQty` returns `null` (garbage input,
e.g. accidental letter), the cell snaps back to the last valid value. There's
no UI for "you typed nonsense" today — surface as a follow-up if it confuses
users. Workarounds: types like `1.5`, `1.50`, `$1.50`, `1,234.56` all parse
fine; `1.5x` and `O.5` don't.

### Symptom: "Estimate not found" on save

Caused by:
- The estimate id in the URL doesn't belong to the caller's tenant
  (someone shared a deep link across tenants).
- The estimate was soft-deleted (`deletedAt` is set).
- The user lost their tenant context (e.g. SUPER_ADMIN unsetting tenant).

Audit log shows the failed call (no row written; only an `estimate_saved`
row appears on success).

### Symptom: invite-link / multiplier override audit search

```bash
PGPASSWORD="$PG_PASS" psql -h 127.0.0.1 -U "$PG_USER" -d "$PG_DB" \
  -c "SELECT created_at, user_id, target_id, metadata
      FROM audit_logs
      WHERE action = 'estimate_multiplier_overridden'
      ORDER BY created_at DESC LIMIT 20;"
```

`metadata.from`, `metadata.to`, and `metadata.defaultMultiplierMilli` (= 3000)
let you spot estimates that diverge from the default 3.000× multiplier.

### Symptom: tenant has no machines in the editor picker

The Machine catalog is seeded per tenant by `createTenantAction`
(`apps/web/lib/estimate/seed-machines.ts`). For tenants that existed BEFORE
this seeder shipped, run a one-shot from the server:

```bash
cd /opt/bvisible/app
( set -a; . /opt/bvisible/shared/env/.env; set +a; \
  pnpm --filter @bvisible/db exec node --input-type=module -e "
import { prisma } from '@bvisible/db';
import { ensureDefaultMachines } from './apps/web/lib/estimate/seed-machines.ts';
const t = await prisma.tenant.findMany({ select: { id: true, slug: true } });
for (const x of t) await ensureDefaultMachines(x.id);
console.log('seeded', t.length, 'tenants');
" )
```

(One-liner uses ts-node-style import from the web app; if it ever proves
flaky, write the four `prisma.machine.createMany(...)` calls inline against
the shipped rates in `ESTIMATE_ENGINE.md`.)

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
