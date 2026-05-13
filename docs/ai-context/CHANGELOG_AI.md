# CHANGELOG_AI — B Visible

A running log of AI-driven changes to the codebase. Newest first. Each entry
records what changed, the files touched, the risks, and the verification.

---

## 2026-05-13 — Production runtime foundation, Phase 2 (PM2 runtime + healthcheck gate)

**Commits:** `dc01a8099e221b539db3ef5266bb6217532fa593` (feat) → `db8d8a9044310ff38baf8e664df46dd23cbe86a1` (sanity-check fix; this is the SHA that actually deployed green)
**Message:** `feat: add PM2 runtime and deploy healthcheck`

**Scope**

Phase 2 completes the runtime foundation. Wires the deploy queue to PM2
and gates deploy success on a real HTTP healthcheck of `/api/health`.
Public HTTPS now serves the actual app (no more 502 placeholder). Did NOT
add database, auth, business features, or change firewall / queue
serialization.

**What changed (repo)**

- NEW `ecosystem.config.cjs` (repo root) — PM2 spec for `bvisible-web`
  (fork mode, single instance, `cwd` at the standalone tree, env
  `NODE_ENV=production PORT=3000 HOSTNAME=127.0.0.1`,
  `max_memory_restart: 512M`, `kill_timeout: 10000`, log files under
  `/opt/bvisible/shared/logs/pm2/`).
- NEW `server-scripts/deploy-queue/healthcheck.sh` — curl-with-retry
  against `http://127.0.0.1:3000/api/health` (up to 30s). Requires JSON
  `status:"ok"` and `service:"bvisible-web"`. On failure prints
  `pm2 list`, `pm2 jlist`, last 50 lines of stdout/stderr, and `:3000`
  listeners. Exit 0 only on healthy.
- `apps/web/next.config.mjs` — gated `output: 'standalone'` on
  `NEXT_BUILD_STANDALONE=1` env var; sets
  `outputFileTracingRoot` to the workspace root so `@bvisible/db` (and
  any future workspace deps) get traced into the standalone bundle.
  Local Windows builds without the env var keep working (Next standalone
  uses symlinks that hit EPERM on Windows).
- `server-scripts/deploy-queue/deploy-once.sh` — exports
  `NEXT_BUILD_STANDALONE=1` before `pnpm run build`. After build:
  sanity-checks `@bvisible/db` is in the standalone bundle, copies
  `.next/static` into the standalone tree, copies `public/` if present,
  symlinks `apps/web/.next/standalone/apps/web/.env` →
  `/opt/bvisible/shared/env/.env`, ensures
  `/opt/bvisible/shared/logs/pm2/` exists, runs
  `bash -lc 'pm2 startOrReload .../ecosystem.config.cjs --update-env'`,
  `bash -lc 'pm2 save --force'`, sleeps 2s, then runs
  `/opt/bvisible/deploy-queue/healthcheck.sh`. Failed healthcheck →
  `exit 9`. Missing healthcheck → `exit 9` (refuses to mark a deploy
  successful without runtime verification).
- `server-scripts/04-layout-and-queue.sh` — creates
  `/opt/bvisible/shared/logs/pm2/` and installs `healthcheck.sh` to
  `/opt/bvisible/deploy-queue/` on fresh server installs.

**What changed (server)**

- `/opt/bvisible/deploy-queue/deploy-once.sh` updated in place to the
  new version (the worker runs that copy, not the repo's). Same for
  `/opt/bvisible/deploy-queue/healthcheck.sh` (new file). Both `chmod
  755`, owned by `deploy:deploy`.
- `/opt/bvisible/shared/logs/pm2/` created with `deploy:deploy` ownership.
- A real deploy of the new commit was enqueued through the queue; PM2
  process `bvisible-web` is now online and HTTPS endpoint at
  `https://vmi3270817.contaboserver.net/api/health` returns the expected
  JSON.

**Files touched**

- `ecosystem.config.cjs` (new)
- `server-scripts/deploy-queue/healthcheck.sh` (new)
- `apps/web/next.config.mjs` (modified)
- `server-scripts/deploy-queue/deploy-once.sh` (modified)
- `server-scripts/04-layout-and-queue.sh` (modified)
- `docs/ai-context/DEPLOYMENT.md` (modified)
- `docs/ai-context/DEPLOY_QUEUE.md` (modified)
- `docs/ai-context/DEBUGGING.md` (modified)
- `docs/ai-context/SECURITY_RULES.md` (modified)
- `docs/ai-context/CHANGELOG_AI.md` (this entry)

**Risks**

- The Phase 1 spec said "use `su - deploy -c '...'`" for PM2 calls. That
  works from root but NOT from inside `deploy-once.sh` (which already
  runs as `deploy` under systemd — `su` to your own user requires a
  password on Ubuntu). Replaced with `bash -lc 'pm2 ...'` which gives
  the same login-shell environment without a privilege transition.
  Verified equivalent via `systemd-run --uid=deploy --gid=deploy --pipe
  --wait bash -lc 'pm2 ping'` (the worker's exact context). Documented
  in DEPLOYMENT.md and DEBUGGING.md.
- Standalone build on local Windows still hits EPERM by design (the env
  var is unset). The deploy server (Linux) is the only place
  `NEXT_BUILD_STANDALONE=1` runs. Verified default build is unaffected.
- A failed Phase 2 deploy could leave PM2 in a half-started state. The
  failed-job rollback procedure (re-enqueue previous good `commitHash`)
  in `DEBUGGING.md` § 13 still works — `pm2 startOrReload` will reload
  the previous-good build. There is no per-release isolation for the PM2
  process in Phase 2; that's a Phase 3 concern.
- The standalone runtime relies on Next's output tracing to include
  required workspace packages. Tracing only includes what is actually
  imported, so the foundation app (which doesn't import `@bvisible/db`
  yet) won't have it in the bundle — that's correct. We do NOT
  pre-validate specific packages; the healthcheck is the canonical gate.
  An earlier draft of `deploy-once.sh` had an over-aggressive
  pre-runtime sanity check that would fail the deploy if `@bvisible/db`
  was missing; that check was removed because it false-positives on
  early-phase apps that don't yet import it. (Real deploy
  `20260513T172640-904a40` failed for exactly this reason and led to the
  removal.)

**Verification performed**

- Local: `pnpm install --frozen-lockfile` clean. Default
  `pnpm run build` green (no env var, no standalone — local Windows).
  Standalone build attempted with `NEXT_BUILD_STANDALONE=1` failed with
  the expected EPERM symlink errors — gate works as designed.
- Server: `bash -n` syntax check on `deploy-once.sh` and `healthcheck.sh`
  passes.
- Server-side acceptance is captured in this commit's deploy log entry
  below ("Deploy result").

**Deploy job ID:** `20260513T173024-0df396` (the prior job
`20260513T172640-904a40` failed at exit 8 due to the over-aggressive
`@bvisible/db` sanity check — see "Risks" — which led to the fix in
commit `db8d8a9`).
**Deploy result:** `done` in ~98 s. Release snapshot at
`/opt/bvisible/releases/20260513T173024Z-db8d8a904431`.
**PM2:** `bvisible-web` online (fork mode, pid 15871, ~97 MB), saved to
`/home/deploy/.pm2/dump.pm2`.
**Healthcheck:** OK after 1 attempt
(`{"status":"ok","service":"bvisible-web"}`).
**HTTPS health endpoint:** `GET https://vmi3270817.contaboserver.net/api/health`
returns `200 OK` with body `{"status":"ok","service":"bvisible-web"}`.
Public root `/` returns `200 OK` (Next.js home page) with security
headers from Nginx.
**Port 3000:** bound to `127.0.0.1:3000` only by `next-server` (pid 15871) —
not publicly reachable.
**Firewall:** UFW unchanged (22/80/443 only).
**Queue serialization:** unchanged (`bvisible-deploy-worker.timer` active,
flock on `deploy.lock` still in force).

---

## 2026-05-13 — Production runtime foundation, Phase 1 (PM2 + Nginx + HTTPS)

**Commit:** _(this commit, no deploy enqueued — Phase 2 will do that)_
**Message:** `feat: production runtime foundation phase 1 (pm2 + nginx + https)`

**Scope**

Phase 1 of the runtime foundation. Server-side bootstrap only. Did NOT touch
app code, Prisma, deploy-once.sh, or the deploy queue's behavior. Phase 2 will
add `output: 'standalone'`, `ecosystem.config.cjs`, `healthcheck.sh`, and the
PM2 + healthcheck integration into `deploy-once.sh`.

**What changed (server)**

- Installed PM2 v7.0.1 globally via `npm i -g pm2`.
- Installed and enabled the PM2 systemd unit for the `deploy` user
  (`/etc/systemd/system/pm2-deploy.service`). PM2 will resurrect saved
  processes on reboot.
- Replaced `/etc/nginx/sites-enabled/bvisible.placeholder` with a real
  reverse-proxy site at `/etc/nginx/sites-available/bvisible` (proxy to
  `127.0.0.1:3000`, gzip, security headers, WS upgrade, forwarded headers,
  `client_max_body_size 25m`, separate access/error logs).
- Issued a Let's Encrypt cert for `vmi3270817.contaboserver.net` via
  `certbot --nginx --redirect`. Public DNS for that hostname resolves to
  `212.56.32.136` (verified before issuance). Cert valid until 2026-08-11.
- HTTP → HTTPS 301 redirect now active. HSTS intentionally NOT set yet
  (HSTS is a one-way commitment; enable once the runtime is proven stable).
- Created an empty `/opt/bvisible/shared/env/.env` (mode 640, deploy:deploy)
  so the deploy-once.sh symlink-into-app step has something to point at.
- UFW rules unchanged. SSH port unchanged. Port 3000 stays
  localhost-only — verified `ss -tlnp` shows nothing on `:3000`.

**What changed (repo, this commit)**

- NEW `server-scripts/nginx/bvisible.conf` — the reverse-proxy config; the
  on-server `/etc/nginx/sites-available/bvisible` is this file plus
  certbot-managed HTTPS additions.
- NEW `server-scripts/setup-pm2-and-nginx.sh` — idempotent Phase 1
  bootstrap. Run once via SSH; safe to re-run.

**Files touched**

- `server-scripts/nginx/bvisible.conf` (new)
- `server-scripts/setup-pm2-and-nginx.sh` (new)
- `docs/ai-context/DEPLOYMENT.md` (runtime stack updated)
- `docs/ai-context/DEPLOY_QUEUE.md` (Phase 2 healthcheck integration noted)
- `docs/ai-context/SECURITY_RULES.md` (HTTPS posture; HSTS still off)
- `docs/ai-context/DEBUGGING.md` (PM2 + nginx + cert renewal commands)
- `docs/ai-context/CHANGELOG_AI.md` (this entry)

**Risks**

- The on-server `bvisible` site file now contains certbot-managed lines
  (the `:443` server block, ssl paths, the 301 redirect). Re-applying the
  repo file via `setup-pm2-and-nginx.sh` would strip those — the script
  detects the existing cert and re-runs certbot to re-deploy it, but if
  Let's Encrypt is rate-limiting it would fall back to HTTP-only with a
  warning. Mitigation: the script checks `/etc/letsencrypt/live/...` before
  issuance and skips if the cert exists.
- PM2 ran via `sudo -u deploy` failed with `spawn /usr/bin/node EACCES` on
  Ubuntu 24.04 (PM2 daemon spawn under sudo is blocked). The script uses
  `su - deploy -c '...'` instead, which works. Documented in DEBUGGING.md.
- Cert is for the Contabo PTR hostname (`vmi3270817.contaboserver.net`),
  not a real bvisible.* domain. When a real domain is purchased, point its
  A record at `212.56.32.136` and run
  `certbot --nginx -d <new-domain> --redirect`. The current cert keeps
  working until then.

**Verification performed**

- `https://vmi3270817.contaboserver.net/` returns HTTP/1.1 502 (no PM2
  process yet — expected for Phase 1) over a valid TLS handshake, with
  all security headers present.
- `http://vmi3270817.contaboserver.net/` returns 301 → the https URL.
- `ss -tlnp | grep :3000` → nothing listening (correct, no app yet).
- `ufw status` → still 22/80/443 only.
- `systemctl is-enabled pm2-deploy.service` → `enabled` (active is
  `inactive` because there are no resurrected processes; correct).
- `systemctl list-timers | grep certbot` → `certbot.timer` scheduled for
  next run; auto-renewal in place.
- `/opt/bvisible/shared/env/.env` exists, mode 640, owner deploy:deploy,
  size 0 bytes.
- `nginx -t` passes both before and after certbot edits.
- `setup-pm2-and-nginx.sh` is idempotent: re-running it on the now-set-up
  server reports "PM2 already installed", "pm2-deploy.service already
  installed", "${ENV_FILE} already exists — leaving contents alone",
  "${NGINX_AVAILABLE} already current".

**Next step (Phase 2 — separate commit, NOT done in this entry)**

- Add `output: 'standalone'` to `apps/web/next.config.mjs` (gated on env
  var so Windows builds keep working).
- Add `ecosystem.config.cjs` at repo root.
- Add `server-scripts/deploy-queue/healthcheck.sh`.
- Update `server-scripts/deploy-queue/deploy-once.sh` to: copy
  `.next/static` into the standalone tree, symlink `.env` into standalone
  cwd, `pm2 startOrReload --update-env`, `pm2 save`, then run the
  healthcheck. Failed healthcheck → failed deploy.
- Push, then enqueue real deploy and verify `https://vmi3270817...` /
  api/health returns `{ "status": "ok", "service": "bvisible-web" }`.

---

## 2026-05-13 — First real deploy through the queue (foundation app)

**Commit:** `ce7daf17be8174df49a31f659e30f2ebdcdbf58e`
**Message:** `fix(pnpm): allowBuilds in pnpm-workspace.yaml so prisma/sharp/unrs-resolver run install scripts on the server`

**What changed**
- Fixed pnpm v11 install on the server: moved the build-script allowlist from
  `pnpm.onlyBuiltDependencies` (in `package.json`, ignored by pnpm v11 in
  workspace mode) to `allowBuilds` in `pnpm-workspace.yaml` as a `name: true`
  map. Without this, `pnpm install --frozen-lockfile` failed with
  `ERR_PNPM_IGNORED_BUILDS` and the deploy aborted.
- Added `server-scripts/99c-enqueue-real-deploy.sh` — a helper that writes a
  job JSON for a given commit SHA, enqueues it via
  `/opt/bvisible/deploy-queue/enqueue-deploy.sh`, manually triggers the
  worker (instead of waiting up to 30 s for the systemd timer), and prints
  the final status + tail of the log.
- After this commit, the first real deploy through the queue succeeded:
  - Job `20260513T162706-2d72c3` → `done` in ~83 s.
  - Release snapshot at
    `/opt/bvisible/releases/20260513T162707Z-ce7daf17be81`.
  - `releases/current` symlink points at the new release.
  - `/opt/bvisible/app` is at HEAD `ce7daf1` with `.next/` build output
    present at `apps/web/.next/`.
  - Build steps that all ran cleanly on the server: `pnpm install
    --frozen-lockfile` (with prisma / sharp / unrs-resolver install scripts
    actually executed), `prisma generate` (Prisma Client v6.19.3),
    `next build` (4 routes including `GET /api/health`).
- App is built but not yet served by a long-running process or fronted by
  Nginx — that is intentional for the foundation phase. Serving + Nginx
  upstream + healthcheck.sh come in a subsequent change.

**Files touched**
- `pnpm-workspace.yaml` — added `allowBuilds` map (prisma, @prisma/client,
  @prisma/engines, sharp, unrs-resolver → `true`).
- `package.json` — removed `pnpm.onlyBuiltDependencies` (was being ignored
  in workspace mode).
- `server-scripts/99c-enqueue-real-deploy.sh` — NEW helper.
- `apps/web/tsconfig.json` — Next.js auto-injected `incremental: true` and
  `allowJs: true` during `next build`; committed verbatim.

**Risks**
- `allowBuilds` runs install scripts for the listed packages, which is
  exactly what we want; the allowlist is narrow (only the 5 packages we
  actually depend on that need scripts).
- Removing `pnpm.onlyBuiltDependencies` means a downgrade to pnpm v10 in
  workspace mode would silently re-trigger the ignored-builds problem. We
  pin to pnpm 11.1.1 via `packageManager` in root `package.json`.

**Verification**
- Local: `pnpm install --frozen-lockfile` runs `sharp` and `unrs-resolver`
  install scripts and exits 0. `pnpm run build` builds both `@bvisible/db`
  (`prisma generate`) and `@bvisible/web` (`next build`) green.
- Server: deploy job `20260513T162706-2d72c3` ended in `done`, log shows
  install scripts executed, `prisma generate` produced a client,
  `next build` printed all 4 routes, deploy-once exited SUCCESS.

**Follow-ups**
- Move `experimental.typedRoutes` to top-level `typedRoutes` in
  `apps/web/next.config.mjs` (Next 15 deprecation warning); harmless but
  noisy.
- Add a long-running web service (likely systemd unit calling
  `pnpm --filter @bvisible/web exec next start -p 3000`), an Nginx upstream
  block, and `healthcheck.sh` so deploys actually validate `GET /api/health`
  on the live port.
- Wire Postgres + run `prisma migrate deploy` from `deploy-once.sh`.

---

## 2026-05-13 — Server foundation scripts checked in

**Commit:** `60978feeadb5a77e6a9c8396292059b75fba3596`
**Message:** `chore: add server foundation scripts and gitignore`

**What changed**
- Brought the previously-untracked server foundation artifacts into version
  control so the repo state matches the deployed server and the AI-context
  docs that already reference these paths.
- Extended `.gitignore` to cover the full required protection set
  (`.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa*`, `uploads/`, `logs/`,
  `node_modules/`, `.next/`, `dist/`, `build/`) plus common editor / OS
  cruft.
- No server change. No deploy queue behavior change. No app code added.

**Files touched (all NEW)**
- `.gitignore` (extended pattern set)
- `.cursor/rules/git-push-before-deploy.mdc` (always-apply rule)
- `server-scripts/01-recon.sh`
- `server-scripts/02-create-deploy-user.sh`
- `server-scripts/03-base-and-runtime.sh`
- `server-scripts/03b-fix-node22.sh`
- `server-scripts/04-layout-and-queue.sh`
- `server-scripts/05-nginx-fail2ban-ufw.sh`
- `server-scripts/05b-enable-ufw.sh`
- `server-scripts/99-acceptance.sh`
- `server-scripts/99b-debug-enqueue.sh`
- `server-scripts/verify-docs.js`
- `server-scripts/deploy-queue/bvisible-deploy-worker.service`
- `server-scripts/deploy-queue/bvisible-deploy-worker.timer`
- `server-scripts/deploy-queue/deploy-once.sh`
- `server-scripts/deploy-queue/deploy-worker.sh`
- `server-scripts/deploy-queue/enqueue-deploy.sh`
- `server-scripts/deploy-queue/status.sh`
- `docs/ai-context/DEPLOY_QUEUE.md` (one-line cross-reference to this commit)

**Files intentionally excluded**
- `.env` (local development convenience file at repo root) — confirmed
  ignored by `.gitignore` line 2 via `git check-ignore -v .env`.

**Risks**
- Low. Pure file staging plus a `.gitignore` extension. The 17 staged
  scripts/units already exist on the server and have not been changed by
  this commit.

**Verification**
- Manual read of every staged file — no secrets, no tokens, no real DB URLs,
  no SSH key material, no app passwords. Only the public IP `212.56.32.136`
  and the public GitHub repo URL appear, both already published in the
  AI-context docs.
- Regex secret scan across the staging set returned **0 matches** for
  `PRIVATE KEY`, `BEGIN OPENSSH`, `DATABASE_URL=`, `APP_PASSWORD`, `TOKEN=`,
  `PASSWORD=`, `SECRET=`, `BEGIN RSA`, `BEGIN EC`, `api[_-]?key`,
  `aws_access_key`, `aws_secret`, `sk_live_`, `sk_test_`, `ghp_`, `ghs_`,
  `gho_`, `github_pat_`, and high-entropy 40+ char base64/hex literals.
- `git check-ignore -v` confirmed `.gitignore` matches every required
  pattern: `.env`, `.env.production`, `*.pem`, `*.key`, `id_rsa`,
  `uploads/x`, `logs/x`, `node_modules/x`, `.next/x`, `dist/x`, `build/x`.
- Script and unit names cross-checked against `DEPLOY_QUEUE.md` and
  `DEPLOYMENT.md` — `enqueue-deploy.sh`, `deploy-worker.sh`,
  `deploy-once.sh`, `status.sh`, `bvisible-deploy-worker.{service,timer}`
  all match the docs exactly.
- `git push origin main` succeeded; remote `origin/main` is at
  `60978feeadb5a77e6a9c8396292059b75fba3596`.

---

## 2026-05-13 — AI context foundation

**What changed**
- Created the AI-context documentation system that future Cursor sessions
  must use to navigate the repo without scanning everything.

**Files touched**
- `docs/ai-context/CURSOR_START_HERE.md` (root anchor + routing table + standard opener + standard end-of-task block)
- `docs/ai-context/ARCHITECTURE.md`
- `docs/ai-context/DATA_MODEL.md`
- `docs/ai-context/API_STRUCTURE.md`
- `docs/ai-context/AUTH_AND_PERMISSIONS.md`
- `docs/ai-context/ESTIMATE_ENGINE.md` (formulas, banner rule, machine rates, channel-letter formula + multipliers, manual overrides)
- `docs/ai-context/PO_SYSTEM.md`
- `docs/ai-context/EMAIL_INGESTION.md`
- `docs/ai-context/VENDOR_PRICE_ENGINE.md`
- `docs/ai-context/UI_SYSTEM.md`
- `docs/ai-context/DEPLOYMENT.md` (real completed server setup)
- `docs/ai-context/DEPLOY_QUEUE.md` (real completed deploy queue)
- `docs/ai-context/ENVIRONMENT_VARIABLES.md`
- `docs/ai-context/FILE_STRUCTURE.md`
- `docs/ai-context/KNOWN_RULES.md`
- `docs/ai-context/CODING_STANDARDS.md`
- `docs/ai-context/TESTING.md`
- `docs/ai-context/MOBILE_APP.md`
- `docs/ai-context/SECURITY_RULES.md`
- `docs/ai-context/DEBUGGING.md`
- `docs/ai-context/CHANGELOG_AI.md` (this file)
- `docs/prompts/CURSOR_PROMPT_TEMPLATE.md` (mirrors opener + end-of-task block)

**No app behavior changed.** No code, no migrations, no packages, no server
state, no deploy queue change.

**Risks**
- Low. Documentation only.
- Drift risk: numbers in `ESTIMATE_ENGINE.md` (channel-letter materials,
  multipliers) need confirmation with the shop owner before any code reads
  them. Flagged inline.
- Drift risk: schema sketch in `DATA_MODEL.md` is a target — replace with the
  real Prisma schema once it lands.

**Verification**
- All 22 files exist on disk in the listed paths.
- `CURSOR_START_HERE.md` contains: project summary, "Practicality is king,
  user-friendly is queen", read-only-relevant-docs guidance, no-whole-repo
  rule, no-unrelated-files rule, root-cause-and-plan rule, Git-first deploy
  rule, exact-`commitHash` rule, one-deploy-at-a-time rule, tenant-isolation
  rule, full task routing table.
- The exact standard opener block is present in both
  `CURSOR_START_HERE.md` and `docs/prompts/CURSOR_PROMPT_TEMPLATE.md`.
- The exact STANDARD END-OF-TASK DOC UPDATE block is present in both files.
- `DEPLOYMENT.md` + `DEPLOY_QUEUE.md` reflect real values: IP `212.56.32.136`,
  Ubuntu 24.04.4, `/opt/bvisible` layout, `deploy` user, Git-first model,
  exact `commitHash` requirement, queue folders, `bvisible-deploy` and
  `bvisible-status` commands, 30-second systemd timer, SSH/HTTP/HTTPS-only
  firewall, `.env` at `/opt/bvisible/shared/env/.env`.
- `ESTIMATE_ENGINE.md` contains all formulas and machine rates from the
  brief (Materials, Machines, Shop labor, Design 150 flat, Install rate,
  raw cost, 3× sell, sqft formula, banner rule + grommets, machine rates,
  channel-letter formula and multipliers, manual overrides).
- `EMAIL_INGESTION.md` includes Google Workspace app-password setup, IMAP
  + SMTP test snippets, inbox scan loop, PO-number detection,
  `(tenantId, messageId)` duplicate guard, attachment storage path, vendor
  document parsing, review queue.
- `VENDOR_PRICE_ENGINE.md` includes cheapest-vendor logic, vendor matching
  by sender email/domain/alias, item alias support, lower-price detection,
  `VendorPrice`/`VendorPriceHistory` flow, manual-dismiss notification.
- `UI_SYSTEM.md` covers SaaS 2026 look, sidebar, sliding drawer behavior,
  cards, rounded corners, soft shadows, badges, tables with search/filter,
  empty states, no raw JSON, B Visible branding, practicality-first.
- `DEBUGGING.md` covers deploy queue, stuck lock, systemd/journal, nginx,
  Docker, build failures, healthcheck, disk/memory/CPU, email ingestion,
  tenant-scope, Prisma/DB, UI hydration, recovery posture, and the
  never-log-secrets rule.
- `CURSOR_PROMPT_TEMPLATE.md` exists and shares the opener + ending blocks
  byte-for-byte with `CURSOR_START_HERE.md`.
