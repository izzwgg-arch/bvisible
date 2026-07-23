# AGENT HANDOFF — AI Assistant write tools (PO + Estimate CRUD, lookups, hardening)

Last updated: 2026-07-23 · Covers work from 2026-07-20 → 2026-07-22
Deployed & LIVE at commit **`ba9dbda`** on branch **`feat/premium-estimate-editor-workspace`**.
Confirm the live commit any time: `GET /api/health` → `{"status":"ok","service":"bvisible-web","commit":"<sha>"}`.

This document is the handoff for the AI business assistant's **write / action surface** — the
tools that let the assistant create, open, view, edit, and delete Purchase Orders, Estimates,
catalog items, customers, and vendors. It records what was built over this engagement, how it was
hardened, and the operational lessons (deploy flow + a parallel-edit clobber) learned along the
way. Read it alongside `AGENT_HANDOFF.md` §6 (assistant overview), `PO_SYSTEM.md`,
`ESTIMATE_ENGINE.md`, `KNOWN_RULES.md`, and `DEPLOY_QUEUE.md`.

The owner's north star for this work (verbatim): *"He should be able to create, open, view, edit,
all POs. Should be able to create, view, open, edit, all estimates … If I give him a PO number, he
should open the estimate/PO for me right away. Make sure they all work end to end."*

---

## 1. What shipped, in three phases

### Phase A — Full PO + Estimate lookup & CRUD  (`f35eacf`, `8d87ed7`)
Give the assistant a PO or estimate number and it opens the record on the operator's screen and
describes it. Five new tools:
`get_purchase_order`, `get_estimate`, `update_purchase_order`, `add_purchase_order_line`,
`set_purchase_order_status`. `8d87ed7` fixed two `noUncheckedIndexedAccess` strict-mode errors
(`candidates[0]` is `T | undefined` even after a `.length === 1` check — narrow through a local
`const`, don't re-index).

### Phase B — Estimate line editing  (`5ecd909`)
- `update_estimate_line` — change one line's quantity, rate (`unitCostCents`), description, kind, or
  markup-exempt flag.
- `remove_estimate_line` — delete one line, renumber the rest.
- Both recompute the estimate's cached `subtotalCostCents` + `finalPriceCents` through the shared
  pricing engine (`computeEstimate` from `@bvisible/pricing`), honoring **R-EST-05** (markup-exempt
  lines carry a FINAL price and are never multiplied by the estimate markup again).
- Fixed a latent bug: `add_estimate_line` created the line but never refreshed the cached total, so
  the estimate showed a stale number until the editor was opened and saved. It now calls the same
  `recomputeEstimateTotals` helper.
- `get_estimate` now returns a 1-based `line` number and the `markupExempt` flag per line so the
  model can target the right line.
- Real correction applied and verified end-to-end on **EST-000037**: line 7 (ground installation)
  → markup-exempt at 6 h × $150 = **$900** final; line 9 ("Installation markup correction", a dead
  $0 line) removed. Total **$4,483.77 → $2,683.77 (−$1,800.00)**, confirmed in the DB.

### Phase C — Write-tool hardening  (`ca2ff51` [never deployed], merged into `ba9dbda` [LIVE])
The owner reported "add an item to a PO / catalog didn't work." Root cause: the tools worked on the
happy path, but edge cases **threw** and the agent loop **swallowed** the error into a vague
"it didn't work" with nothing logged. Fixes:
- **Lenient reference resolution** — two shared resolvers, `resolvePurchaseOrderRef` and
  `resolveEstimateRef`, now back **every** by-number write tool. They match exact id/number, then a
  zero-padded `PO-000022`/`EST-000021` from bare digits, then a unique `endsWith`-digits match — so
  "22", "PO 22", "#22", or the full number all resolve, exactly like the lookups do. Previously the
  write tools did an EXACT match only, so "PO 22" found nothing.
- **Duplicate catalog handling** — `create_catalog_item` checks for an existing item first and
  returns *"…already in the catalog. Use update_catalog_item…"* instead of throwing on the
  `@@unique([tenantId, nameNormalized])` constraint (the Google Sheet seeds hundreds of items, so
  collisions are common). A `P2002` try/catch backstop covers the check-then-insert race.
- **Never-silent failures** — the agent loop's tool-call `catch` now `console.error`s the failure
  (so it shows up in the PM2 logs and is diagnosable) and returns a friendly message. A
  `friendlyToolError` helper maps Prisma `P2002`/`P2003`/`P2025` to human text; everything else gets
  a short generic line. No stack traces or SQL ever reach the operator.

> ⚠️ **`ca2ff51` was based on an older revision and clobbered the parallel two-way-Sheet-sync work
> in `5b2e079`.** It was caught before it mattered and reconciled in `ba9dbda`. Because `ca2ff51`
> never deployed (production stayed on `5b2e079` the whole time), there was **zero production
> impact**. Full story in §6 — read it before you push.

---

## 2. The assistant's full tool surface (27 tools)

All tools are whitelisted in `TOOL_DEFS` and tenant-scoped. Behaviour categories:

| Category | Tools |
|---|---|
| **Look up / open** (read-only; opens the record on screen) | `get_purchase_order`, `get_estimate`, `search_materials`, `get_recommendations`, `get_rates`, `search_vehicle_wraps`, `business_snapshot` |
| **Create** (writes immediately) | `create_purchase_order` (draft; never emails), `create_estimate_draft`, `create_customer`, `create_vendor`, `create_catalog_item` |
| **Edit / append** (writes immediately) | `update_purchase_order`, `add_purchase_order_line`, `update_estimate`, `add_estimate_line`, `update_estimate_line`, `remove_estimate_line`, `update_customer`, `update_vendor`, `update_catalog_item` |
| **Approval-gated** (operator taps Approve first) | `set_purchase_order_status` (DRAFT/ORDERED/PARTIALLY_RECEIVED/RECEIVED/CANCELED — never SENT), `set_estimate_status` (DRAFT/SENT/APPROVED/REJECTED), `delete_record` (soft delete → Recycle Bin, 30-day recover) |
| **Fill the screen, don't save** (operator clicks to commit) | `propose_estimate_lines`, `prefill_estimate` |
| **Memory** | `save_memory` |

Hard guardrails (owner's rules — do NOT loosen): the assistant can only touch this tenant's data;
it can never send, email, finalize, or change code/server/settings; sending a PO or estimate and
finalizing are always operator actions; status changes and deletes pause for a one-tap approval.

---

## 3. Key files

| File | Role |
|---|---|
| `apps/web/lib/assistant/agent.ts` | OpenAI tool-calling loop, `SYSTEM_PROMPT`, `TOOL_DEFS`, `runTool` dispatch, `IMMEDIATE_ACTION_TOOLS`, per-turn capture of `created/opened Estimate/PurchaseOrder`, `friendlyToolError`, the tool-call `try/catch` (now logs). |
| `apps/web/lib/assistant/operator-actions.ts` | Every DB-reading/writing tool implementation; `resolvePurchaseOrderRef` / `resolveEstimateRef` / `padNumberDigits` / `locateLine` / `recomputeEstimateTotals`; the two-way Sheet write-back calls (`writeback*` from `@/lib/sheet-sync/writeback`). |
| `apps/web/lib/assistant/stream-client.ts` | NDJSON stream client + `AssistantTurnPayload` shape + `TOOL_LABELS` progress chips. |
| `apps/web/components/assistant/assistant-dock.tsx` | Floating ✦ dock (every page). Navigates on `created/opened` records; `WRITE_TOOLS` set triggers `router.refresh()` after a write. |
| `apps/web/app/(app)/assistant/assistant-chat.tsx` | Full-page `/assistant` chat. Same navigation on `created/opened` records. |
| `apps/web/app/api/assistant/route.ts` | `POST /api/assistant` — spreads the full turn object, so new turn fields flow through automatically (no change needed when adding a field). |
| `apps/web/app/api/assistant/confirm/route.ts` | Executes approval-gated actions (`delete`, `set_estimate_status`, `set_po_status`). |
| `apps/web/app/(app)/estimates/[id]/actions.ts` | `saveEstimateAction` — the canonical estimate save; the assistant's line tools mirror its `computeEstimate` usage so cached totals match byte-for-byte. |
| `packages/pricing/src/estimate.ts` | `computeEstimate` — single source of truth for `subtotalCostCents` + `finalPriceCents` (R-EST-01 / R-EST-05). |

---

## 4. Architecture notes for future write tools

- **Reference resolution:** never do a bare exact-match `findFirst` on a number the operator typed.
  Use `resolvePurchaseOrderRef(tenantId, ref)` / `resolveEstimateRef(tenantId, ref)`. They return
  the record's key fields or `{ error }` (including a short ambiguity list when a partial number
  matches several). They are **number-based only** (never fuzzy vendor/title) so a *write* never
  lands on the wrong record — fuzzy title/vendor matching stays in the read-only `get_*` lookups.
- **Pricing recompute:** after any estimate line change, call
  `recomputeEstimateTotals(client, tenantId, estimateId)` inside the same `prisma.$transaction`. It
  reloads the lines and runs `computeEstimate` with the estimate's `multiplierMilli` +
  `designFlatCents`, then writes `subtotalCostCents` + `finalPriceCents`. Do NOT hand-roll the money
  math — R-EST-05 (markup-exempt = final price, never re-marked-up) lives in `computeEstimate`.
- **Immediate vs approval-gated:** reversible writes (drafts, line edits, field edits) run
  immediately and may carry a `reply` string that ends the turn in ~2s (`IMMEDIATE_ACTION_TOOLS`).
  Meaningful/irreversible-feeling actions (status changes, deletes) return a `__pendingAction` and
  are executed only after the operator taps Approve via `/api/assistant/confirm`.
- **Duplicate / constraint handling:** for any create against a unique constraint, pre-check and
  return a friendly message, and keep a `P2002` try/catch backstop for races. Broaden the pre-check
  to match the actual constraint (e.g. catalog uniqueness is on `nameNormalized` regardless of
  `isActive`).
- **Never swallow errors:** the loop already wraps `runTool` in try/catch. Keep the `console.error`
  there — a swallowed-and-unlogged throw is exactly why the "can't add an item" bug was invisible.
- **New turn fields** (e.g. `openedEstimate`) must be threaded through every `return` in
  `runAssistant`, added to `AssistantTurnPayload` in `stream-client.ts`, and handled in both the
  dock and the full-page chat. The API route spreads the turn, so no route change is needed.
- **`AuditAction` union** (`apps/web/lib/auth/audit.ts`) must contain any new `action` string you
  log — otherwise `writeAuditLog` won't type-check.

---

## 5. Commit lineage (this engagement)

```
ba9dbda  Assistant: restore two-way Sheet write-back clobbered in ca2ff51   ← LIVE (HEAD)
ca2ff51  Assistant: harden write tools - lenient refs, dup handling, error logging   (NEVER deployed)
5b2e079  Two-way Sheet sync … + anti-duplicate guard on catalog creates     (owner/parallel)
5ecd909  Assistant: edit and remove individual estimate lines
e590f14 / 6507300 / ccc3909  Wrap Pricing browser + visuals                  (owner/parallel)
8d87ed7  Assistant: fix strict-mode TS errors in PO/estimate lookup
f35eacf  Assistant: full lookup/open/edit for POs and estimates by number
7b176c7  Assistant: add create_purchase_order tool so it can order materials
52251af  Switch assistant default model to gpt-5.6-sol; fix reasoning_effort for gpt-5.x
```

---

## 6. War story: the parallel-edit clobber (READ THIS before you push)

The owner (and a Cursor agent) edit this repo **in parallel**. Twice this session the branch tip
moved between "read the file" and "push":

1. `5ecd909` landed cleanly on top of the wrap-pricing commits — a `git diff --stat <base>..<tip>`
   confirmed those commits touched only `vehicles/*`, not the assistant files. No clobber.
2. `ca2ff51` did **not** get that check applied early enough. It was authored against `5ecd909`'s
   `operator-actions.ts`, but the tip had advanced to `5b2e079`, which had added a two-way Sheet
   write-back to the **same file** (`writeback*` calls in `createCatalogItem`, `createVendor`,
   `updateVendor`, `updateCatalogItem`). Pushing `ca2ff51` reverted those 33 lines.

How it was caught and fixed: the push output showed `5b2e079..ca2ff51` (not the expected base), a
`git diff --stat 5ecd909 5b2e079 -- <the two files>` showed `operator-actions.ts` had changed
upstream, and `git diff 5ecd909 5b2e079 -- operator-actions.ts` revealed the exact write-back
additions. Those were re-applied on top of the hardening in `ba9dbda`, typecheck-verified, and the
duplicate-guard overlap reconciled (kept the broader `nameNormalized` check + the P2002 backstop +
the Sheet write-back call). `ca2ff51` never reached production.

**Rule (reinforces `KNOWN_RULES` R-DEP + `AGENT_HANDOFF` §7):** before editing, note the branch tip;
before pushing, if the tip moved, run `git diff --stat <your-base>..<new-tip> -- <files you edited>`
and reconcile anything that overlaps. Never assume your base is current.

---

## 7. Deploy notes that actually matter

- Deploy is the standard `DEPLOY_QUEUE.md` flow: push first, then enqueue a job with an **exact
  `commitHash`** (branch tips are rejected). Enqueue over SSH (`deploy@212.56.32.136`, key
  `~/.ssh/cursor_bvisible`) via `/opt/bvisible/deploy-queue/enqueue-deploy.sh`; the systemd worker
  builds → `prisma migrate deploy` → PM2 reload → healthcheck, then routes the job to `done/` or
  `failed/`. Watch with `bvisible-status` / `tail -f …/logs/<JOB_ID>.log`.
- The healthcheck endpoint returns the deployed commit, so `curl -s http://127.0.0.1:3000/api/health`
  is the fastest "what's actually live?" check. During a build the previous-good PM2 process keeps
  serving; the health `commit` flips only after the new process passes the healthcheck.
- Builds are ~4–5 min. `pnpm run build` runs `prisma generate` then `next build` (standalone). Run
  `pnpm --filter @bvisible/web typecheck` before every deploy — it has caught real bugs here more
  than once (the strict-mode `candidates[0]` errors, for one).
- Already-open shop tabs won't have new code until reloaded — tell the owner to refresh before
  reporting a new feature "not working."

---

## 8. Verification performed (live, against production)

- **Lookups:** owner confirmed "give it a number → it opens the right PO/estimate."
- **Estimate line edit/remove:** drove the live assistant to correct EST-000037; DB confirmed line 7
  now `markupExempt=true` (cost $900), line 9 gone, `finalPriceCents` 448377 → 268377 (−$1,800.00).
- **Hardening (post-`ba9dbda`):** live assistant returned *"…already in the catalog. No duplicate was
  added."* for a duplicate `create_catalog_item`, and *"Added 1 mounting bracket at $7.50 each to
  PO-000022."* for a loose `"PO 22"` reference (proving the lenient resolver). Test data created
  during verification (a test catalog item + two test PO lines) was removed and PO-000022's subtotal
  recomputed back to its real value.

---

## 9. Open / follow-up items

1. **`remove_purchase_order_line` / `update_purchase_order_line`** — PO lines still can't be edited
   or removed by the assistant (only added). This is the exact parity gap that estimate lines had
   before Phase B; build it the same way (lenient `resolvePurchaseOrderRef`, atomic `$transaction`,
   recompute `subtotalCents` via decrement or re-sum, `POEvent` + audit).
2. **`prepareDelete`** still resolves the target with an exact match per entity type; unify it with
   the lenient resolvers so "delete PO 22" works like everything else.
3. **Two-way Sheet write-back** (`@/lib/sheet-sync/writeback`, owner's `5b2e079`) now fires on
   assistant catalog/vendor create + edit. It's fire-and-forget (`void`); if Sheet writes ever need
   to be observable/retryable, that's a future change. Confirm it behaves as intended in practice.
4. **Assistant reading local files / expanded observation** — owner interest noted in prior handoff;
   still not implemented; needs explicit design + consent (see `AGENT_HANDOFF.md` §6).
