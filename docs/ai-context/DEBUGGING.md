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

## 0b. Core workflow regression (Vitest bundles)

Run **after checkout** under `/opt/bvisible/app` (or locally):

```bash
pnpm --filter @bvisible/web run verify:estimate-pricing
pnpm --filter @bvisible/web run verify:estimate-quote
pnpm --filter @bvisible/web run verify:estimate-po-flow
pnpm --filter @bvisible/web run verify:estimate-invoice-flow
pnpm --filter @bvisible/web run verify:ocr-reconciliation-flow
pnpm --filter @bvisible/web run verify:po-receipt-workflow
pnpm --filter @bvisible/web run verify:po-lifecycle
pnpm --filter @bvisible/web run verify:workflow-queues
pnpm --filter @bvisible/web run verify:email-ingestion   # 59 tests: match + storage + ingest-fixtures + operational-safety + review-reasons + email-review-po-suggestions
pnpm --filter @bvisible/web run verify:email-ingestion-fixtures   # 18 tests: MIME parse + dedupe fixtures only
pnpm --filter @bvisible/web run verify:email-operational-safety   # 19 tests: review-reasons + dedupe/OCR/vendor-price static safety
pnpm --filter @bvisible/web run typecheck
bash server-scripts/db/.verify-email-ingestion-flow.sh
```

Do **not** treat passes as a substitute for **deploy queue healthcheck** after releasing (`§ 1`, `/api/health`).

**PO receipt / reconciliation (production DB posture, on app host):**

```bash
cd /opt/bvisible/app
bash server-scripts/db/.verify-po-receipt-smoke-prod.sh
```

Confirms OCR approve wires reconciliation, VPH isolation, and lists fixture PO `PO-901004` posture. Live approve + replay checks: use `/admin/ocr-review` (browser) or operator-only tsx against `approveOcrDocumentAction` path — do not auto-mutate prod from CI.

**PO detail execution workspace (operator QA):**

| Step | Expect |
|------|--------|
| Open `/purchase-orders/[id]` with OCR or recon activity | Sticky **Operations** bar visible; one primary CTA (not three duplicate cards) |
| Scroll line grid | Ops bar stays pinned; line grid reachable without passing estimate quote panel |
| Vendor email on PO | **Latest vendor reply** in right meta panel; timeline vendor rows highlighted |
| Attachments | Upload row at top of panel; email-sourced files show **✉ Email** chip |

Regression: `verify:po-lifecycle`, `verify:po-receipt-workflow`, `typecheck` (no browser required).

**OCR review workspace (operator QA):**

| Step | Expect |
|------|--------|
| Queue `/admin/ocr-review` | Dense rows; status chips; stale badge on rows >2d; tab counts always visible; optional **Stale** filter; **Showing N of total** + **Load more** (`?page=`); **Review →** column; `j`/`k` row link focus |
| Queue `/admin/email-ingestion` | Bucket + reason filters; **Load more** (`?page=`); reason chips use DB `count()` |
| Inbox `/admin/reconciliation` | Open alerts + recent snapshots paginated (`?page=`); spend strip on dashboard shows preview count vs total |
| Detail — Needs review | Sticky decision rail; line table; **Review next →** when queue has another job; attachment opens in new tab |
| Approve | Pricing + reconciliation message; **Open reconciliation** chip appears |
| Reject | “No pricing was written” — no VPH rows |
| Failed tab | Engine error panel; no line approval table |

Regression (no browser): `pnpm --filter @bvisible/web run verify:ocr-quality`, `verify:ocr-reconciliation-flow`, `typecheck`.

## 0c. Logged-in browser smoke (Playwright)

After deploy (or against local `pnpm dev`), exercise the **staff UI + public quote** once with Playwright.

**Who runs this:** the human operator on a laptop — **not** CI agents and **not** from `/opt/bvisible/shared/env/.env` on the server. Agents skip browser smoke when `BVISIBLE_ADMIN_PASSWORD` is unavailable; that is expected. Operators must create a local credential file once.

**Post-deploy checklist + triage:** `server-scripts/smoke/POST_DEPLOY_SMOKE.md` (canonical operator runbook).

### Smoke account strategy

| Rule | Detail |
|------|--------|
| Login | Reuse `admin@bvisible.local` (SUPER_ADMIN) or your real staff email — **no** second smoke user with a repo-known password |
| Password | **Only** in `~/.bvisible-smoke.env` / `%USERPROFILE%\.bvisible-smoke.env` on the operator laptop |
| Server | **Never** store smoke password in `/opt/bvisible/shared/env/.env` |
| CI / GitHub | Default pipelines do **not** run Playwright login; do **not** commit `BVISIBLE_ADMIN_PASSWORD` |
| Forgot password | On app host: `pnpm --filter @bvisible/web run reset-super-admin-password` (interactive); update local env only |
| DB check (host) | `bash server-scripts/smoke/verify-smoke-admin.sh` — confirms user + password hash exist; **never** prints password |

### Required env (never commit passwords)

| Variable | Example |
|----------|---------|
| `BVISIBLE_BASE_URL` | `https://vmi3270817.contaboserver.net` or `http://127.0.0.1:3000` |
| `BVISIBLE_ADMIN_EMAIL` | staff login email |
| `BVISIBLE_ADMIN_PASSWORD` | staff password — **never print, log, or commit** |

### Where to store credentials

| Platform | Path |
|----------|------|
| Linux / macOS / Git Bash | `~/.bvisible-smoke.env` |
| Windows | `%USERPROFILE%\.bvisible-smoke.env` (e.g. `C:\Users\you\.bvisible-smoke.env`) |

Playwright also auto-loads this file via `apps/web/smoke/load-smoke-env.ts` when vars are unset in the shell.

### One-time setup — Windows PowerShell

From the repo root:

```powershell
Copy-Item server-scripts\smoke\.bvisible-smoke.env.example $env:USERPROFILE\.bvisible-smoke.env
notepad $env:USERPROFILE\.bvisible-smoke.env   # set BVISIBLE_ADMIN_PASSWORD
```

Verify (use Git Bash — installed with Git for Windows):

```powershell
& "C:\Program Files\Git\bin\bash.exe" server-scripts/smoke/check-smoke-env.sh
```

Expected when password is set: `OK — credentials present`, base URL + email shown, `BVISIBLE_ADMIN_PASSWORD=(set, not shown)`.

Install Chromium once (any shell):

```powershell
pnpm --filter @bvisible/web exec playwright install chromium
```

Run smoke — **one command** (PowerShell, repo root):

```powershell
.\server-scripts\smoke\run-smoke.ps1 all
```

Or via Git Bash:

```powershell
& "C:\Program Files\Git\bin\bash.exe" server-scripts/smoke/run-smoke.sh all
```

### One-time setup — Git Bash / Linux / macOS

```bash
cp server-scripts/smoke/.bvisible-smoke.env.example ~/.bvisible-smoke.env
chmod 600 ~/.bvisible-smoke.env
# edit: set BVISIBLE_ADMIN_PASSWORD (never print or commit)

bash server-scripts/smoke/check-smoke-env.sh
pnpm --filter @bvisible/web exec playwright install chromium
```

`chmod 600` restricts the file to your user (recommended on Unix). Windows has no chmod — keep the file in your profile directory only.

Alternatively export `BVISIBLE_*` in the shell for the session (same three vars). **Do not** put the smoke password in `/opt/bvisible/shared/env/.env` unless explicitly approved.

### Verify env before running (read-only)

**Laptop (credentials):**

```bash
bash server-scripts/smoke/check-smoke-env.sh
```

**App host (DB user — SSH, no password printed):**

```bash
cd /opt/bvisible/app
bash server-scripts/smoke/verify-smoke-admin.sh
```

| Script | Exit `0` | Exit `2` | Exit `3` / `4` |
|--------|----------|----------|----------------|
| `check-smoke-env.sh` | All three `BVISIBLE_*` vars set locally | Missing vars / no file | — |
| `verify-smoke-admin.sh` | User exists, active, has password hash | Compose / DB / env failure | `3` missing user; `4` no password hash |

`check-smoke-env.sh` exit codes:

| Exit code | Meaning |
|-----------|---------|
| `0` | All three vars set; prints base URL + email only |
| `2` | Missing var(s) — lists `MISSING: BVISIBLE_*` lines, no password echoed |

### Run smoke suites

Wrapper (checks env, installs Chromium if needed, runs Playwright):

```bash
bash server-scripts/smoke/run-smoke.sh core              # core only
bash server-scripts/smoke/run-smoke.sh vendor            # vendor-normalization only
bash server-scripts/smoke/run-smoke.sh po-lifecycle      # PO lifecycle only
bash server-scripts/smoke/run-smoke.sh all               # all three sequentially
```

Or from repo root (requires env already set or `~/.bvisible-smoke.env` present — Playwright loads the file):

```bash
pnpm --filter @bvisible/web run smoke:core
pnpm --filter @bvisible/web run smoke:vendor-normalization
pnpm --filter @bvisible/web run smoke:po-lifecycle
pnpm --filter @bvisible/web run smoke:all                # all specs in smoke/
```

| Suite | What it checks |
|-------|----------------|
| `smoke:core` | Dashboard command-center queues (sticky filters, dual-column work queues), `/estimates` + `/estimates/new` route smoke, editor shell (Line items / Catalog / Pricing helper), `SMOKE-CoreWorkflow` quote path (catalog Apply on draft; **Create & add lines** button; status column index 3) |

**Dashboard layout regression (no browser):** after dashboard UI changes, run `verify:workflow-queues` + `verify:po-lifecycle` — derivation unchanged; Vitest locks queue predicates. Command summary counts are computed client-side from queue rows in `dashboard-command-summary.tsx` (not new DB queries). Retired dashboard section components (`dashboard-estimate-po-flow.tsx`, `dashboard-estimate-invoice-flow.tsx`) were removed 2026-05-25; **`getDashboardEstimatePoFlow`** / **`getDashboardEstimateInvoiceFlow`** libs remain for Vitest only.

**Dead UI cleanup (2026-05-25):** removed unused shells with zero import graph — `components/workflow/{estimate-workflow-rail,po-operational-rail}.tsx`, `components/po/po-receipt-workflow-summary.tsx`. Shipped surfaces: **`EstimateFulfillmentPanel`** + **`EstimateDailyWorkflowStrip`** (estimate detail), **`PoExecutionWorkspace`** (PO detail). Verify: `typecheck`, `verify:workflow-queues`, `verify:po-lifecycle`, `verify:estimate-quote`.
| `smoke:vendor-normalization` | Vendor rail + OCR review copy (`SMOKE-VendorNorm`) |
| `smoke:po-lifecycle` | Lifecycle rail + operator buttons; **mutations only on `SMOKE-*` PO numbers**; read-only rail on `PO-90100*` fixtures if no `SMOKE-` PO |

### What output means

| Output | Meaning |
|--------|---------|
| `[smoke-env] OK` | Credentials loaded; safe to run Playwright |
| `[smoke-env] MISSING: …` / exit `2` | Create or fix `~/.bvisible-smoke.env`; smoke will be skipped |
| `[smoke] Target: https://…` | Wrapper is hitting that base URL |
| Playwright `N passed` | Suite succeeded |
| Playwright `timeout` / `401` / login redirect loop | Wrong password, wrong base URL, or app down — re-run `check-smoke-env.sh` and confirm deploy |
| `SMOKE-CoreWorkflow` already FINALIZED/REJECTED | Delete or reset that estimate (see smoke data below) and re-run |

Do **not** treat console output or CI artifacts as secret-safe — `playwright.config.ts` disables screenshots/video/trace by default.

### Failure triage

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| `check-smoke-env` exit `2` | No `~/.bvisible-smoke.env` | Copy `.bvisible-smoke.env.example`; set password locally |
| `verify-smoke-admin` exit `3` | Wrong email or missing user | Match `BVISIBLE_ADMIN_EMAIL`; bootstrap on fresh DB |
| `verify-smoke-admin` exit `4` | User has no password hash | `reset-super-admin-password` on host; update local env |
| Playwright stuck on `/login` | Wrong password / URL | Re-run `check-smoke-env.sh`; confirm deploy `commit` on base URL |
| `timeout` after login | App slow or down | `curl` health on host; retry |
| `bash: command not found` (Windows) | No Git Bash in PATH | `run-smoke.ps1` or full path to `bash.exe` |
| Chromium missing | Playwright not installed | `pnpm --filter @bvisible/web exec playwright install chromium` |
| `SMOKE-CoreWorkflow` FINALIZED | Stale fixture row | `.list-smoke-data.sh` → optional cleanup |
| Server `check-smoke-env` exit `2` | Expected — no server credentials | Run Playwright from laptop only |

### Common failures (quick list)

1. **`bash: command not found` (Windows)** — use `.\server-scripts\smoke\run-smoke.ps1` or Git Bash full path
2. **All specs skipped / env missing** — operator file not created; agents cannot invent the password
3. **Login failure** — typo in password or email; staging URL mismatch in `BVISIBLE_BASE_URL`
4. **Chromium not installed** — run `pnpm --filter @bvisible/web exec playwright install chromium`
5. **Stale `SMOKE-CoreWorkflow` estimate** — blocked finalize state; inventory + optional cleanup below

The suite creates/reuses rows prefixed **`SMOKE-`** (`SMOKE-Client`, `SMOKE-CatalogItem`, estimate title **`SMOKE-CoreWorkflow`**). Email/OCR fixtures use **`PO-901001`–`PO-901004`** and **`SMOKE-EMAIL*`** vendors/emails.

### Smoke data inventory and cleanup (app host)

Fixtures use prefixes **`SMOKE-`**, **`PO-90100*`**, **`SMOKE-EMAIL*`** only. Real customer rows are never targeted.

**List smoke rows (read-only, run on production app host via SSH):**

```bash
cd /opt/bvisible/app
bash server-scripts/db/.list-smoke-data.sh
```

Prints clients, vendors, estimates, POs, ingested emails, OCR docs, and count summary. No deletes.

**Cleanup (destructive — dry-run by default):**

```bash
cd /opt/bvisible/app
bash server-scripts/db/.cleanup-smoke-data.sh
# prints "DRY RUN" and row counts — NO deletes

CONFIRM_SMOKE_CLEANUP=1 bash server-scripts/db/.cleanup-smoke-data.sh
# WARNING: deletes only SMOKE-* / PO-90100* / SMOKE-EMAIL* fixture rows
```

> **Warning:** `CONFIRM_SMOKE_CLEANUP=1` permanently removes smoke/fixture rows only. Never run against a database you have not inventoried with `.list-smoke-data.sh` first. Prefer dry-run; use manual SQL for FK-heavy chains if unsure.

On operator laptops without `/opt/bvisible/app`, list/cleanup scripts exit at `cd` — that is expected; SSH to the app host instead.

**Playwright from operator laptop:** `bash server-scripts/smoke/run-smoke.sh all` (credentials in `~/.bvisible-smoke.env`, not server `.env`).

**On production app host (`/opt/bvisible/app`, commit `c91b7f0+`):** smoke scripts ship with every deploy under `server-scripts/smoke/`. Running `bash server-scripts/smoke/check-smoke-env.sh` on the server **without** `~/.bvisible-smoke.env` is expected to exit **2** (fail-fast, no secrets printed) — do **not** create smoke credentials on the server; operators run Playwright from a laptop only.

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

Expected body: `{"status":"ok","service":"bvisible-web"}`. After a deploy via
`deploy-once.sh`, responses may also include **`commit`** (full git SHA written to
`.bvisible-deploy-commit` beside standalone `server.js`) — use this when the DB
migration looks new but the UI still matches an older release (stale PM2 cwd /
wrong checkout).

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

### Deploy-queue scripts vs `/opt/bvisible/app`

`deploy-worker.sh` runs **`/opt/bvisible/deploy-queue/deploy-once.sh`**, not the
copy under **`/opt/bvisible/app/server-scripts/`**. After `deploy-once.sh`
finishes successfully, it copies **`server-scripts/deploy-queue/*.sh`** and
**`server-scripts/db/db-verify.sh`** into **`/opt/bvisible/deploy-queue/`** so
future timer ticks use the same revision as the repo checkout.

**Bootstrap:** the **first** upgrade onto that behavior requires the **on-disk**
`deploy-once.sh` to match the repo once (e.g. copy from a fresh clone or from
`$APP_DIR` after `git fetch && git checkout <sha>` without going through the
worker). Until then, infra edits under `server-scripts/deploy-queue/` only take
effect after manual `cp` to `/opt/bvisible/deploy-queue/`.

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

## 9. Email ingestion failures (Phase 8)

The poller is a systemd timer + service pair on the deploy box that
hits the in-process Next.js route every minute. There is **no** docker
container for ingestion — the work runs inside `bvisible-web`.

### Timer / service health

```bash
systemctl status bvisible-ingest-tick.timer  --no-pager
systemctl status bvisible-ingest-tick.service --no-pager
systemctl list-timers --all | grep bvisible-ingest
journalctl -u bvisible-ingest-tick.service --since "1 hour ago" --no-pager
```

The `.service` is a one-shot `curl -X POST -H 'x-bvisible-ingest-secret: …'
http://127.0.0.1:3000/api/internal/email-ingest/tick`. Its journal lines
are the curl exit and the JSON tick summary. The summary never includes
credentials, body bytes, or attachment hashes paired with sender PII.

### Manual tick

```bash
SECRET=$(sudo grep '^INGEST_TICK_SECRET=' /opt/bvisible/shared/env/.env \
         | head -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')
curl -fsS -X POST \
  -H "x-bvisible-ingest-secret: ${SECRET}" \
  http://127.0.0.1:3000/api/internal/email-ingest/tick \
  | jq .
```

Expected: `{ "ok": true, "runs": [{ "tenantId": "...", "scanned": N,
"ingested": N, "matched": N, "errors": 0, "durationMs": ms }] }`.
A `503` means `INGEST_TICK_SECRET` is unset on the server. A `401`
means the secret on disk doesn't match what the timer sent — re-edit
`/opt/bvisible/cron/bvisible-ingest-tick.sh` if you rotated the secret
without redeploying.

### Test connection (in-app, recommended)

The fastest way to diagnose IMAP problems is the SUPER_ADMIN form.
Open `/admin/tenants/<tenantId>/email-inbox`, optionally edit the
host/port/mailbox, and click **Test connection**. The result panel
renders one of:

| UI message                                                  | What it means                                              | Fix |
|-------------------------------------------------------------|------------------------------------------------------------|-----|
| `Connected. <N> mailboxes visible. Selected mailbox "..." exists.` | Auth + mailbox check both succeeded.                       | None. Hit **Save**. |
| `Authentication failed. Check the username and password.`   | IMAP login rejected.                                       | Rotate the app password. For Gmail Workspace: regenerate at <https://myaccount.google.com/apppasswords> and paste the new value into the password field. Leaving it blank keeps the old (failing) cipher in place. |
| `Connected, but the configured mailbox/folder does not exist on the server.` | TLS + auth OK, the mailbox name isn't in `LIST` output.    | Check capitalization (Gmail labels are case-sensitive) and the slash-escape rules for nested folders. Default to `INBOX`. |
| `Could not reach the IMAP server. Check host, port, and TLS.` | DNS / TCP / connect-time failure.                          | Verify host + port; confirm UFW egress isn't blocking outbound 993; try `openssl s_client -connect $HOST:$PORT` from the deploy box. |
| `TLS handshake failed. Check the TLS toggle and the port.`  | Negotiation died after TCP came up.                        | Mismatch between the TLS toggle and the port (e.g. TLS=on with port 143). Most providers want 993+TLS=on. |
| Generic message + audit `kind=unknown`                      | Did not match any classifier.                              | Tail PM2 stderr or hit the internal `/test` endpoint with curl for the raw `result` payload (which still never carries the password). |

The form's password field is **blank on render** — empty submit means
"keep the existing sealed cipher". Type a new value to rotate. The
test never marks messages `\Seen` and never writes anything to the
database; it's a pure connectivity probe.

### Test connection (curl, service-to-service)

```bash
SECRET=$(sudo grep '^INGEST_TICK_SECRET=' /opt/bvisible/shared/env/.env \
         | head -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')

# Test the stored config for a tenant by passing tenantId only.
curl -fsS -X POST \
  -H "x-bvisible-ingest-secret: ${SECRET}" \
  -H "content-type: application/json" \
  --data '{"tenantId":"<TENANT_ID>","host":"imap.gmail.com","port":993,"secure":true,"mailbox":"INBOX","username":"ingest@yourdomain.com"}' \
  http://127.0.0.1:3000/api/internal/email-ingest/test \
  | jq .

# Test a fresh password without saving.
curl -fsS -X POST \
  -H "x-bvisible-ingest-secret: ${SECRET}" \
  -H "content-type: application/json" \
  --data '{"host":"imap.gmail.com","port":993,"secure":true,"mailbox":"INBOX","username":"ingest@yourdomain.com","password":"<APP_PASSWORD>"}' \
  http://127.0.0.1:3000/api/internal/email-ingest/test \
  | jq .
```

Returns `{ "ok": true, "data": { "ok": true|false, "kind"?, "message"?, "mailboxCount"?, "mailboxExists"?, "durationMs": ms } }`.
Same 503 / 401 semantics as `/tick`. Never writes to the DB, never
marks `\Seen`, never returns the password it received.

### IMAP connect failure

PM2 stderr is the source of truth. The mailer-style discipline applies:
allowed log fields are `messageId`, `senderDomain`, `attachmentCount`,
`matchReason`, `durationMs`, `errorKind`. Forbidden: passwords, raw
RFC822 source, raw imapflow auth objects.

```bash
tail -n 200 -f /opt/bvisible/shared/logs/pm2/bvisible-web.err.log \
  | grep --line-buffered '"emailIngest":true'
```

Common patterns:

| `errorKind` | Meaning | Fix |
|---|---|---|
| `imap_connect` | Server unreachable / DNS / TLS handshake failed | Check `IMAP_HOST` / `IMAP_PORT` / `IMAP_TLS`. Provider may have rotated cert chain. |
| `imap_auth` | Auth rejected | Rotate the app password / OAuth secret. For Gmail Workspace: regenerate at <https://myaccount.google.com/apppasswords>. Then update either `IMAP_PASSWORD` (env-var fallback) or the per-tenant `TenantEmailInbox.passwordCipher` (re-seal via `INGEST_SECRET`). |
| `imap_fetch` | Mailbox vanished or message disappeared mid-fetch | Provider hiccup; transient — next tick retries. If persistent, confirm `IMAP_MAILBOX` exists and the account hasn't been suspended. |
| `parse_failed` | `mailparser` couldn't read the RFC822 source | Row will land with `status = FAILED` and a sanitized `errorMessage`. Use the operator UI's **Failed** filter to inspect; **Retry** queues another tick. |
| `persist_failed` | DB write or attachment persist threw | Almost always disk-full or file-system permission drift. Check `df -h` + `ls -ld /opt/bvisible/shared/uploads/<tenantId>`. |

### "Same email keeps coming back" / suspected duplicate

Every email is uniquely keyed on `(tenantId, messageId)` per R-MAIL-01.
The IMAP message is only marked `\Seen` after the row commits, so a
crash mid-tick replays safely on the next tick.

```bash
PW=$(sudo grep '^POSTGRES_PASSWORD=' /opt/bvisible/shared/env/.env | head -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')
PSQL="docker compose -p bvisible exec -T -e PGPASSWORD=$PW db psql -U bvisible -d bvisible"

# How many distinct messages have we ingested for a tenant?
$PSQL -c "SELECT count(*), count(DISTINCT \"messageId\")
          FROM ingested_emails
          WHERE \"tenantId\" = '<tenantId>';"
# The two counts MUST be equal. If not, the unique index has been dropped.

# Bytes-on-disk dedupe via SHA-256:
$PSQL -c "SELECT sha256, count(*) FROM ingested_email_attachments
          WHERE \"tenantId\" = '<tenantId>'
          GROUP BY sha256 HAVING count(*) > 1
          ORDER BY 2 DESC LIMIT 20;"
```

### Lots of unmatched emails

Open `/admin/email-ingestion` (ADMIN+) and use the **Unmatched** filter.
For each row the panel shows the body snippet and per-attachment list
with download links. The matcher is deterministic; common reasons for
unmatched:

- The vendor wrote a free-form thread without a PO or QBO token → use
  the inline **Link to PO** combobox + **Link** button.
- Multiple open POs for the same vendor and no explicit token → the row
  stays `UNMATCHED` until an operator picks the PO.
- The PO was last updated outside the **30-day** vendor-and-recent window
  → manually link.

### Vendor price extraction (Phase 10)

Successful ingestion logs `vendor_price_extraction` (stdout / PM2) with
`tenantId`, `vendorId`, `emailId`, `inserted`, `duplicates`, `skipped`,
`candidates` — **never** raw email bodies or IMAP secrets. Failures in the
post-materialize hook emit `vendor_price_extraction_failed` (warn) while the
email row stays `MATCHED`.

```bash
tail -n 200 -f /opt/bvisible/shared/logs/pm2/bvisible-web.err.log \
  | grep --line-buffered -E 'vendor_price_extraction|vendor_price_extraction_failed'
```

**Deterministic DB verification (no IMAP)** — creates tenant slug
`vendor-pricing-verify`, seeds vendor + PO + synthetic `IngestedEmail`, runs the
same `runVendorPriceExtractionAfterMaterialize` path the ingest hook uses,
asserts catalog/history/notification/`VENDOR_LOWER_PRICE` counts + replay
dedupe, then deletes the tenant:

```bash
# From the deploy box as deploy (sources DATABASE_URL from shared env):
bash /opt/bvisible/app/server-scripts/db/.verify-vendor-pricing.sh

# From a dev machine with DATABASE_URL exported:
cd apps/web
pnpm exec tsx --tsconfig tsconfig.json scripts/verify-vendor-pricing.ts
```

Expected terminal output ends with `PASS vendor-pricing DB verification`.

**Estimate catalog lookup unit checks (no DB)**

```bash
pnpm --filter @bvisible/web run verify:vendor-catalog
```

Covers deterministic catalog merge ordering + trend thresholds used by the estimate editor intelligence rail.

**Vendor normalization bundle (no DB)**

```bash
bash server-scripts/db/.verify-vendor-normalization.sh
```

Runs `verify:vendor-catalog` (normalize, material-match, unit-conversion, catalog-lookup, pricing-aggregate), `verify:estimate-pricing`, and `verify:ocr-quality`.

**Inspect unread lower-price notifications** (adjust `tenantId`):

```bash
PW=$(sudo grep '^POSTGRES_PASSWORD=' /opt/bvisible/shared/env/.env | head -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')
docker compose -p bvisible exec -T -e PGPASSWORD="$PW" db \
  psql -U bvisible -d bvisible -c \
  "SELECT id, \"vendorId\", \"oldPriceCents\", \"newPriceCents\", \"createdAt\"
     FROM vendor_price_notifications
    WHERE \"tenantId\" = '<tenantId>' AND \"dismissedAt\" IS NULL
 ORDER BY \"createdAt\" DESC LIMIT 20;"
```

**Inspect extraction history**:

```bash
docker compose -p bvisible exec -T -e PGPASSWORD="$PW" db \
  psql -U bvisible -d bvisible -c \
  "SELECT \"itemNameNormalized\", \"priceCents\", confidence, \"extractionMethod\", \"sourceEmailId\", \"createdAt\"
     FROM vendor_price_histories
    WHERE \"tenantId\" = '<tenantId>'
 ORDER BY \"createdAt\" DESC LIMIT 30;"
```

**Clear sandbox alerts safely:** use the dashboard **Dismiss** control (writes
`dismissedAt` + audit `vendor_price_notification_dismissed`). Avoid deleting
production notification rows from SQL unless you are intentionally repairing a
bad migration — prefer dismissal so the audit trail stays coherent.

### Lease / overlap visibility

```bash
$PSQL -c "SELECT \"tenantId\", \"lastPolledAt\", \"lastErrorAt\",
                 \"lastErrorMessage\"
          FROM tenant_email_inboxes
          ORDER BY \"lastPolledAt\" DESC NULLS LAST;"
```

`lastPolledAt` younger than `pollIntervalSeconds` is the soft lease that
prevents two ticks from racing. PM2 restart / `pm2 reload` is safe — the
new process will respect the lease as soon as it observes the row.

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

## 11d. Purchase orders / vendors / attachments

### Symptom: list shows wrong PO subtotal but the editor shows the right one

`POLineItem.computedCostCents` is recomputed inside
`savePurchaseOrderAction` and `PurchaseOrder.subtotalCents` is the cached
sum. The list reads the cached column, the editor recomputes locally on
every keystroke. If they diverge, a save did not run — re-open the PO and
hit Save (or `Cmd/Ctrl+S`).

To verify the cache is correct for a specific PO:

```bash
PW=$(sudo grep '^POSTGRES_PASSWORD=' /opt/bvisible/shared/env/.env | head -n1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/')
PSQL="docker compose -p bvisible exec -T -e PGPASSWORD=$PW db psql -U bvisible -d bvisible"

$PSQL -c "
  SELECT po.number, po.subtotal_cents,
         COALESCE(SUM(li.computed_cost_cents), 0) AS line_sum
  FROM purchase_orders po
  LEFT JOIN po_line_items li ON li.purchase_order_id = po.id
  WHERE po.id = '<purchaseOrderId>'
  GROUP BY po.id;"
```

`subtotal_cents` should equal `line_sum` exactly. A mismatch is a save bug.

### Symptom: "Finalize" button is greyed out on an estimate

The button uses **`evaluateEstimateFinalizeGates()`** — same rules as
`finalizeEstimateAction` (server is source of truth). Common failure modes:

| Reason shown | Fix |
|---|---|
| not approved | Mark estimate **Approved** after customer acceptance. |
| no linked PO | Click "Create PO from estimate" in the totals panel (or link an existing PO). |
| missing QBO | Open each linked PO and paste QuickBooks PO numbers; commits on blur. |
| reconciliation unresolved | Open PO reconciliation; resolve variance or accept match. |
| already finalized | Unfinalize (ADMIN+) before retrying. |

Verify gates locally:

```bash
pnpm --filter @bvisible/web run verify:estimate-finalization
```

Server-side PO + QBO + recon snapshot query:

```bash
$PSQL -c "
  SELECT e.number AS est_no, e.status, po.number AS po_no, po.qbo_po_number,
         r.status AS latest_recon
  FROM estimates e
  LEFT JOIN purchase_orders po
    ON po.estimate_id = e.id AND po.tenant_id = e.tenant_id AND po.deleted_at IS NULL
  LEFT JOIN LATERAL (
    SELECT status FROM po_reconciliations pr
    WHERE pr.purchase_order_id = po.id AND pr.tenant_id = po.tenant_id
    ORDER BY pr.created_at DESC LIMIT 1
  ) r ON true
  WHERE e.id = '<estimateId>'
  ORDER BY po.created_at;"
```

Finalize succeeds only when status is **APPROVED**, every linked PO has
`qbo_po_number`, and no row shows recon status outside **MATCHED**/**RESOLVED**
(null recon is OK).

### Symptom: FINALIZED estimate still allows edits in the UI

As of the finalized lockdown pass, **FINALIZED** estimates render read-only in the editor:
static line grid, no catalog/pricing Apply, disabled Save, and **`guardedDispatch`** no-ops.
If operators still see editable controls, confirm `Estimate.status === FINALIZED` in the DB and
hard-refresh — stale client bundles should not occur after deploy.

**Save** remains disabled client-side; **`saveEstimateAction`** returns an error if status is
FINALIZED (authoritative). Unfinalize (ADMIN+) to edit again.

Verify:

```bash
pnpm --filter @bvisible/web run verify:estimate-finalization
```

### Symptom: PO timeline missing an event you expect

Every state-changing action writes a `POEvent` AND an `AuditLog` row.
List both side-by-side:

```bash
$PSQL -c "
  SELECT 'event' AS src, kind::text AS kind, created_at, message
  FROM po_events WHERE purchase_order_id = '<poId>'
  UNION ALL
  SELECT 'audit', action, created_at, COALESCE(metadata->>'message','')
  FROM audit_logs
  WHERE target_id = '<poId>' AND action LIKE 'po_%'
  ORDER BY created_at DESC;"
```

If the `audit` row exists but the `po_events` row doesn't, the action
crashed AFTER the audit and BEFORE the event insert — file a bug with
the audit row's id and the deploy log around that timestamp.

### Symptom: attachment upload fails ("not allowed" / 400)

Two server-side validations can refuse a file:

1. **Size > 25 MB** — enforced by `experimental.serverActions.bodySizeLimit`
   in `apps/web/next.config.mjs` AND by an explicit check in
   `uploadPoAttachmentAction`. Client `File.type` is irrelevant.
2. **Unrecognized magic bytes** — the action runs
   `detectMimeFromBytes()` (PDF / JPEG / PNG / WEBP only). A `.pdf`
   file that's actually HTML will be rejected. The client-supplied
   `Content-Type` is ignored.

To confirm a file's real magic bytes locally:

```bash
xxd -l 12 path/to/file
# %PDF-       → application/pdf
# FF D8 FF    → image/jpeg
# 89 50 4E 47 → image/png
# RIFF...WEBP → image/webp
```

### Symptom: attachment download returns 404

The handler at `/api/po/[id]/attachments/[attachmentId]/route.ts`
returns 404 (never 403) for any of:

- caller has no tenant → `requireTenantId()` throws → 404
- attachment row not found under `(tenantId, purchaseOrderId)` → 404
- PO is soft-deleted → 404
- on-disk file missing → 404
- on-disk magic bytes no longer match the upload allowlist → 404

This is intentional (don't leak whether an id exists in another tenant).
To distinguish causes, look at the row directly:

```bash
$PSQL -c "
  SELECT a.id, a.storage_key, a.mime_type, a.size_bytes,
         po.number, po.deleted_at
  FROM po_attachments a
  JOIN purchase_orders po ON po.id = a.purchase_order_id
  WHERE a.id = '<attachmentId>';"
```

And on disk:

```bash
ls -la /opt/bvisible/shared/uploads/<tenantId>/po/<poId>/
```

Files are mode `0640`, owned by `deploy:deploy`, named with the
random `storageKey` (NOT the original filename — that's display-only
metadata).

### Symptom: upload succeeded but file is missing from disk

The action persists the file BEFORE inserting the `POAttachment` row.
If the row exists but the file doesn't, either:

- Manual `rm` on the server (forensic — check shell history).
- Disk full at write time (`df -h /`).
- The deploy queue's snapshot/restore path nuked
  `/opt/bvisible/shared/uploads/`. The shared dir is preserved across
  deploys precisely so this can't happen via the normal path; if it
  does, re-check the symlink farm in `/opt/bvisible/app/`.

### Symptom: PO numbering collision (`PO-NNNNNN`)

`nextPoNumber()` (`apps/web/lib/po/number.ts`) wraps a per-tenant
Postgres advisory lock (`acquireTenantSequenceLock(tx, tenantId,
'purchase_order')`) around a `MAX(number)`-style scan. Two requests in
the same tenant serialize behind the lock; two tenants do not contend.
A duplicate number is therefore impossible unless the unique index
`purchase_orders_tenantId_number_key` is dropped. Verify:

```bash
$PSQL -c "\d purchase_orders" | grep -i unique
# expected: purchase_orders_tenantId_number_key  UNIQUE  ...
```

## 11e. Mobile API (`/api/v1`)

### Symptom: login returns 503 `server_misconfigured`

Set `MOBILE_JWT_SECRET` (≥ 32 chars) in the server `.env`, restart PM2.

### Symptom: 401 `session_invalid` right after logout

Expected — logout revokes `mobile_sessions`; acquire new tokens via login.

### Symptom: refresh returns 401 after success once

Refresh tokens **rotate** server-side. The Expo app persists the latest refresh
pair inside `saveTokens` (`apps/mobile/lib/session.ts`) — preferring SecureStore.

### Symptom: parallel requests logged everyone out

Fixed posture: `/auth/refresh` runs behind a **single-flight mutex**
(`apps/mobile/lib/refresh-lock.ts`) so simultaneous 401s do not stampede refresh.

### Symptom: `upload_complete` ran twice — duplicate attachments?

It should not duplicate rows: handler is idempotent (`finalize-mobile-upload.ts`).
Optional verification:

```bash
TEST_PO_ID=<cuid> TEST_UPLOAD_COMPLETE_IDEMPOTENCY=1 bash server-scripts/db/.verify-mobile-api.sh
```

### Symptom: `mobile_pending_uploads` table growing

Expired reservations (`expiresAt < now`, `completedAt` null) can accumulate if clients never finish.
Safe retention cleanup (example monthly cron — adjust window):

```bash
$PSQL -c "DELETE FROM mobile_pending_uploads WHERE \"completedAt\" IS NULL AND \"expiresAt\" < NOW() - INTERVAL '14 days';"
```

### Symptom: CORS / OPTIONS from Expo

Middleware sends `Access-Control-Allow-*` for `/api/v1`. If you still see
preflight failures, confirm the app calls `EXPO_PUBLIC_API_BASE_URL` over HTTPS.

### Deterministic smoke script

On the server (with Next listening locally):

```bash
export BOOTSTRAP_EMAIL=...
export BOOTSTRAP_PASSWORD=...
bash server-scripts/db/.verify-mobile-api.sh
# Optional: TEST_PO_ID=<cuid> TEST_UPLOAD_COMPLETE_IDEMPOTENCY=1 bash server-scripts/db/.verify-mobile-api.sh
```

## 11f. Receipt OCR worker (`/api/internal/ocr/tick`)

### Host packages (production)

Ubuntu: install **`tesseract-ocr`** (CLI) and **`poppler-utils`** (`pdftoppm` for
scanned PDFs without a text layer):

```bash
sudo bash /opt/bvisible/app/server-scripts/ocr/install-runtime-deps.sh
```

Idempotent; installs only those two apt packages and verifies both CLIs.

### Env keys (never log values)

| Key | Required | Notes |
|---|---|---|
| `OCR_TICK_SECRET` | optional | Preferred secret for `x-bvisible-ocr-secret` on `/api/internal/ocr/tick`. |
| `INGEST_TICK_SECRET` | yes (if `OCR_TICK_SECRET` unset) | Fallback when operators use one shared internal secret. Route returns **503** if neither is set. |

Set in `/opt/bvisible/shared/env/.env`, then reload PM2 (`deploy-once.sh` does this).

### Manual tick (loopback)

```bash
# Load secret without printing it (OCR_TICK_SECRET wins over INGEST_TICK_SECRET)
SECRET=$(
  sudo bash -c 'set -a; . /opt/bvisible/shared/env/.env; set +a
    if [ -n "${OCR_TICK_SECRET:-}" ]; then printf %s "$OCR_TICK_SECRET"
    else printf %s "${INGEST_TICK_SECRET:-}"; fi'
)
curl -sS -X POST \
  -H "x-bvisible-ocr-secret: ${SECRET}" \
  http://127.0.0.1:3000/api/internal/ocr/tick
```

Without a secret header the route returns **401** or **503** JSON — not a `/login`
redirect (middleware whitelists this path like email-ingest tick).

### Runtime verification (server)

```bash
bash /opt/bvisible/app/server-scripts/db/.verify-ocr-runtime.sh
```

Checks middleware posture, tick auth, `tesseract` + `pdftoppm`, optional loopback
tick, and that no `VendorPriceHistory` row references OCR line items on
non-`CONFIRMED` documents.

### OCR quality (parsing rules + fixtures)

```bash
pnpm --filter @bvisible/web run verify:ocr-quality
bash server-scripts/db/.verify-ocr-quality.sh   # Linux server: host binaries + vitest
```

Text fixtures live in `apps/web/lib/ocr/fixtures/sample-invoices.ts` (simple/multi-line/wrapped/blurry/table/qty-@/unit-suffix/noise/rotated-meta); PDF/PNG bytes
are generated on demand by `fixtures/generate-binary.ts` (not stored in git).
Email MIME builders: `apps/web/lib/email-ingest/fixtures/mime.ts` (no binary blobs in git).

**Production smoke (deploy box, after deploy):** attach generated fixture to a PO,
enqueue OCR, run worker tick until `REVIEW_REQUIRED`:

```bash
cd /opt/bvisible/app/apps/web
set -a && source /opt/bvisible/shared/env/.env && set +a
pnpm exec tsx ocr-prod-smoke.ts   # or enqueue + curl tick; see CHANGELOG_AI 9f75650 entry
```

Expect line items with `extractionSource` parse reasons; legacy unreadable PDFs move to
**FAILED** at `OCR_MAX_ATTEMPTS` (14).

### Deterministic parse-only checks (CI / laptop)

```bash
bash server-scripts/db/.verify-ocr-receipt-parse.sh
```

### PO reconciliation unit checks

```bash
pnpm --filter @bvisible/web run verify:reconciliation
pnpm --filter @bvisible/web run verify:reconciliation-alerts
```

Covers deterministic pairing, tolerance math, aggregate status ordering, canonical
dedupe-key hashing, **`reconciliationAlertIdentityKey`**, and supersede **where-clause**
policy (`apps/web/lib/reconciliation/*.test.ts`).

### Spend alerts: OPEN vs SUPERSEDED (stale dashboard noise)

- **Active ops UI** (dashboard strip, `/admin/reconciliation`, vendor OPEN counts) queries
  `SpendAlert.status = OPEN` only.
- When a **new** `POReconciliation` snapshot is inserted for a PO, the runner marks prior
  **`OPEN` alerts with non-null `poReconciliationId`** as **`SUPERSEDED`** and sets
  `supersededAt` + `supersededByReconciliationId` before inserting alerts for the new run.
  **`DISMISSED` rows are untouched** (never reopened by automation).
- **Inspect in SQL** (replace tenant / PO ids):

```sql
SELECT id, status, kind, "poReconciliationId", "supersededByReconciliationId", "supersededAt", "dismissedAt"
FROM spend_alerts
WHERE "tenantId" = '<tenant_id>' AND "purchaseOrderId" = '<po_id>'
ORDER BY "createdAt" DESC;
```

Expect resolved historical problems as **`SUPERSEDED`** with `supersededByReconciliationId`
pointing at the newer snapshot; the PO reconciliation detail page lists rows with status chips for audit.

**Variance workspace UX (operator browser checks, post–Agent K)**

| Step | Expected |
|------|----------|
| Open `/admin/reconciliation` with OPEN alerts | **Review variance** is primary; Dismiss is secondary with tooltip |
| Open `/purchase-orders/[id]/reconciliation` | **Needs review** section first; card rows show PO vs receipt + signed Δ; action buttons have hover hints |
| Clean snapshot (all matched, no OPEN alerts) | Emerald “Latest snapshot is clean…” banner; **Mark reconciled** promoted in toolbar |
| After operator stamp + newer snapshot | Amber stale-stamp banner at top |
| Dashboard `/dashboard` (admin) | **SpendOperationAlerts** shows compare-only copy + **Review variance** per row |

Regression (no browser): `verify:po-receipt-workflow`, `verify:ocr-reconciliation-flow`, `verify:workflow-queues`, `typecheck`.

### Symptom: jobs stuck `FAILED`

Read `ocr_documents.lastError` (short technical message only — never raw OCR dumps).
Confirm `tesseract` exists on `$PATH` and the attachment MIME is in the PO upload allowlist.

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
