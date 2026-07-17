# B Visible — Agent Handoff

Last updated: 2026-07-16 · Last deployed commit: `52561ad` (branch `feat/premium-estimate-editor-workspace`)
Production: https://vmi3270817.contaboserver.net · Health: `/api/health` (returns `{status, service, commit}`)

This document is the complete operating manual for any AI agent continuing work on this system.
Read it fully before changing anything.

---

## 1. What this system is

B Visible is the operations platform for **B Visible Signs & Printing** (sign shop, 97 Route 17M, Harriman NY, 407-374-1527). It covers estimates, purchase orders, customers, vendors, catalog, vehicles, reports, receipt OCR, email ingestion, PO reconciliation, and an AI business assistant.

The estimate/PO flows were rebuilt (2026-07-15/16) to match the flow of a reference app the customer built (`b-visible-pricing-external-*.vercel.app`), driven by his Google pricing Sheet. The reference app's source is in `docs/estimate-po-redesign/reference-handoff/` (gitignored). Mockups 1–9 and the gap analysis are in `docs/estimate-po-redesign/`.

### Monorepo layout (pnpm workspaces)

| Path | What |
|---|---|
| `apps/web` | Next.js 15 App Router, React 19, TypeScript, Tailwind 4 — the whole product |
| `apps/mobile` | Expo/React Native app (field staff: receipts + PO photos). JWT auth + presigned uploads already shipped — see `docs/ai-context/MOBILE_APP.md` |
| `packages/db` | Prisma + PostgreSQL. Migrations in `packages/db/prisma/migrations/` |
| `packages/pricing` | Pure pricing engine (`computeEstimate`) + money helpers |
| `server-scripts/` | Deploy-queue scripts that live on the server (kept in sync after each deploy) |

### Non-negotiable business rules

- **R-EST-05 (critical):** square-foot items and vehicle wraps carry FINAL selling prices from the Sheet. They are `markupExempt: true` and must NEVER be multiplied by the estimate markup again. `finalPrice = round(nonExemptCost × multiplier) + exemptCost + designFlat`.
- All money is **integer cents**; quantities are **qtyMilli** (×1000); multiplier is **multiplierMilli** (default 3000 = ×3.00 sell = "200% markup"). Margin % ⇒ mult = 1/(1−pct/100); Markup % ⇒ mult = 1+pct/100.
- The **Google Sheet is the source of truth** for materials, machine rates, sq-ft rates, vehicle wraps, bundles, recommendations, vendors. App overrides sit on top (Pricing backend page); active price = override ?? sheet.
- The AI assistant may **only read** tenant data and the Sheet, and may only ever create **drafts** / client-side prefills. It must never send, email, approve, finalize, delete, or touch code/server. Owner stated this explicitly.

---

## 2. Google Sheet integration

- Sheet ID: `1mvk26cMgwpPE3nEYSHmOtKTNcoRvTvdIJGNssDR1yiI` ("B Visible Formula") — public, read via GViz JSON (no API key):
  `https://docs.google.com/spreadsheets/d/{id}/gviz/tq?tqx=out:json&sheet={tab}` (strip the `setResponse(` wrapper).
- Tab names include **intentional misspellings**: `Meterial price`, `Machinary Price` — do not "fix" them.
- Code: `apps/web/lib/sheet-sync/` — `gviz.ts` (fetch), `parse.ts` (per-tab column parsers), `sync.ts` (`runSheetSync` batched upserts into `shop_material_items` by `sheetKey`; machine dedupe keeps exact-Sheet-name row and deactivates dupes; `getSheetSnapshot` = stale-while-revalidate, 5-min TTL, in-flight dedup map), `active-price.ts` (override ?? sheet), `fuzzy.ts` (character-bigram Dice + token prefix/substring + joined-adjacent-token matching + ALIASES tab expansion; tests in `fuzzy.test.ts`).
- The owner updates prices in the Sheet; the app follows automatically (5-min TTL, or the Refresh button on Pricing backend).

---

## 3. Deploy pipeline (memorize this)

1. Commit and push to GitHub `https://github.com/izzwgg-arch/bvisible.git`, branch **`feat/premium-estimate-editor-workspace`** (this is what production deploys — NOT main).
2. Enqueue a deploy job over SSH (key `/c/Users/izzyw/.ssh/cursor_bvisible`, user `deploy@212.56.32.136`):
   ```
   printf %s '{"repoUrl":"https://github.com/izzwgg-arch/bvisible.git","branch":"feat/premium-estimate-editor-workspace","commitHash":"<FULL_SHA>","services":[],"requestedBy":"<who/why>"}' \
     | /opt/bvisible/deploy-queue/enqueue-deploy.sh -
   ```
   Prints `JOB_ID` on the last line. Queue docs: `server-scripts/deploy-queue/` + DEPLOY_QUEUE readme on disk.
3. The worker (flock-serialized, one deploy at a time): checkout → `pnpm install` → build → **`prisma migrate deploy`** (migrations run automatically) → `pm2 reload bvisible-web` → healthcheck `http://127.0.0.1:3000/api/health`. Logs: `/opt/bvisible/deploy-queue/logs/<JOB_ID>.log`; job lands in `done/` or `failed/`.
4. Verify: `curl -s http://127.0.0.1:3000/api/health` shows the new commit hash. Builds take ~4–5 minutes.
5. `deploy` has **passwordless sudo**. nginx site: `/etc/nginx/sites-available/bvisible` (symlinked into sites-enabled — use `readlink -f` before `sed -i`, or you'll replace the symlink). `proxy_read_timeout`/`proxy_send_timeout` are **300s** (raised from 60s on 2026-07-16 because assistant requests exceed 60s). `proxy_buffering off` already set.
6. **Stale-tab caveat:** shop tabs stay open all day. A deploy does not reach an already-open tab until it reloads. If a user reports a new feature "not working", first ask them to refresh.

## 4. Executing commands on this Windows machine (critical workaround)

The local PowerShell MCP has a stripped environment: no PATH entries for node/git, no PATHEXT, and stdout of native exes is not captured. **Nothing works directly.** The established pattern:

1. Write a batch file `C:\dev\projects\B Visible\.agent-run.cmd`:
   ```bat
   @echo off
   set PATH=C:\dev\.corepack-bin;C:\Program Files\nodejs;C:\Program Files\Git\cmd;C:\Program Files\Git\bin;C:\Windows\System32;C:\Windows;C:\Windows\System32\WindowsPowerShell\v1.0
   set PATHEXT=.COM;.EXE;.BAT;.CMD
   set HOME=C:\Users\izzyw
   cd /d "C:\dev\projects\B Visible"
   call pnpm --filter @bvisible/web typecheck > .agent-build.log 2>&1
   echo EXIT=%ERRORLEVEL% >> .agent-build.log
   ```
2. Run it: `Start-Process cmd.exe -ArgumentList '/c','"C:\dev\projects\B Visible\.agent-run.cmd"' -Wait -WindowStyle Hidden`
3. Read `.agent-build.log` with `Get-Content`.

Notes:
- Escape `%` as `%%` inside the batch file.
- SSH goes through Git Bash: `"C:\Program Files\Git\bin\bash.exe" -c "ssh -i /c/Users/izzyw/.ssh/cursor_bvisible -o BatchMode=yes deploy@212.56.32.136 '...'"`. For complex remote scripts, write `.agent-remote.sh` and pipe: `ssh ... 'bash -s' < .agent-remote.sh` (heavy inline quoting silently breaks cmd).
- MCP calls time out around ~60s — poll long jobs with repeated short `Start-Sleep` calls.
- The Linux sandbox (mounted copy) CANNOT build/test this repo (pnpm junctions, Prisma resolution fail). All builds/tests/git run on Windows via the batch pattern. Bulk file edits from the sandbox side have corrupted files before (appended NUL bytes; truncated a file) — prefer targeted Edits.
- DATABASE_URL for local prisma commands: parse it from `apps\web\.env.local` (findstr/for loop in batch).

Useful scripts (`apps/web/package.json`): `typecheck`, many `verify:*` vitest suites, `smoke:*` playwright.

## 5. Browser verification

Chrome extension MCP (claude-in-chrome) is connected; tabs live in an MCP tab group. Gotchas learned the hard way:
- **Minimized/hidden windows:** React selective hydration pauses in hidden tabs — pages render HTML but effects don't run; CDP clicks/typing don't land; renderers freeze (`Runtime.evaluate` timeouts). Verify UI only with a visible window; otherwise verify server-side via `fetch` from an authenticated tab's JS context.
- Extension screenshots intermittently fail with a `clip.scale` deserialization error — retry, or verify via `javascript_tool` + `getBoundingClientRect`.
- `form_input`/programmatic value-setting does NOT fire React onChange on this app's controlled inputs — use real keystrokes (`computer` type) on a visible tab.
- Tab IDs go stale; recreate with `tabs_create_mcp`.

---

## 6. The AI business assistant (current flagship feature)

### Server: `apps/web/lib/assistant/agent.ts`

- Plain-fetch OpenAI chat-completions tool loop (no SDK). Model default `gpt-5-mini` (row `assistant_settings.model`), key: `assistant_settings.apiKeyCipher` (AES-256-GCM via `sealSecret/openSecret` from `lib/email-ingest/crypto.ts`), env `OPENAI_API_KEY` fallback. Admin UI to set/change/remove the key: Assistant page → settings panel (never echoed back).
- **Loop:** 16 rounds max, 90s per OpenAI call; on the final round `tool_choice:'none'` forces a usable answer (never "too many tool steps"). The system prompt instructs batching all lookups as parallel tool calls in one round.
- **Tools (whitelist — the agent's entire capability surface):**
  - Read-only: `search_materials`, `get_recommendations`, `get_rates`, `search_vehicle_wraps`, `business_snapshot` (all tenant-scoped, Sheet/DB reads).
  - `propose_estimate_lines` — no server write; lines returned to the client, rendered with a one-click "Add" button on the open estimate.
  - `prefill_estimate` — no server write; full estimate (title, customer, markup, lines) returned to the client; the Create-estimate page opens prefilled; **operator reviews and saves**. This is the DEFAULT for "make me an estimate". Full sign-recipe guidance is in the system prompt (LED module density, PSUs, wire, hardware, machine time, labor, design, install, ink-as-MISC assumption).
  - `save_memory` — writes to `assistant_memories` (learning, below).
  - `create_estimate_draft` — the ONLY DB write that creates records; DRAFT only, audited (`via: 'ai_assistant'`), salesRep = current user. Used only when the operator explicitly asks for a direct draft.
- **Learning:** `assistant_memories` table (per-tenant, capped 300, migration `20260716180000_assistant_memories`). The newest 60 are injected as a MEMORY system message each turn; the prompt tells the model to `save_memory` when corrected or taught a rule. This is how the agent "gets more perfect over time" — reinforce this pattern in future work.
- Voice: `transcribeVoiceNote` → OpenAI `whisper-1` (`/api/assistant/transcribe`, multipart, 15MB cap, audio never stored).
- Routes: `POST /api/assistant` ({messages, context}) and `POST /api/assistant/transcribe`. Both `requireTenantId`.

### Client: dock + context + prefill

- `apps/web/components/assistant/assistant-dock.tsx` — floating ✦ pill bottom-right on every page (mounted in `components/app-shell.tsx`, hidden on `/assistant`). Docked drawer, conversation persists across pages (sessionStorage `bv-assistant-dock-v1`), tool chips, draft card, proposed-lines card with Add button, prefill card, mic button (MediaRecorder → transcribe → composer).
- `apps/web/lib/assistant/context-store.ts` — client store **kept on `globalThis`** (`__bvAssistantContextStore`) because layout/page client graphs can duplicate the module. Pages publish live context; dock sends it as `context`; the agent receives it as a CURRENT SCREEN system note. Publishers: guided builder (`estimates/new`), estimate editor (`estimates/[id]`), shop-order flow. Appliers: `registerLineApplier` (add lines in place), `registerPrefillApplier` + `parkPendingPrefill`/`takePendingPrefill` (sessionStorage handoff `bv-assistant-pending-prefill` — dock/assistant-page parks the prefill and `router.push('/estimates/new')`; the guided builder applies it on mount).
- Flow the owner wants (verified live): ask from ANY page → agent researches the Sheet → Create-estimate page opens with everything filled → operator adjusts → Save. Nothing saved automatically.

### Assistant constraints (owner's words — do not loosen)

- No back-end/code/server changes; DB + Sheet access only.
- Drafts and on-screen prefills only; the operator finalizes everything.
- (Open request, un-actioned:) owner mentioned wanting it to also "read the files on his computer" — NOT implemented; would need explicit design + consent.

---

## 7. What was built in this engagement (map of features → files)

| Feature | Key files |
|---|---|
| Home hub (2 cards only) | `app/(app)/home/page.tsx`; nav in `components/app-shell.tsx` (Home, Overview=/dashboard, …) |
| Guided estimate flow (3 paths: ready items / custom build / sq-ft) | `app/(app)/estimates/new/{page,guided-builder,guided-actions,custom-build-panel,recommendations-panel,json-import-panel}.tsx` |
| Auto sign-type detection from job name (fuzzy, confidence %) | guided-builder `detectedSign` → auto-opens RecommendationsPanel |
| Vehicle wraps with make logos + variants | guided-builder `MakeLogo` (clearbit), wrap make filter |
| JSON estimate import (validate → preview → apply) | `json-import-panel.tsx` |
| Estimate editor extras: margin/markup % editors, sales rep, QBME | `estimates/[id]/{editor,totals-panel,estimate-header-actions,qbme/*}.tsx`, `lib/estimate/qbme.ts` (+tests; exact `QB_ESTIMATE_START/Line=ITEM|DESC|QTY|RATE|AMOUNT/QB_ESTIMATE_END` format, allowed ITEMs: Wrapping, Sales, 3D Lettering, Design, Shipping, Installation; rounding drift into largest bucket) |
| Shop-order purchasing (draft-first; one PO per vendor; Amazon/Home Depot → cart links + office mailto draft, never auto-ordered; Send PO explicit) | `app/(app)/purchase-orders/shop-order/*`, PO print `app/po-print/[id]/*` |
| Pricing backend (admin): status, operating rates, override cells, legacy deactivation | `app/(app)/pricing-backend/*` (use `requireRoleWithEffectiveCompany` — bare `requireRole` breaks SUPER_ADMIN) |
| Sheet sync + fuzzy search | `lib/sheet-sync/*` |
| Pricing engine markupExempt | `packages/pricing/src/{types,estimate}.ts` + tests |
| Assistant (page, dock, agent, memory, prefill, voice) | §6 files |
| Migrations added | `20260715190000_sheet_pricing_source`, `20260716050000_estimate_sales_rep`, `20260716150000_assistant_settings`, `20260716180000_assistant_memories` |

**Parallel edits warning:** the user (or another agent) has been editing in parallel — e.g. `estimates/[id]/editor.tsx` gained `canEditPricing` on EditorBootstrap. Always `git pull`/diff before editing; never blind-revert their changes.

---

## 8. Known gotchas / lessons learned

- Sheet tab misspellings are intentional (see §2).
- `markupExempt` must be preserved through every save path (`saveEstimateAction` re-reads flags by old line id before replace-all).
- nginx `sed -i` on sites-enabled symlink replaces the symlink — `readlink -f` first.
- Login redirects go to `/home` (changed from /dashboard) — app/page.tsx, login/invite/reset actions.
- The assistant dock reads `r.structuredContent`… n/a — it parses plain JSON from `/api/assistant`.
- OpenAI requests through nginx: keep responses < 300s; if agent work ever grows, switch `/api/assistant` to a heartbeat-streaming response rather than raising timeouts further.
- `AuditAction` union in `lib/auth/audit.ts` must contain any new action string you log.
- `noUncheckedIndexedAccess` is on — guard `array[0]`.
- Prisma client must be regenerated after schema changes: `pnpm --filter @bvisible/db exec prisma generate` (locally; the server build does it itself).

## 9. Test data / cleanup owed to the user

- Production: estimate `EST-000017` + "TEST Customer" + `PO-000007` (draft) were created during verification — user may delete.
- Customer's reference system: test POs #409/#410 + one test estimate.
- Working files `.agent-run.cmd`, `.agent-build.log`, `.agent-remote.sh`, `.agent-exit.log` in repo root are scratch (gitignored) — safe to delete.

## 10. Open / pending work

1. **Mobile app (explicitly requested, not started):** iPhone + Android. Open with B Visible logo → log in by **scanning a QR code from the user's online profile** (needs: QR on web profile + one-time-token exchange endpoint, e.g. `/api/v1/auth/qr`) or username/password (exists: `/api/v1/auth/login` JWT + rotating refresh, `MOBILE_JWT_SECRET`, `mobile_sessions`). Inside: two buttons — "Scan receipt" and "Receive order delivery"; each asks for a PO number, takes a photo, uploads to that PO (presigned upload flow exists: presign → PUT → complete, magic-byte validation; see `docs/ai-context/MOBILE_APP.md`). Build **APK locally on this machine** ("I have everything on this computer"), then iOS build (user says Apple credentials + Expo are already configured here). Start by inventorying `apps/mobile/app/` + `lib/` to see which screens exist.
2. Assistant reading local files + expanded observation — owner interest noted, needs design + explicit approval (§6 constraints).
3. Possible next assistant iteration: show live "working" progress (streaming) in the dock; memory management UI (view/delete lessons).
4. Keep reinforcing the learning loop: when the owner corrects an estimate, the agent should `save_memory` — watch that this actually happens in practice.

## 11. Verification checklist for any change

1. `pnpm --filter @bvisible/web typecheck` (via batch pattern).
2. Relevant `vitest` suites (fuzzy, qbme, markup-exempt at minimum for pricing-adjacent work).
3. Commit → push → enqueue deploy → poll job log → health shows new commit.
4. Live browser check in a VISIBLE window (user demands "make sure everything matches before you tell me it's done").
5. Remind the user that already-open tabs need one reload.
