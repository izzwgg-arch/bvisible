# CHANGELOG_AI — B Visible

A running log of AI-driven changes to the codebase. Newest first. Each entry
records what changed, the files touched, the risks, and the verification.

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
