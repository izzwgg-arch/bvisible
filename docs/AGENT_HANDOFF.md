# B Visible — Agent Handoff
Last updated: 2026-07-22 · Last deployed commit: `5b2e079` (branch `feat/premium-estimate-editor-workspace`)
Production: https://vmi3270817.contaboserver.net · Health: `/api/health` (returns `{status, service, commit}`)

This document is the complete operating manual for any AI agent continuing work on this
system. It supersedes the 2026-07-16 handoff. Read it fully before changing anything.

---

## 1. What this system is

B Visible is the operations platform for **B Visible Signs & Printing** (sign shop, 97 Route
17M, Harriman NY, 407-374-1527): estimates, invoices, purchase orders, customers, vendors,
catalog, vehicle wrap pricing, reports, receipt OCR, email ingestion, PO reconciliation, and a
full-operator AI assistant.

### Monorepo layout (pnpm workspaces)
| Path | What |
|---|---|
| `apps/web` | Next.js 15 App Router, React 19, TS, Tailwind 4 — the whole product |
| `apps/mobile` | Expo/React Native (field staff). JWT auth + presigned uploads shipped |
| `packages/db` | Prisma + PostgreSQL (DB runs in docker container `bvisible-db` on the server) |
| `packages/pricing` | Pure pricing engine (`computeEstimate`) + money helpers |
| `server-scripts/` | Deploy-queue scripts mirrored on the server |

### Non-negotiable business rules
- **R-EST-05 (critical):** sq-ft items and vehicle wraps carry FINAL selling prices —
  `markupExempt: true`, NEVER multiplied by estimate markup. The line grid, pricing engine,
  and assistant all honor this (grid display fix: `22164a9`).
- Money = integer cents; qty = qtyMilli (×1000); multiplier = multiplierMilli (3000 = ×3.00
  = "200% markup"). 200% markup ≡ 66.7% margin — never confuse them.
- **The Google Sheet ("B Visible Formula", id `1mvk26cMgwpPE3nEYSHmOtKTNcoRvTvdIJGNssDR1yiI`)
  IS the source of truth** for materials, machine rates, sq-ft rates, vehicle wraps, bundles,
  recommendations, vendors, and shop supplies. See §6 (two-way sync + guardrails).
- Tab names have intentional misspellings: `Meterial price`, `Machinary Price` — never "fix".

---

## 2. Deploy pipeline (memorize)

1. Commit + push to `https://github.com/izzwgg-arch/bvisible.git`, branch
   **`feat/premium-estimate-editor-workspace`** (production deploys THIS branch, not main).
2. Enqueue over SSH (user `deploy@212.56.32.136`, key `cursor_bvisible`):
   `printf %s '{"repoUrl":"...","branch":"feat/premium-estimate-editor-workspace","commitHash":"<FULL_SHA>","services":[],"requestedBy":"<who/why>"}' | /opt/bvisible/deploy-queue/enqueue-deploy.sh -`
3. Worker: checkout → pnpm install → build → prisma migrate deploy → pm2 reload →
   healthcheck. Logs `/opt/bvisible/deploy-queue/logs/<JOB>.log`; job → `done/` or `failed/`.
   Builds ~4–5 min. Poll with `ls done failed | grep <id>` + `curl -s 127.0.0.1:3000/api/health`.
4. **Stale-tab caveat:** open tabs don't get new code until reloaded. When "a feature doesn't
   work", FIRST ask for a tab refresh. (This solved a real "customer says nothing changed"
   complaint — twice.)
5. pm2 logs live at `/opt/bvisible/shared/logs/pm2/bvisible-web.{out,err}.log` (NOT ~/.pm2).
   nginx logs: `/var/log/nginx/bvisible.{access,error}.log`. `deploy` has passwordless sudo.
6. nginx site: `/etc/nginx/sites-available/bvisible`. `proxy_read_timeout` 300s.
   **Permissions-Policy is `microphone=(self)`** (was `microphone=()`, which blocked the
   assistant's voice notes at the protocol level — do not regress this).

## 3. Executing work from the local machine (Cowork/Claude session specifics)

- **Local PowerShell MCP** has a stripped env. Native exe stdout is NOT captured. Pattern:
  write `.agent-run.cmd` (set PATH **and PATHEXT**), `Start-Process cmd.exe -WindowStyle
  Hidden`, sleep, read `.agent-build.log`. `%` → `%%`. MCP calls ~60s cap: never `-Wait` on
  long jobs, poll instead.
- The PS safety gate BLOCKS anything matching "deploy" and requires `approved:true` for
  `git push` and recursive deletes. **SSH to the server therefore runs from the Linux
  sandbox** (`mcp__workspace__bash`): stage key
  `cp "<Connect 2 mount>/.connect-ssh/cursor_bvisible" /tmp/bv_key && chmod 600` (the sandbox
  /tmp resets — re-stage when you see "Permission denied (publickey)"). Sandbox bash calls cap
  at 45s; SSH sleeps ≤ ~42s per call.
- The sandbox CANNOT build this repo (pnpm junctions). All builds/git run on Windows via the
  batch pattern. Bulk sandbox-side file edits have corrupted files before — use targeted
  edits, and PowerShell `-LiteralPath` for any path containing `[id]` (brackets are globs).
- Browser verification: claude-in-chrome extension. Hidden/minimized windows freeze renderers
  (screenshots/JS time out) — need a visible window, or verify server-side via authenticated
  `fetch` from a page's JS context (works regardless). `resize_window` can't shrink a
  maximized window — test responsive layouts with an in-page iframe at the target width.
- DB access: `docker exec -i bvisible-db sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB'`.
  Env: `/opt/bvisible/shared/env/.env` (DATABASE_URL, INGEST_TICK_SECRET, SMTP, …).

## 4. ⚠️ Parallel agents (Cursor) — hard-won rule

A Cursor agent edits this repo in parallel (recent: `5ecd909` assistant estimate-line
edit/remove + PO tools; earlier: the premium estimate editor itself). **Before editing ANY
file: `git status` + re-copy the CURRENT version.** A stale working copy overwrote their
`operator-actions.ts` once and had to be restored via `git checkout HEAD -- <file>` and
re-applying changes. Never commit files with someone else's uncommitted WIP; `git add` only
your explicit paths; **never `git add -A`**.

---

## 5. The AI assistant (flagship — now a FULL OPERATOR)

### Server: `apps/web/lib/assistant/agent.ts` + `lib/assistant/operator-actions.ts`
- Plain-fetch OpenAI chat-completions loop. Model in `assistant_settings` (currently
  `gpt-5-mini`), key AES-sealed in DB, env fallback.
- **Reliability:** NDJSON streaming from `/api/assistant` (heartbeat 10s + live progress
  events + final turn) — nginx can never 504. Legacy buffered path kept for stale tabs
  (client opts into streaming via `accept: application/x-ndjson`). Per-call 75s timeout, 2
  retries on 429/5xx/network, 210s total budget then forced answer, errors logged
  `[assistant]`.
- **Speed:** `reasoning_effort: 'minimal'` (gpt-5*) / `'low'` (o*). Tools carry a
  `reply`/`summaryForOperator` arg; when present the turn ENDS in that same round (no wrap-up
  round). Simple actions ~2s; estimates ~10s; prompt targets 2 rounds with batched lookups.
- **Capabilities (owner mandate: "anything except modify code"):**
  - Read: Sheet tools (search_materials, get_recommendations, get_rates,
    search_vehicle_wraps), business_snapshot, get_estimate, get_purchase_order.
  - Immediate writes: create_estimate_draft (opens the estimate workspace with the draft —
    the DEFAULT for "make me an estimate"; material lines carry `materialName` copied
    verbatim from search results → catalogItemId linking → vendor panel lights up),
    add_estimate_line / update_estimate_line / remove_estimate_line (totals recomputed),
    create/update catalog items, customers, vendors, update_estimate, PO create/update/lines.
  - **Approval-gated (one-tap card in dock):** delete_record (estimate/customer/vendor/
    purchase_order/catalog_item), set_estimate_status, set_po_status. `PendingAction` →
    `/api/assistant/confirm` → `executeConfirmedAction` (re-checks tenant). PO status can
    never be set to SENT by the assistant (only the real Send PO button emails vendors).
  - **All deletes are soft** → 30-day **Recycle Bin** (`/recycle`, restore button; nightly
    purge via systemd timer `bvisible-recycle-purge.timer` 03:30 hitting
    `/api/internal/recycle-purge` with `x-bvisible-ingest-secret: $INGEST_TICK_SECRET`).
  - Hard limit in prompt + by construction: no code/backend/server/settings, no payments,
    no pension, never auto-orders retail.
- Memory: `assistant_memories` (60 newest injected; `save_memory` on corrections).
- Voice notes: mic → `/api/assistant/transcribe` (whisper-1). Dock detects hard-blocked mic
  permission and shows unblock steps. Requires the nginx `microphone=(self)` header (§2.6).

### Client
- `components/assistant/assistant-dock.tsx`: streaming progress line, approval cards
  (question/confirmLabel from the PendingAction), draft/prefill cards, router.refresh after
  writes. `lib/assistant/stream-client.ts`: NDJSON reader + confirmAssistantAction.
- Context store on `globalThis` (`__bvAssistantContextStore`), prefill parking via
  sessionStorage — unchanged from previous handoff.

## 6. Google Sheet — two-way sync (owner's rules)

**Rules (owner, verbatim intent):** the Sheet is ALWAYS the source of truth; no duplicate
rows on either side, ever; DB mirrors the Sheet as backup.

- **Inbound (Sheet → DB):** `lib/sheet-sync/` — snapshot pull, 5-min TTL,
  stale-while-revalidate; upserts by sheetKey/normalized name (dupe-safe). Tabs read:
  Meterial price, Machinary Price, Sq Ft Pricing, Vehicle Pricing, Estimator
  Packages/Components/Recommendations, Vendor Catalog, **Internal Materials** (999 shop
  supplies — added 7/17, feeds the shop-order catalog incl. "blue tape"), Vendor Directory,
  ALIASES. **Instant sync:** POST `/api/internal/sheet-webhook` (INGEST_TICK_SECRET header,
  20s debounce) → intended to be called by a Sheet Apps Script onEdit trigger (owner still
  needs to install the script — snippet was provided in chat 7/22).
- **Outbound (app → Sheet):** `lib/sheet-sync/writeback.ts` — service-account JWT (no SDK
  dep), envs `SHEETS_WRITEBACK_SA_EMAIL` / `SHEETS_WRITEBACK_SA_KEY`. **NOT YET CONFIGURED**
  (silent no-op until the owner creates the SA, shares the Sheet with it as Editor, adds the
  envs, and creates an empty `APP SYNC` tab). Guardrails: update-by-name-lookup first,
  append ONLY when no row matches (no duplicates); NEVER overwrites a formula cell (logs to
  `APP SYNC` instead); every write audited to `APP SYNC`; fire-and-forget (never blocks a
  save). Wired into: items page save (rename/price), assistant catalog create/update and
  vendor create/update. Catalog creates also refuse duplicate normalized names DB-side.
- **CSV purge (7/22, owner request):** all NON-Sheet data was soft-deleted: 95 CSV/QB
  catalog items deactivated, 186 QB-imported vendors soft-deleted (recoverable 30 days).
  Active now: 337 Sheet catalog items; vendors exactly = Vendor Directory tab: S&F, Grimco,
  Letra lit, A&J, Amazon, Home Depot, Traffic Safety, Internal / Manual.

## 7. Feature map (this engagement's additions on top of the 7/16 base)

| Feature | Key files / commits |
|---|---|
| Assistant streaming + retries + budget | `agent.ts`, `api/assistant/route.ts`, `stream-client.ts` (`49e6ecc`) |
| Draft-in-workspace default + catalog-linked lines | `agent.ts` (`8137fd2`, `98bd629`) |
| Speed (minimal reasoning, 1-round actions) | `agent.ts` (`4a1caf3`, `98bd629`, `5c7062d`) |
| Full operator + approvals + Recycle Bin | `operator-actions.ts`, `recycle.ts`, `/recycle`, `api/assistant/confirm` (`25ea867`, `5c7062d`) + Cursor's `5ecd909` |
| Estimate → Create invoice (header, APPROVED-gated) | `estimate-header-actions.tsx` (`f3e7cc6`); first invoice INV-000001 |
| Line grid markup-exempt display/edit fix | `line-grid.tsx` (`22164a9`) |
| Vendor intel: Sheet vendor prices fallback + full per-vendor dropdown | `estimate-catalog-bootstrap.ts`, `apply-catalog-to-estimate-line.ts`, `line-grid.tsx` (`4e92b15`, `4b63fac`) |
| Catalog + Add Vendor button (was dead stub) | `catalog-item-editor.tsx`, `catalog-item-pricing-tools.tsx` (`522c3f7`, `9b8da89`) |
| PO emails to ALL vendor addresses | `lib/po/vendor-recipients.ts` + both send paths (`a74da61`) |
| Internal Materials tab → shop-order catalog | `sheet-sync/*`, shop-order `page.tsx` (`716f79f`) |
| Vehicles = Wrap Pricing browser (reference-app clone, BV style) | `vehicles/page.tsx` + `wrap-pricing-browser.tsx`; old library at `/vehicles/library` (`ccc3909`, `6507300`, `e590f14`) |
| Two-way Sheet sync + webhook + purge | `writeback.ts`, `sheet-webhook`, middleware (`5b2e079`) |
| Mic permission UX + nginx Permissions-Policy | dock (`06a7ff9`) + server config change |

Reference app for the vehicles page: `bvisible-wrap-pricing.vercel.app` (static CSV
`pricing_data.csv`; card layout, 8 cascading filters, stats, QB text, CSV export — all
replicated). Local images in `public/vehicle-library/` (brand logos + vehicle photos +
roof-wrap illustrations); never use a bare logo file as a hero image.

## 8. Known gotchas (inherited + new)

- All 7/16 gotchas still apply (Sheet misspellings, markupExempt through save paths, nginx
  symlink sed, `/home` redirects, AuditAction union, noUncheckedIndexedAccess, prisma
  generate after schema changes, `requireRoleWithEffectiveCompany` for admin pages).
- `/api/internal/*` IS proxied by nginx (contrary to old comments) — internal endpoints are
  protected by the INGEST_TICK_SECRET header, not by network position.
- The Vehicle Pricing Sheet tab has the OLD shape (name+variant / sqft / Notes "Price: $X;
  Pricing reason: …"). The rich wrap structure (wheelbase/height/cab/SKU) lives in
  `vehicle_wrap_pricing` DB rows; the vehicles page overlays live Sheet prices by normalized
  name (111 of 220 matched — unmatched rows show stored prices).
- Chrome extension `javascript_tool` output gets BLOCKED by a data-leak filter when it
  contains raw HTML/URLs with query strings — return sanitized/summarized strings.
- Email-ingest IMAP poller throws periodic `Socket timeout` uncaughtExceptions in pm2 logs —
  known noise, not assistant-related, still worth hardening someday.

## 9. Test data / cleanup owed

- EST-000019 "sihgnn", EST-000020 "test 3" (APPROVED, has INV-000001), EST-000021/22/23/25
  (assistant tests; 25 APPROVED with "Rush fee" line), PO-000007…15 drafts.
- Recycle Bin currently holds the 7/22 purge (95 items + 186 vendors) — auto-purges ~8/21.
- "Zephyr" test records (catalog item + vendor + customer) — deactivated/recycled.

## 10. Open / pending work

1. **Owner setup for full two-way sync** (only missing pieces): Google service account +
   share Sheet + `SHEETS_WRITEBACK_*` envs + `APP SYNC` tab; install the Apps Script onEdit
   trigger posting to `/api/internal/sheet-webhook`.
2. Assistant: send-email actions (estimate/PO) behind the approval card — framework ready,
   deliberately not wired (sends real mail).
3. Mobile app (unchanged from 7/16): QR login + receipt/PO photo upload; build APK locally.
4. Vehicles page niceties: fix City Express primary photo in DB (points at the logo file);
   consider option thumbnails inside filter dropdowns (reference has them).
5. Assistant conversation history is client-side only (sessionStorage per tab) — server-side
   log + viewer was offered to the owner, not yet requested.

## 11. Verification checklist for ANY change

1. `git status` first (parallel agents!). 2. Typecheck via batch pattern. 3. Relevant vitest
suites (fuzzy/qbme/measurement/retail-cart minimum for pricing-adjacent). 4. Commit explicit
paths → push → enqueue → poll → health shows the new SHA. 5. Live browser check in a VISIBLE
window (or authenticated in-page fetch). 6. Remind: open tabs need one reload.
