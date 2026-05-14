# CHANGELOG_AI — B Visible

A running log of AI-driven changes to the codebase. Newest first. Each entry
records what changed, the files touched, the risks, and the verification.

---

## 2026-05-13 — Purchase order foundation (Phase 7)

**Commit:** _to be filled in by the commit step_ (`feat: add purchase order foundation`).
**Migration:** `20260513234614_purchase_orders_and_finalize`.
**Deploy:** _to be filled in_.

**Scope**

The operational handoff layer between Estimate → Purchase Order →
Vendor execution. Adds vendors (minimal), purchase orders (full editor
+ status/timeline/attachments/QBO number), the "Create PO from estimate"
flow that copies estimate lines into PO lines without mutating the
source estimate, and the R-EST-04 Finalize gate (an estimate cannot
move to `FINALIZED` unless at least one linked, non-deleted PO carries
a `qboPoNumber`). All money + quantities follow the Phase 6 integer-cent
/ milli-quantity convention; per-tenant `PO-NNNNNN` numbers are issued
under a Postgres advisory lock that's been refactored into the shared
`acquireTenantSequenceLock(tx, tenantId, kind)` helper (estimate
numbering reuses it). Attachments are stored under
`/opt/bvisible/shared/uploads/<tenantId>/po/<poId>/<storageKey>` with
server-side magic-byte MIME validation on both upload AND download,
randomised filenames, path-traversal protection, a 25 MB cap, and a
tenant-gated route handler that re-detects the MIME from disk before
streaming.

Did NOT add: vendor email ingestion, OCR / invoice parsing, vendor AI /
recommendations, accounting sync, mobile receipt uploads, approval
workflow complexity, or any background queues / workers.

**What changed (repo)**

Schema (`packages/db`):

- `prisma/schema.prisma` — adds enums `POStatus`
  (`DRAFT/SENT/ORDERED/PARTIALLY_RECEIVED/RECEIVED/CANCELED`),
  `POLineKind` (mirror of `EstimateLineKind`), `POAttachmentKind`
  (`RECEIPT/INVOICE/VENDOR_DOC/DRAWING/OTHER`), and `POEventKind` (10
  values: `CREATED`, `CREATED_FROM_ESTIMATE`, `LINES_SAVED`,
  `STATUS_CHANGED`, `QBO_NUMBER_ASSIGNED`, `VENDOR_ASSIGNED`,
  `ATTACHMENT_ADDED`, `ATTACHMENT_DELETED`, `NOTE_ADDED`, `CANCELED`).
  Adds `EstimateStatus.FINALIZED`. Adds models `Vendor`,
  `PurchaseOrder`, `POLineItem`, `POAttachment`, `POEvent` — all
  tenant-scoped with composite `(tenantId, …)` indexes; money in `Int`
  cents; quantities in `qtyMilli`; soft delete via `deletedAt` on
  `Vendor` and `PurchaseOrder`; unique on `(tenantId, name)` for
  vendors and `(tenantId, number)` for POs.
- `src/index.ts` — re-exports the new enums and model types.
- `prisma/migrations/20260513234614_purchase_orders_and_finalize/migration.sql`
  generated against a shadow Postgres on the server (Prisma's
  transactional `ALTER TYPE ADD VALUE` works on Postgres 16, so the
  `FINALIZED` value lands cleanly in the same migration).

Web app (`apps/web`):

- `lib/sequence/lock.ts` (new) — generic
  `acquireTenantSequenceLock(tx, tenantId, kind)` advisory-lock helper.
  Estimate numbering refactored to use it.
- `lib/po/number.ts` (new) — `nextPoNumber(tx, tenantId)`; allocates
  `PO-NNNNNN` per tenant, concurrency-safe via the lock helper.
- `lib/po/uploads.ts` (new) — storage path resolution, randomised
  `storageKey` generation, magic-byte MIME detection (PDF / JPEG / PNG
  / WEBP), path-traversal-safe `resolveAttachmentPath`, and a 25 MB
  upper bound.
- `lib/auth/audit.ts` — extends `AuditAction` with `vendor_created`,
  `po_created`, `po_created_from_estimate`, `po_saved`,
  `po_status_changed`, `po_qbo_number_set`, `po_vendor_set`,
  `po_attachment_added`, `po_attachment_deleted`, `po_note_added`,
  `po_deleted`, `estimate_finalized`, `estimate_unfinalized`.
- `lib/validators.ts` — adds `createVendorSchema`,
  `createPurchaseOrderSchema`, `createPoFromEstimateSchema`,
  `poLineSchema`, `savePurchaseOrderSchema`, `updatePoStatusSchema`,
  `setPoQboNumberSchema` (regex-validated), `setPoVendorSchema`,
  `addPoNoteSchema`, `uploadAttachmentMetaSchema`,
  `deleteAttachmentSchema`, `finalizeEstimateSchema`. Replaces
  `optional()` with `nullish()` on shared helpers (`longText`,
  `optionalEmail`, `optionalShort`, `nullableIdRef`) so empty form
  values consistently transform to `null`. Removes the `.refine()`
  from `updateEstimateStatusSchema` so the action body owns the
  FINALIZED-rejection rule (keeps the inferred type wide enough for
  the editor to call it with any `EstimateStatus`).
- `next.config.mjs` — `experimental.serverActions.bodySizeLimit:
  '25mb'` to match the attachment cap.
- `components/app-shell.tsx` — adds `Purchase orders` and `Vendors`
  to `BASE_NAV`.
- `app/(app)/vendors/page.tsx`, `vendors/actions.ts`,
  `vendors/new/page.tsx`, `vendors/new/vendor-form.tsx` — vendor
  list + create.
- `app/(app)/purchase-orders/page.tsx`,
  `purchase-orders/actions.ts`, `purchase-orders/new/page.tsx`,
  `purchase-orders/new/new-po-form.tsx` — PO list + new-PO + the two
  creation actions (`createBlankPoAction`,
  `createPoFromEstimateAction`).
- `app/(app)/purchase-orders/[id]/page.tsx`, `editor.tsx`,
  `line-grid.tsx`, `meta-panel.tsx`, `timeline-panel.tsx`,
  `attachments-panel.tsx`, `actions.ts` — full PO detail editor.
  Reuses the shared `<CellInput>` / `<NumericCell>` cell primitives
  and the `makeGridKeyHandler` keyboard helper from the estimate
  editor (no new keyboard logic). Server actions:
  `savePurchaseOrderAction`, `updatePoStatusAction`,
  `setPoQboNumberAction`, `setPoVendorAction`, `addPoNoteAction`,
  `uploadPoAttachmentAction`, `deletePoAttachmentAction`,
  `deletePurchaseOrderAction`.
- `app/api/po/[id]/attachments/[attachmentId]/route.ts` (new) —
  tenant-gated download; re-detects MIME from disk before streaming;
  emits `Content-Disposition: attachment` with RFC 5987 encoding +
  `X-Content-Type-Options: nosniff`.
- `app/(app)/estimates/[id]/actions.ts` — adds `finalizeEstimateAction`
  (R-EST-04 gate, returns typed errors `not_found`,
  `already_finalized`, `no_linked_po`, `no_qbo_number`, `invalid`)
  and `unfinalizeEstimateAction` (ADMIN+ only).
  `updateEstimateStatusAction` now refuses `FINALIZED` directly and
  refuses any change while the estimate is already FINALIZED.
- `app/(app)/estimates/[id]/page.tsx` — bootstraps `linkedPos` +
  `vendors` for the editor.
- `app/(app)/estimates/[id]/editor.tsx` and `totals-panel.tsx` —
  surface "Linked POs", "Create PO from estimate" (with optional
  vendor pick), and Finalize / Unfinalize controls. Finalize button
  is disabled with a sanitized reason hint when R-EST-04 isn't yet
  satisfied. The status-change buttons are disabled while the
  estimate is FINALIZED.

Documentation:

- `docs/ai-context/PO_SYSTEM.md` — rewritten to reflect the shipped
  foundation vs the still-deferred items.
- `docs/ai-context/DATA_MODEL.md` — adds the Phase 7 enums + models +
  migration row.
- `docs/ai-context/API_STRUCTURE.md` — adds the new actions, the
  attachment download REST route, and the PO/vendor pages.
- `docs/ai-context/UI_SYSTEM.md` — adds the PO editor / vendor list
  UX notes.
- `docs/ai-context/AUTH_AND_PERMISSIONS.md` — adds the per-action
  role table for Phase 7 and the new page entries.
- `docs/ai-context/KNOWN_RULES.md` — re-anchors R-EST-04, adds
  R-PO-01 / R-PO-04 / R-PO-05.
- `docs/ai-context/SECURITY_RULES.md` — adds the "Attachment posture"
  section as the canonical pattern for every future upload.
- `docs/ai-context/DEBUGGING.md` — adds § 11d "Purchase orders /
  vendors / attachments" runbook.
- `docs/ai-context/ENVIRONMENT_VARIABLES.md` — clarifies `UPLOAD_ROOT`
  layout for PO attachments (no new keys).
- `docs/ai-context/DEPLOYMENT.md` — notes the 25 MB nginx /
  serverActions alignment and confirms the existing
  `/opt/bvisible/shared/uploads` symlink covers PO attachments
  unchanged.

**Risks**

- **Soft-delete semantics are unilateral**. `deletePurchaseOrderAction`
  sets `deletedAt`. There is no UI to undelete; recovery requires a
  manual `UPDATE` against the DB. ADMIN+ only — USER cannot trigger
  this.
- **Attachments are not garbage-collected** on PO soft delete. The
  on-disk files remain under `/opt/bvisible/shared/uploads/...`. This
  is intentional for now (recoverability) but adds disk-pressure risk
  if many POs are created and deleted at scale. Pruning is a future
  maintenance script.
- **MIME allowlist is small** (PDF / JPEG / PNG / WEBP). Receipts that
  arrive as HEIC, TIFF, or DOCX will be rejected. Adding more types
  means extending the magic-byte table in `apps/web/lib/po/uploads.ts`
  AND adjusting the `accept` filter on the upload input AND
  documenting it here.
- **`createPoFromEstimateAction` snapshots line costs at the time of
  conversion**. Subsequent edits to the source estimate do NOT
  propagate to already-converted POs. This is the spec'd behaviour
  ("don't mutate the original estimate" + "operational PO is the
  source of truth for purchasing") but it can confuse users who edit
  an estimate after creating a PO.
- **R-EST-04 is one-way at the UI level**. Finalize unlocks once any
  linked PO has a QBO number, but if the user later clears the QBO
  number on that PO the estimate remains FINALIZED (unfinalize is an
  explicit ADMIN+ action). This is intentional — finalize is a
  business commitment, not a live derived state — but worth knowing
  for support questions.
- **Per-tenant PO numbering depends on the advisory lock + unique
  index**. Both must remain in place. Dropping
  `purchase_orders_tenantId_number_key` would silently allow
  collisions even though the lock is held during allocation
  (concurrent transactions in DIFFERENT tenants don't contend).

**Verification performed**

Local:

- `pnpm install --frozen-lockfile` — clean.
- `pnpm --filter @bvisible/db generate` — Prisma client regenerated
  with the new models / enums.
- `pnpm run build` — full monorepo build passes (Next standalone
  build included). No new TypeScript errors after the validator
  refactor.
- Shadow-Postgres migration generation on the server produces a
  single `20260513234614_purchase_orders_and_finalize` migration that
  includes `ALTER TYPE "EstimateStatus" ADD VALUE 'FINALIZED'` plus
  the five new tables. Copied back into the repo.

Functional (planned for the deploy / verify step):

- Create vendor → list / detail.
- Create blank PO → editor renders → save → reload preserves lines +
  notes + cached subtotal.
- Create PO from estimate → estimate is unchanged, PO carries the
  copied lines, PO timeline shows `CREATED_FROM_ESTIMATE`.
- Set QBO number on the PO → audit + timeline events appear; the
  source estimate's Finalize button unlocks.
- Finalize the estimate → status flips to FINALIZED; further status
  changes are refused by `updateEstimateStatusAction` until ADMIN+
  unfinalizes.
- Upload PDF / PNG / JPEG / WEBP attachments — each appears in the
  attachments list with the correct re-detected MIME on download.
- Upload a `.txt` renamed to `.pdf` → rejected at upload time
  (magic-byte sniff).
- Cross-tenant access: estimate / PO / attachment ids from another
  tenant return 404 from every action and from the download route.
- Auth, mailer, and `/api/health` continue to behave (no changes to
  those code paths).

---

## 2026-05-13 — Estimate foundation (Phase 6)

**Commit:** `de568ed` (`feat: add estimate foundation`).
**Migration:** `20260513221527_estimates_clients_machines`.
**Deploy:** `20260513T223220-996cb1` → `done`. Migration applied,
`db-verify.sh` OK, PM2 reload OK, healthcheck OK.

**Scope**

The first product surface for the platform: clients, estimates, line
items, a centralized pricing engine, a spreadsheet-style editor with
keyboard navigation, and an admin-style estimate list. All formulas
from `ESTIMATE_ENGINE.md` are implemented in a new pure-TypeScript
package `@bvisible/pricing` and called from both the editor (every
keystroke) and the save action (server-side, inside the same Prisma
transaction that writes line items). Tenant isolation is enforced on
every query. Money is integer cents end-to-end; quantities are
integer milli-units (`qtyMilli = qty × 1000`); the multiplier is an
integer milli-multiplier (`multiplierMilli`). The editor never floats.

Did NOT add: purchase orders, vendor email ingestion, channel-letter
calculator, banner-calculator UI, drag-and-drop reorder, snapshot /
revision model, accounting exports, approvals/workflows, AI quoting,
or notifications.

**What changed (repo)**

Schema (`packages/db`):

- `prisma/schema.prisma` — adds enums `EstimateStatus`
  (`DRAFT/SENT/APPROVED/REJECTED`) and `EstimateLineKind`
  (`MATERIAL/MACHINE/LABOR/DESIGN/INSTALL/MISC`); adds models
  `Client`, `Machine`, `Estimate`, `EstimateLineItem`; adds reverse
  relations on `Tenant` and `User`. Per the Phase 6 spec, every
  product table carries a non-nullable `tenantId` and a composite
  index `(tenantId, …)` on every commonly queried column. Money is
  `Int` cents; quantity is `qtyMilli` `Int`. `Estimate` has a unique
  `(tenantId, number)` and cached `subtotalCostCents` /
  `finalPriceCents` columns.
- `src/index.ts` — re-export the new enums and types
  (`Client`, `Machine`, `Estimate`, `EstimateLineItem`,
  `EstimateStatus`, `EstimateLineKind`).
- `prisma/migrations/20260513221527_estimates_clients_machines/migration.sql`
  — generated against shadow Postgres on the server with
  `server-scripts/db/.shadow-migrate.sh`. Pure DDL: 2 enums, 4 tables,
  10 indexes, 7 foreign keys. No partial-index hand-edits required.

New workspace package (`@bvisible/pricing`):

- `packages/pricing/package.json`, `tsconfig.json`, `src/index.ts` —
  zero-runtime-deps TypeScript-only package, included via pnpm
  workspace.
- `src/types.ts` — `LineKind`, `LineInput`, `EstimateInput`,
  `EstimateOutput`, `BreakdownByKind`. Pure shapes, no Prisma imports.
- `src/money.ts` — `roundCents`, `formatMoney`, `parseMoney`. Money is
  integer cents; the parser accepts `12`, `12.50`, `$12.50`, `1,234.56`.
- `src/qty.ts` — `qtyToMilli`, `qtyFromMilli`, `formatQty`, `parseQty`.
- `src/sqft.ts` — R-EST-02 (`sqft = w_in × h_in / 144`).
- `src/banner.ts` — R-EST-03 (banner pricing with $4/sf base, $3/sf
  over 200, $0.50/grommet, $45 minimum) returning `{cents, baseCents,
  overCents, grommetCents, appliedMinimum}` so the calculator UI can
  show the breakdown.
- `src/line.ts` — `computeLineCostCents({qtyMilli, unitCostCents}) =
  round(qty × cost / 1000)`. One formula, used by every kind of line.
- `src/estimate.ts` — `computeEstimate({multiplierMilli,
  designFlatCents, lines})` runs once per render in the editor and
  once per save on the server. Returns `{lineCosts (by id), breakdown
  (by kind), subtotalCostCents, finalPriceCents}`. R-EST-01 lives
  here.

Validators + helpers (`apps/web`):

- `lib/validators.ts` — adds `createClientSchema`,
  `createEstimateSchema`, `estimateLineSchema`, `saveEstimateSchema`,
  `updateEstimateStatusSchema`. Numeric fields are bounded to keep a
  fat-fingered keystroke from 100×-multiplying a $50 k subtotal
  (`multiplierMilli ≤ 10000`, line cost `≤ 100,000,000_00`).
- `lib/auth/audit.ts` — extends `AuditAction` with
  `client_created`, `estimate_created`, `estimate_saved`,
  `estimate_status_changed`, `estimate_multiplier_overridden`,
  `estimate_deleted`.
- NEW `lib/estimate/number.ts` — `nextEstimateNumber(tx, tenantId)`
  allocates `EST-NNNNNN` per tenant under a Postgres advisory lock
  inside the create transaction so two concurrent creates can never
  collide on `unique(tenantId, number)`.
- NEW `lib/estimate/seed-machines.ts` — `ensureDefaultMachines(tenantId)`
  upserts the four default machine rows (`Colex SCC CNC`,
  `Laser cutter`, `Flatbed printer`, `Roll-to-roll printer`) at the
  rates from `ESTIMATE_ENGINE.md`. Idempotent via
  `createMany({skipDuplicates: true})` against `unique(tenantId, name)`.
  Called by `createTenantAction`.
- NEW `lib/estimate/defaults.ts` — `defaultUnitCostCents(kind)` and
  `defaultDescription(kind)` so newly added rows pre-fill with the
  shop's standard rates ($50/hr labor, $150/hr install, $150 design).
- NEW `lib/estimate/format.ts` — re-exports money/qty formatters from
  `@bvisible/pricing` plus `kindLabel(kind)` and `qtyHint(kind)`.
- NEW `lib/keyboard/grid-nav.ts` — `makeGridKeyHandler(opts)` returns
  one `onKeyDown` for an entire grid. Handles Enter (down + auto-append)
  and Shift+Enter (up); Tab is left to the browser; arrow keys are
  intentionally NOT hijacked (would break caret nav inside text inputs).
  Cells opt in by setting `data-cell-row`, `data-cell-col`,
  `data-cell-grid`. The handler is React-free for unit testing.

Reusable grid primitives:

- NEW `apps/web/components/grid/cell-input.tsx` — exports `<CellInput>`
  (text) and `<NumericCell>` (money/qty/multiplier). `<NumericCell>`
  keeps an internal "raw" string so the user can type intermediate
  invalid states (`1.`); on blur, parse → snap-back-on-garbage →
  reformat-on-success. `select()` on focus mirrors Excel.

Clients UI:

- NEW `app/(app)/clients/page.tsx`, `actions.ts` (`createClientAction`),
  `new/page.tsx`, `new/client-form.tsx`. Tenant-scoped via
  `requireTenantId()`.

Estimates UI:

- NEW `app/(app)/estimates/page.tsx` — list with cached cost + sell
  totals + status pills. Empty-state CTAs differ depending on whether
  the tenant has any clients yet.
- NEW `app/(app)/estimates/actions.ts` — `createEstimateAction`
  (allocates the per-tenant `EST-NNNNNN` number and verifies the
  picked client belongs to the caller's tenant).
- NEW `app/(app)/estimates/new/{page.tsx,new-estimate-form.tsx}`.
- NEW `app/(app)/estimates/[id]/page.tsx` — RSC bootstrap that loads
  the estimate, machines, and clients in parallel.
- NEW `app/(app)/estimates/[id]/editor.tsx` — top-level client
  component (useReducer over a small action set, dirty tracking via
  JSON snapshot, Cmd/Ctrl+S to save).
- NEW `app/(app)/estimates/[id]/line-grid.tsx` — the spreadsheet:
  one `<table>`, per-cell `data-cell-*` attrs, single `onKeyDown`
  on the grid root. Per-row × / ↑ / ↓ buttons.
- NEW `app/(app)/estimates/[id]/totals-panel.tsx` — sticky breakdown
  + design-flat-fee + multiplier (with override warning) + final
  sell price + Save / status / soft-delete.
- NEW `app/(app)/estimates/[id]/actions.ts` — `saveEstimateAction`
  (replaces all line items + meta in one transaction; reruns
  `@bvisible/pricing` server-side; cached `subtotalCostCents` /
  `finalPriceCents` are written in the same tx; logs `estimate_saved`
  and conditionally `estimate_multiplier_overridden`),
  `updateEstimateStatusAction`, `deleteEstimateAction` (ADMIN /
  SUPER_ADMIN only, soft delete).

Wiring:

- `apps/web/components/app-shell.tsx` — adds `Estimates` and `Clients`
  to `BASE_NAV`. SUPER_ADMIN-without-tenant clicks redirect via
  `requireTenantId()` to `/dashboard?error=no-tenant`.
- `apps/web/app/(app)/admin/tenants/actions.ts` — calls
  `ensureDefaultMachines(tenantId)` after `tenant.create(...)`. Errors
  during seeding are logged but do not block tenant creation; the
  admin can re-seed by adding machines manually.
- `apps/web/package.json` — adds `@bvisible/pricing` workspace dep.

Migration tooling:

- `server-scripts/db/.shadow-migrate.sh` — adds an
  `--append-superadmin-index` flag (default off). Previously the
  script unconditionally appended the SUPER_ADMIN partial unique
  index to every new migration's SQL, which meant any post-Phase-4
  migration would fail validation with `42P07` ("relation already
  exists"). The flag is now opt-in and is documented in-script.

Docs:

- `DATA_MODEL.md` — adds the Phase-6 model definitions and migration row.
- `ESTIMATE_ENGINE.md` — adds the implementation map and notes that
  multiplier overrides write to `audit_logs` automatically.
- `API_STRUCTURE.md` — documents the new pages and actions.
- `UI_SYSTEM.md` — documents the editor, the grid primitives, the
  keyboard helper, and the new sidebar nav items.
- `AUTH_AND_PERMISSIONS.md` — adds the new routes and actions to the
  permissions tables.
- `KNOWN_RULES.md` — links R-EST-01..03 to their concrete
  implementation files; clarifies that R-EST-04 finalize gating still
  ships with the PO module.
- `DEBUGGING.md` — new § 11c "Estimates / pricing" with `psql`
  queries to verify cached totals, audit lookups for multiplier
  overrides, and a one-shot for back-seeding machines on
  pre-existing tenants.

**Risks**

- **Pricing math drift**: solved by integer-only inputs, integer-only
  intermediate state, and a single rounding step at line-cost time.
  The same `computeEstimate(...)` runs in the browser and the server
  on every save so the cached totals can never diverge from what the
  editor showed.
- **Tenant isolation**: every product query passes `tenantId` from
  `requireTenantId()`. `saveEstimateAction` re-validates ownership of
  the estimate AND of every referenced `machineId` before writing.
- **Save-burst races**: a tenant-scoped Postgres advisory lock
  serializes per-tenant `EST-NNNNNN` allocation. The unique
  `(tenantId, number)` index is a belt-and-suspenders second line.
- **Editor scale**: `saveEstimateSchema` caps lines at 500 (the spec
  expects 10–30). At 500 the delete-all + create-all save strategy is
  still ~tens of ms; at 5 000 we'd need a diff-based save and probably
  drag-and-drop.
- **Machine catalog fragility**: tenants created BEFORE this phase
  have no machines. The DEBUGGING runbook documents the back-fill
  one-liner. Future tenants get the seed automatically.
- **No vitest harness yet**: the engine is small enough that the
  editor exercises every formula on every keystroke (visual smoke
  test). Adding `vitest` is a separate test-infrastructure task.

**Local verification**

- `pnpm install --frozen-lockfile` — clean.
- `pnpm --filter @bvisible/db exec prisma generate` — clean
  (Prisma 6.19.3, includes new models).
- `pnpm --filter @bvisible/web run build` — green;
  bundles `/estimates`, `/estimates/new`, `/estimates/[id]`,
  `/clients`, `/clients/new` alongside the existing routes; the
  editor weighs in at `~6.8 KB / 137 KB First Load JS`.
- Standalone build (`NEXT_BUILD_STANDALONE=1`) runs on the Linux
  deploy host; locally on Windows it always fails on `EPERM symlink`
  per the comment in `apps/web/next.config.mjs`.
- Shadow Postgres on the server validates the new migration cleanly
  (`--- shadow-migrate: SUCCESS`).

**Server verification (deploy)**

Run via `server-scripts/db/.reset-and-verify-estimates.sh` against
`https://vmi3270817.contaboserver.net`. Bash output (excerpt):

```
--- 1. Unauthenticated /clients and /estimates -> 307
  /clients -> 307                  middleware gate OK
  /estimates -> 307
  /clients/new -> 307
  /estimates/new -> 307
--- 2. Login as SUPER_ADMIN
  login OK
--- 3. Authenticated /estimates and /clients return 200
  /estimates -> 307 (location: /dashboard?error=no-tenant)
    expected for SUPER_ADMIN without tenant   (requireTenantId redirect)
  /clients -> 307 (location: /dashboard?error=no-tenant)
    expected for SUPER_ADMIN without tenant
--- 4. Database sanity — new tables exist with the right columns
  table clients exists
  table machines exists
  table estimates exists
  table estimate_line_items exists
  enums OK                                     (EstimateStatus + EstimateLineKind)
  unique(tenantId,number) present
--- 5. Tenant + machine catalog status                tenants=0 machines=0
--- 6. End-to-end: create a tenant via SUPER_ADMIN UI, verify machines seeded
  create-tenant -> /admin/tenants?created=qa-est-12344
  tenant created
  tenant row: cmp4nel450006kmulfmq2n5s7|qa-est-12344
  machines for qa-est-12344 (4 rows):
    Colex Sharp Cut Cutter — CNC @ 9078c
    Flatbed printer @ 3345c
    Laser cutter @ 6877c
    Roll-to-roll printer @ 4421c
  default machine catalog seeded with documented rates
--- 7. Sanity grep — no /estimates page leaks credentials in HTML
ALL ESTIMATE-FOUNDATION CHECKS PASSED
```

The pricing engine determinism check was also run locally via
`tsx -e "..."` against `@bvisible/pricing` and produced exact matches
for material / machine / labor / install / misc / design / subtotal /
final-at-3.000× for the canonical input — see commit message + the
test in `.verify-estimates.sh` § 6 algebra notes.

The remaining "create estimate + add lines + save + reload + see
matching cached totals" check requires a tenant USER session (not the
tenant-less SUPER_ADMIN) and is a real-shop UI smoke test rather
than an automated curl flow. Recommended manual smoke before turning
the platform on for a real estimator: invite a tenant ADMIN, accept
the invite, create a client, create an estimate, type a line, hit
Save, refresh, confirm `/estimates` shows the cached cost / sell.

---

## 2026-05-13 — SMTP mailer foundation (Phase 5)

**Commit:** `9e57aae` (`feat: add SMTP mailer foundation`) → followed
by `904e20d` (`fix(mailer): log when smtp_verify is skipped due to
missing config; save phase5 verify scripts`). The fix-up is
queued for the next deploy along with whenever SMTP credentials get
filled in. The deployed-and-verified code is at `9e57aae`.

**Scope**

Adds the outbound mailer surface so invite + password-reset flows
deliver real email instead of surfacing tokenized links inline. New
provider-agnostic SMTP wrapper around Nodemailer (no provider SDK
hard-wired), three branded email templates, a SUPER_ADMIN-only
diagnostic page (`/settings/email-test`) that runs `verify()` then
sends a test message, and audit-log enrichment that records the
delivery outcome on every invite/reset row. Did NOT add email
ingestion, vendor parsing, queues/workers, a notification center, or
provider SDK lock-in; SMTP send is inline in the server action with a
10 s socket-timeout cap so the worst case is bounded.

**What changed (repo)**

- NEW `apps/web/lib/mailer.ts` — provider-agnostic façade. Exports:
  `loadSmtpConfig()` (zod-validated, cached), `verifyTransport()`,
  `sendMail({to,subject,html,text})`, `diagnosticsFor()`, `maskUser()`,
  typed errors (`MailerConfigError`, `MailerSendError` with `kind ∈
  {connect,auth,timeout,recipient,sender,unknown}`). Honors legacy
  `SMTP_APP_PASSWORD` as a fallback for `SMTP_PASSWORD`. Cached pooled
  transport (max 2 connections, max 50 messages per process). All
  `connection`/`greeting`/`socket` timeouts pinned at 10 s. Error
  messages are run through a `sanitize()` that scrubs
  `pass(word)?[=:]\S+` and `\bauth\s+\S+`. Logging discipline: every
  line carries `{mailer:true, host, port, secure, maskedUser, ...}`,
  NEVER the password.
- NEW `apps/web/lib/emails/render.ts` — shared `wrapBranded()` returning
  `{html, text}`. Plain HTML, inline styles, no MJML. Brand mark + slate
  accent + plaintext fallback. ~3 KB per email.
- NEW `apps/web/lib/emails/invite.ts` — `renderInviteEmail({inviteLink,
  role, tenantName, invitedByEmail})`.
- NEW `apps/web/lib/emails/reset.ts` — `renderResetEmail({resetLink,
  expiresInMinutes})`.
- NEW `apps/web/lib/emails/test.ts` — `renderTestEmail({recipientEmail,
  sentByEmail})` for the diagnostic page.
- NEW `apps/web/app/(app)/settings/email-test/page.tsx` — SUPER_ADMIN
  only via `requireSuperAdmin()`. Renders host/port/secure/maskedUser/
  from/replyTo (passwords NEVER displayed) and a single-input form.
  Shows a clear amber panel when SMTP isn't configured.
- NEW `apps/web/app/(app)/settings/email-test/actions.ts` —
  `sendTestEmailAction`. Re-checks `requireSuperAdmin()` inside the
  action body, validates input with `testEmailSchema`, runs SMTP
  `verify()` first, then `sendMail()`. Returns sanitized
  `{ok, error, diagnostics, detail:{code,responseCode}, messageId}`.
- NEW `apps/web/app/(app)/settings/email-test/test-email-form.tsx` —
  client form with `useActionState`. Renders FormError/FormNotice and
  the SMTP error code/responseCode block on failure.
- `apps/web/app/(auth)/forgot/actions.ts` — drops the `devLink` from
  `RequestResetState`. After creating the `PasswordResetToken`, calls
  `sendMail` with `renderResetEmail`. Audit metadata gains
  `mailDelivery: 'sent' | 'failed_<kind>' | 'failed_no_config' |
  'skipped_no_user'`. The action ALWAYS returns the same generic OK
  regardless of email existence or mail success — public form must not
  enumerate accounts or leak SMTP misconfiguration.
- `apps/web/app/(auth)/forgot/forgot-form.tsx` — removes the
  copy-the-link block. Just renders the success notice.
- `apps/web/app/(app)/admin/users/actions.ts` — after `userInvite.create`,
  calls `sendMail` with `renderInviteEmail`. On success, redirects to
  `?sent=<email>` (green toast). On failure, redirects to
  `?invite=<token>&invitedEmail=<email>&mailErr=<kind>` so the admin
  can deliver the link manually (single-use token, same security
  envelope as pre-mailer state). Audit `invite_created` gains
  `mailDelivery`.
- `apps/web/app/(app)/admin/users/page.tsx` — replaces the pre-mailer
  green "copy this link manually" panel with: green "Invite email sent
  to X" toast on success; amber panel with sanitized error label +
  fallback link on `mailErr`. New `MAIL_ERR_LABELS` lookup maps
  `kind → user-readable string`.
- `apps/web/lib/validators.ts` — adds `testEmailSchema` + `TestEmailInput`.
- `apps/web/components/app-shell.tsx` — adds `{href:'/settings/email-test',
  label:'Email test', hint:'smtp'}` to `SUPER_ADMIN_NAV`.
- `apps/web/package.json` — adds `nodemailer ^8.0.7` (dep) and
  `@types/nodemailer ^8.0.0` (devDep). Nodemailer is plain JS — no
  `allowBuilds` entry needed, no native binaries to mirror into the
  standalone tree.

**Migration name**

None. The `mailDelivery` flag lives in `audit_logs.metadata` JSONB.

**Env vars added (in `/opt/bvisible/shared/env/.env`)**

| Var | Required |
|---|---|
| `SMTP_HOST` | yes |
| `SMTP_PORT` | yes |
| `SMTP_USER` | yes |
| `SMTP_PASSWORD` | yes (legacy `SMTP_APP_PASSWORD` honored as fallback) |
| `SMTP_FROM` | yes |
| `SMTP_SECURE` | no (auto-inferred from port: 465 → true) |
| `SMTP_REPLY_TO` | no |

**Risks**

- **Nodemailer not bundled into standalone.** Plain JS with no
  `dlopen`, so Next's tracer should pick it up automatically — but if a
  future Next minor regresses tracing, the symptom is `Cannot find
  module 'nodemailer'` in PM2 err log. Recovery is the same pattern as
  the Prisma engine mirror in `deploy-once.sh`. DEBUGGING § 11b
  documents the fix.
- **Inline SMTP send blocks the server-action handler.** Bounded by
  three 10 s timeouts in the transport, so worst case the user sees a
  ≤ 10 s "Sending..." button. If SMTP latency becomes a problem we
  move sends to a background queue — out of scope here.
- **Failure surface for invites is amber, not red.** The admin still
  gets a working invite link in the amber panel, so the action never
  hard-fails in a way that blocks team operations. Audit log captures
  the failure for ops correlation.
- **Public forgot form never reveals SMTP failures.** Deliberate (no
  account enumeration, no infra fingerprinting) but means a misconfigured
  SMTP for password reset is invisible from the public side. Detection
  paths: the diagnostic page, audit log, mailer log lines.
- **Gmail with 2FA needs an app password, not the account password.**
  `SMTP_PASSWORD` should be the 16-char app password. `SECURITY_RULES.md`
  lists this; ops doc covers it in DEBUGGING § 11b.
- **Brand templates are hand-written inline-style HTML.** No MJML
  toolchain; if templates need to evolve substantially we revisit. The
  three currently-shipped templates are short enough that a hand-edit
  is faster than any DSL.

**Local verification**

- `pnpm --filter @bvisible/web add nodemailer` + `add -D @types/nodemailer`
  — clean, no `allowBuilds` warnings.
- `pnpm --filter @bvisible/web run build` — green. Routes:
  `/settings/email-test 1.74 kB / 116 kB`. Middleware unchanged at
  34.3 kB. No new lints.

**Verification performed (server)**

- Deploy job ID: `20260513T205934-f21fde` at SHA `9e57aae`. Reached
  `done`. Deploy log shows: build OK (11 routes including new
  `/settings/email-test 1.74 kB / 116 kB`), `prisma migrate deploy`
  no-op (no schema change), `db-verify` OK, Prisma engine mirror
  succeeded (`libquery_engine-debian-openssl-3.0.x.so.node`,
  `libquery_engine-linux-musl-openssl-3.0.x.so.node`), PM2 reload OK,
  healthcheck OK.
- E2E auth regression run (`server-scripts/db/.verify-auth.sh`):
  all 10 checks PASS — login still sets `bv_session` (HttpOnly,
  Secure, SameSite=lax), `/dashboard` reachable with cookie, logout
  revokes session, audit log records `login_success` + `logout`,
  Postgres still 127.0.0.1-only.
- E2E mailer foundation run (`server-scripts/db/.verify-mailer.sh`):
  all 7 checks PASS:
  1. `/settings/email-test` without cookie → 307 (middleware-gated)
  2. SUPER_ADMIN login OK
  3. `/settings/email-test` with cookie → 200
  4. Page renders the "SMTP is not configured" amber panel (expected
     halfway state — env keys are placeholders pending credentials)
  5. No credential-shaped value in page body (no argon2 hashes, no
     leaked password values)
  6. POST the test-email form → 200 (no 500, no Set-Cookie, no
     redirect — action ran cleanly and returned the typed config
     error, page re-rendered with the error block)
  7. `/admin/users` still 200 with the SUPER_ADMIN cookie (no
     regression in the existing surface)
- `pm2 logs bvisible-web --err`: no Prisma errors, no mailer
  exceptions, no unhandled rejections. The mailer module imported
  cleanly at boot (no nodemailer bundling issue in the standalone
  tree).

**Deferred until SMTP credentials are filled in**

The user opted to populate `SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM`
themselves in `/opt/bvisible/shared/env/.env` (mode 640,
`deploy:deploy`). When that happens, redeploy (or `bash -lc 'pm2
reload bvisible-web --update-env'` to flush the cached transport)
and run the actual round-trip checks via the in-app diagnostic page
at **Settings → Email test**. The page runs SMTP `verify()` first,
then sends a branded test message; sanitized errors print without
leaking credentials. Once green, the invite + reset flows
automatically use SMTP — no further code change required.

The `SMTP_HOST=smtp.gmail.com` and `SMTP_PORT=465` defaults are
already in `.env`. For Gmail / Workspace, `SMTP_PASSWORD` MUST be a
16-character App Password
(<https://myaccount.google.com/apppasswords>) — the regular account
password will not work with SMTP if 2FA is on.

---

## 2026-05-13 — Auth + tenant foundation (Phase 4)

**Commit:** `56cdd14` (`feat: add auth and tenant foundation`) → followed
by `0c9ccfc` (`fix(auth): include prisma engine in standalone bundle and
fix middleware redirect host`). The fix commit is the SHA that actually
deployed green; see "Follow-up runtime fixes" below.

**Scope**

Adds the first real auth surface to B Visible: email/password login
with Argon2id, DB-backed sessions, role helpers (SUPER_ADMIN/ADMIN/
USER), Edge middleware + page-RSC `requireUser()`, a CLI bootstrap for
the first SUPER_ADMIN, an admin invite flow (link displayed inline
because SMTP is not yet wired), a password reset flow (same stub-link
display), a per-tenant audit log, and a SaaS-style logged-in shell
with sidebar nav, user menu, and sign-out. Did NOT add product
features (estimates, POs, vendors, email ingestion), mobile JWT, OAuth,
or change firewall / queue serialization / nginx / PM2 config.

**What changed (repo)**

- NEW migration
  `packages/db/prisma/migrations/20260513192157_auth_and_invites/`.
  Adds 4 columns on `users` (`lastLoginAt`, `disabledAt`, `invitedAt`,
  `inviteAcceptedAt`); adds 4 tables (`sessions`, `user_invites`,
  `password_reset_tokens`, `audit_logs`) with all indexes and FKs;
  appends a hand-written partial unique index `users_email_super_admin_key`
  on `users(email) WHERE "tenantId" IS NULL` to close the SUPER_ADMIN
  email-collision hole that the composite `@@unique([tenantId, email])`
  leaves open (Postgres treats NULLs as distinct). Generated against a
  shadow Postgres on the server so production was never touched until
  the deploy ran `migrate deploy` — see
  `server-scripts/db/.shadow-migrate.sh`.
- NEW `server-scripts/db/.shadow-migrate.sh` — bring up a temporary
  Postgres on `127.0.0.1:5433` (compose project `bvisible-shadow`),
  apply existing migrations, run `prisma migrate dev --create-only`
  with a supplied schema, append hand-written SQL, validate, tear
  down. Reusable for future migrations.
- `packages/db/prisma/schema.prisma` — extended with new fields and
  models. Schema-language partial-unique limitation noted in a
  comment on `User`.
- `packages/db/src/index.ts` — re-exports `Prisma` (value, for
  `Prisma.PrismaClientKnownRequestError`) and adds type re-exports
  for `Session`, `UserInvite`, `PasswordResetToken`, `AuditLog`.
- `pnpm-workspace.yaml` — added `esbuild: true` to `allowBuilds`
  because `tsx` (used by the bootstrap CLI) pulls it in and pnpm v11
  refuses to run install scripts without an entry. (`@node-rs/argon2`
  needs no entry — it ships prebuilt napi binaries with no postinstall
  script.)
- `apps/web/package.json` — added deps `@node-rs/argon2`, `zod`;
  devDep `tsx`; npm script `bootstrap:super-admin`.
- NEW `apps/web/middleware.ts` — Edge cookie-presence check;
  redirects to `/login?next=<safe-relative>` for protected routes.
  Public routes: `/`, `/login`, `/forgot`, `/reset/*`, `/invite/*`,
  `/api/health`. Static assets and Next internals skipped via the
  matcher regex.
- NEW `apps/web/lib/auth/password.ts` — Argon2id hash/verify
  (memoryCost 64 MiB, timeCost 3, parallelism 1). Hardcodes
  `algorithm: 2` because `Algorithm.Argon2id` is an ambient const enum
  and `isolatedModules` forbids referencing its members.
- NEW `apps/web/lib/auth/tokens.ts` — 256-bit base64url token
  generator + SHA-256 hasher.
- NEW `apps/web/lib/auth/session.ts` — cookie name `bv_session`;
  TTL 30 d; `HttpOnly; Secure (prod); SameSite=Lax; Path=/`. DB-backed
  via `Session` table. Logout sets `revokedAt` and clears the cookie.
- NEW `apps/web/lib/auth/current-user.ts` — `getCurrentUser`
  (React-`cache`d), `requireUser`, `requireRole`, `requireSuperAdmin`,
  `requireTenantId`. The ONLY sanctioned way to read the session
  inside RSC / server actions.
- NEW `apps/web/lib/auth/audit.ts` — `writeAuditLog()`. 12 allowed
  actions. Best-effort: a DB error logs to stderr but never breaks
  the underlying action.
- NEW `apps/web/lib/auth/rate-limit.ts` — per-email failed-login
  throttle (5 in 15 min) using `audit_logs` row count.
- NEW `apps/web/lib/validators.ts` — zod schemas for login, request-
  reset, complete-reset, accept-invite, change-password, invite-user,
  create-tenant. Email/password rules in one place.
- NEW `apps/web/lib/request-context.ts` — extracts
  `x-forwarded-for` + `user-agent` from `headers()` (truncated for
  audit safety).
- NEW `app/(auth)/{login,forgot,reset/[token],invite/[token]}/`
  pages + actions + client form components. Centered card layout via
  NEW `apps/web/components/auth/auth-card.tsx`; reusable
  `<FormError>` / `<FormNotice>` at
  `apps/web/components/auth/form-error.tsx`. Login form at
  `apps/web/components/auth/login-form.tsx`.
- NEW `app/(app)/layout.tsx` — `requireUser()` then renders the
  `AppShell`.
- NEW `app/(app)/{dashboard,settings,admin/users,admin/tenants}/`
  pages + actions + client form components.
- `apps/web/components/app-shell.tsx` — refactored to take a `user`
  prop, render role-aware nav via the NEW
  `apps/web/components/app/nav-links.tsx`, render the NEW
  `apps/web/components/app/user-menu.tsx` at sidebar bottom, and
  expose a reusable `<PageHeader>` for per-page titles.
- `apps/web/app/page.tsx` — root now redirects to `/dashboard` (signed
  in) or `/login` (anonymous). The previous static welcome page is
  gone — its content moved into `/dashboard`.
- NEW `apps/web/scripts/bootstrap-super-admin.ts` + `README.md`. Run
  via `pnpm --filter @bvisible/web run bootstrap:super-admin` with
  inline env vars. Refuses if any SUPER_ADMIN exists. Argon2id-hashes
  password. Writes `super_admin_bootstrapped` audit row.

**What changed (server)**

- New migration applied via the deploy's `prisma migrate deploy` step.
- First SUPER_ADMIN created via the CLI bootstrap script (post-deploy,
  one-shot).
- No nginx, PM2, firewall, certbot, compose, or deploy-queue script
  changes.

**Files touched**

- `packages/db/prisma/schema.prisma` (modified)
- `packages/db/prisma/migrations/20260513192157_auth_and_invites/migration.sql` (new)
- `packages/db/src/index.ts` (modified)
- `pnpm-workspace.yaml` (modified)
- `server-scripts/db/.shadow-migrate.sh` (new)
- `apps/web/package.json` (modified)
- `apps/web/middleware.ts` (new)
- `apps/web/lib/auth/password.ts` (new)
- `apps/web/lib/auth/tokens.ts` (new)
- `apps/web/lib/auth/session.ts` (new)
- `apps/web/lib/auth/current-user.ts` (new)
- `apps/web/lib/auth/audit.ts` (new)
- `apps/web/lib/auth/rate-limit.ts` (new)
- `apps/web/lib/validators.ts` (new)
- `apps/web/lib/request-context.ts` (new)
- `apps/web/app/page.tsx` (modified)
- `apps/web/app/(auth)/layout.tsx` (new)
- `apps/web/app/(auth)/login/{page,actions}.ts(x)` (new)
- `apps/web/app/(auth)/forgot/{page,actions,forgot-form}.ts(x)` (new)
- `apps/web/app/(auth)/reset/[token]/{page,actions,reset-form}.ts(x)` (new)
- `apps/web/app/(auth)/invite/[token]/{page,actions,invite-form}.ts(x)` (new)
- `apps/web/app/(app)/layout.tsx` (new)
- `apps/web/app/(app)/dashboard/page.tsx` (new)
- `apps/web/app/(app)/settings/{page,actions,change-password-form}.ts(x)` (new)
- `apps/web/app/(app)/admin/users/{page,actions,invite-user-form}.ts(x)` (new)
- `apps/web/app/(app)/admin/tenants/{page,actions,create-tenant-form}.ts(x)` (new)
- `apps/web/components/app-shell.tsx` (modified — refactor + PageHeader export)
- `apps/web/components/auth/auth-card.tsx` (new)
- `apps/web/components/auth/form-error.tsx` (new)
- `apps/web/components/auth/login-form.tsx` (new)
- `apps/web/components/app/nav-links.tsx` (new)
- `apps/web/components/app/user-menu.tsx` (new)
- `apps/web/scripts/bootstrap-super-admin.ts` (new)
- `apps/web/scripts/README.md` (new)
- `docs/ai-context/AUTH_AND_PERMISSIONS.md` (rewrite)
- `docs/ai-context/DATA_MODEL.md` (modified)
- `docs/ai-context/API_STRUCTURE.md` (modified)
- `docs/ai-context/UI_SYSTEM.md` (modified)
- `docs/ai-context/SECURITY_RULES.md` (modified)
- `docs/ai-context/ENVIRONMENT_VARIABLES.md` (modified)
- `docs/ai-context/DEBUGGING.md` (modified — § 11a auth runbook)
- `docs/ai-context/DEPLOYMENT.md` (modified — bootstrap step)
- `docs/ai-context/CHANGELOG_AI.md` (this entry)

**Risks**

- **Lock-out window.** Until the SUPER_ADMIN is bootstrapped, the auth
  wall has nobody who can sign in. `/login` accepts no creds, no UI
  path forwards. Mitigated by: (a) `/api/health` stays public so
  uptime stays green; (b) the bootstrap is a single CLI command
  documented in `apps/web/scripts/README.md` and `DEPLOYMENT.md`
  ("First-time SUPER_ADMIN bootstrap"); (c) public routes (`/login`,
  `/forgot`, `/reset/*`, `/invite/*`) still render so the path back in
  exists once the SUPER_ADMIN runs the bootstrap.
- **Migration ordering.** `prisma migrate deploy` runs BEFORE PM2
  reload. If the migration fails, the new app code never goes live —
  good. If the migration succeeds but the new app code crashes at
  boot, the healthcheck catches it and the deploy lands in `failed/`.
  Rollback: re-enqueue the previous good `commitHash`. The new auth
  tables remain (additive only — no data loss).
- **Email stub.** Invite + reset links are NOT emailed; they are
  displayed inline to the inviting/requesting user. SMTP wiring is a
  separate task. Documented in AUTH_AND_PERMISSIONS.md and
  apps/web/scripts/README.md.
- **Per-process rate limiting.** Failed-login throttle counts
  audit-log rows (5 in 15 min for an email). Single-process correct;
  not yet distributed (would need Redis).
- **Argon2 native binary.** `@node-rs/argon2` ships prebuilds for
  linux-x64-gnu (server) and win32-x64 (Windows dev). No prebuild for
  alpine-musl, but PM2 runs on Ubuntu host glibc — irrelevant.
- **Partial unique index in raw SQL.** Hand-edited migration SQL is a
  drift risk if a future `migrate diff` is run. The risk is bounded:
  the index is documented, comment-tagged in the SQL, and re-validated
  by re-applying to the shadow before commit.
- **Session cookie does not carry CSRF token.** Server actions use
  Next 15's same-origin POST check. When we add REST routes that
  accept cookie-auth (mobile uses Bearer instead, so this is mostly
  hypothetical), we'll add a CSRF column to `Session` and validate
  it.

**Verification performed (local)**

- `pnpm install --frozen-lockfile` — clean. New deps: `@node-rs/argon2`,
  `zod`, `tsx` (with esbuild prebuild downloaded via the new
  `allowBuilds` entry).
- `pnpm --filter @bvisible/db exec prisma generate` — Prisma Client
  v6.19.3 regenerated with the new types.
- `pnpm --filter @bvisible/web run build` — green. 11 routes
  including all new pages + middleware (34.3 kB). Static gen 4
  prerendered, 7 server-rendered on demand.
- Migration generated against shadow Postgres on the server, validated
  by re-application, scp'd back, committed alongside the schema
  change. Production DB never touched at this stage.

**Verification performed (server)**

- Deploy job IDs:
  - `20260513T193505-ac5b38` — first auth deploy at SHA `56cdd14`. Job
    reached `done`, migration applied, healthcheck OK, but the running
    process crashed at the FIRST Prisma call with
    `PrismaClientInitializationError: Prisma Client could not locate
    the Query Engine for runtime "debian-openssl-3.0.x"`. Login POST
    returned 500 (no `bv_session` cookie). Middleware was also
    constructing redirects against `req.nextUrl.host`, which behind
    nginx is `127.0.0.1:3000`, so /dashboard redirected to
    `https://localhost:3000/login?next=...` from the browser's
    perspective.
  - `20260513T195014-5bd3d9` — fix deploy at SHA `0c9ccfc`. Reached
    `done`. Standalone Prisma engine mirror succeeded
    (`libquery_engine-debian-openssl-3.0.x.so.node` +
    `libquery_engine-linux-musl-openssl-3.0.x.so.node` present in the
    bundle). Healthcheck OK.
- E2E auth verification (`server-scripts/db/.verify-auth.sh`, against
  `https://vmi3270817.contaboserver.net`):
  1. `/api/health` public both upstream + via nginx — `{"status":"ok"}`
  2. `/login` reachable as 200
  3. `/dashboard` without cookie → 307 to
     `https://vmi3270817.contaboserver.net/login?next=%2Fdashboard`
     (PUBLIC host, NOT localhost — confirms middleware fix)
  4. `/admin/users` without cookie → 307 (gated)
  5. Login via no-JS form POST (forwarding all 4 hidden inputs Next
     emits for `useActionState`: `$ACTION_REF_1`, `$ACTION_1:0`,
     `$ACTION_1:1`, `$ACTION_KEY`) → 303, `Set-Cookie: bv_session=…;
     Path=/; Expires=…; Secure; HttpOnly; SameSite=lax`,
     `Location: /dashboard`
  6. `/dashboard` with the cookie → 200, body mentions the admin email
  7. `/admin/tenants` with the SUPER_ADMIN cookie → 200
  8. Logout via the argument-less form on `/settings` → 303,
     `Set-Cookie: bv_session=; Max-Age=0; …`, `Location: /login`. The
     same cookie value sent to `/dashboard` afterwards → 307 (DB
     session row revoked).
  9. `audit_logs` shows ordered `login_success` (×2) and `logout` rows
     for the SUPER_ADMIN with `ipAddress=127.0.0.1` (loopback because
     the verify ran from the box itself; real external clients will
     log their forwarded IP via `request-context.ts`).
  10. Postgres still bound `127.0.0.1:5432` only.

**Follow-up runtime fixes (commit `0c9ccfc`)**

- `apps/web/middleware.ts` — redirect URL is now built from
  `x-forwarded-host` + `x-forwarded-proto` headers (with `host` and
  `req.nextUrl.host` as fallbacks), not from `req.nextUrl`. Behind
  nginx, `req.nextUrl.host` is `127.0.0.1:3000` (the value nginx
  forwards as `Host` by default), so absolute redirect Locations were
  pointing the browser at `localhost`. Trusting `x-forwarded-host` is
  safe here because port 3000 binds to 127.0.0.1 only — the only
  thing that can hit this Node process is nginx.
- `server-scripts/deploy-queue/deploy-once.sh` — after wiring the
  standalone runtime and copying `.next/static` + `public/`, the
  script now `find`s the live workspace's
  `node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client`
  directory (populated by `prisma generate` during the build) and
  copies it to the matching path under
  `apps/web/.next/standalone/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/`.
  Next's static tracer doesn't follow `dlopen()` calls, so the
  `libquery_engine-*.so.node` binaries are otherwise omitted from the
  standalone bundle and Prisma crashes the first time any handler
  runs `prisma.user.findUnique`. The deploy log line to look for is
  `Prisma client mirrored into standalone: …`. If this line is
  missing from a future deploy, every Prisma call will throw
  `PrismaClientInitializationError`. Both the in-repo copy
  (`server-scripts/deploy-queue/deploy-once.sh`) and the on-disk copy
  at `/opt/bvisible/deploy-queue/deploy-once.sh` were updated; the
  worker reads the on-disk one.

**Migration name**

`20260513192157_auth_and_invites`

**Env vars added**

None in `.env`. The bootstrap CLI reads `BOOTSTRAP_ADMIN_EMAIL`,
`BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_ADMIN_NAME` inline at
invocation (NOT from `.env`).

**Bootstrap command**

```bash
cd /opt/bvisible/app
( set -a; . /opt/bvisible/shared/env/.env; set +a; \
  BOOTSTRAP_ADMIN_EMAIL='you@example.com' \
  BOOTSTRAP_ADMIN_PASSWORD='strong-passphrase-here' \
  BOOTSTRAP_ADMIN_NAME='Your Name' \
  pnpm --filter @bvisible/web run bootstrap:super-admin )
```

---

## 2026-05-13 — Postgres foundation + Prisma migrate-deploy in deploy queue (Phase 3)

**Commits:** `5fe154bc90d07ef5818e7e0814f75c1ef1afbb0e` (feat) →
`b8fbfec303e31c56d69f363d11d68fcd3717605f` (fix; this is the SHA that actually
deployed green).
**Message:** `feat: add Postgres and Prisma migration deploy`
**Follow-up:** `fix(deploy): remove legacy compose-services restart block (Phase 3)`
— a stale block in `deploy-once.sh` was running `docker compose up -d --no-deps web`
based on the job's `services` array. With the Phase 3 compose file only defining
the `db` service (web runs under PM2), that block hard-failed (`no such service:
web`) and aborted the first deploy attempt (`20260513T181731-3f5f97`). Removed the
dead block; PM2 reload + healthcheck already covered what it was meant to do.

**Scope**

Adds the production Postgres database (managed by docker compose, bound
to `127.0.0.1:5432` ONLY), the first Prisma migration
(`20260513180326_init` — `Role` enum, `tenants`, `users`), and wires
`prisma migrate deploy` + a post-migration `db-verify.sh` into
`deploy-once.sh`. Did NOT add auth, product features, change firewall,
expose ports publicly, or modify queue serialization.

**What changed (repo)**

- NEW `docker-compose.yml` (repo root) — project `bvisible`, single
  service `db` = `postgres:16-alpine`, container `bvisible-db`,
  ports `127.0.0.1:5432:5432` (the `127.0.0.1:` prefix is mandatory),
  named volume `bvisible_pgdata`, healthcheck `pg_isready`. The web
  app stays under PM2 on the host (NOT in compose).
- NEW `server-scripts/db/init/01-extensions.sql` — enables `pgcrypto`
  on a fresh data volume.
- NEW `server-scripts/db/db-verify.sh` — `docker compose exec` into
  `bvisible-db`, asserts container running + connection works +
  `_prisma_migrations` table present + `tenants`/`users` exist. Used
  by `deploy-once.sh`. Standalone-runnable for ops.
- NEW `packages/db/prisma/migrations/migration_lock.toml` and
  `packages/db/prisma/migrations/20260513180326_init/migration.sql` —
  generated by `prisma migrate dev --name init` against the real
  production Postgres on 2026-05-13 (clean room: bootstrap compose dir
  in `/tmp`, generate, scp back, clean working tree). Already applied
  to the live DB; subsequent `migrate deploy` runs are no-ops.
- NEW `server-scripts/db/.bootstrap-write-env.sh`,
  `.bootstrap-fix-env.sh`, `.bootstrap-migrate.sh`,
  `.bootstrap-verify.sh` — one-off scripts used during the Phase 3
  bootstrap. Tracked in git for audit and reusability on a future
  fresh server. The leading-dot prefix keeps them out of any rsync
  that targets `server-scripts/db/init/`. They contain NO secrets;
  they generate them at run time.
- `packages/db/package.json` — added `migrate:deploy`, `migrate:dev`,
  `migrate:status` scripts.
- `package.json` (root) — added `prisma:migrate-deploy`,
  `prisma:migrate-status`, `db:up`, `db:down`, `db:logs`.
- `server-scripts/04-layout-and-queue.sh` — installs `db-verify.sh` to
  `/opt/bvisible/deploy-queue/` on fresh server installs (joins
  `deploy-once.sh`, `enqueue-deploy.sh`, `deploy-worker.sh`,
  `status.sh`, `healthcheck.sh` in the install loop).
- `server-scripts/deploy-queue/deploy-once.sh` — new DB phase between
  build and PM2 reload: `docker compose up -d db`, wait for
  `pg_isready` (≤60s), `prisma migrate deploy` (with `.env` sourced in
  a subshell so prisma sees `DATABASE_URL`), then `db-verify.sh`.
  Migration failure → `exit 10`. db-verify failure → `exit 11`.

**What changed (server)**

- `bvisible-db` container is up via `docker compose -p bvisible up -d
  db` from `/tmp/db-bootstrap/`. Same project name as the future
  in-tree deploy, so the next deploy hits the same container/volume.
- `/opt/bvisible/shared/env/.env` populated with `POSTGRES_DB`,
  `POSTGRES_USER`, `POSTGRES_PASSWORD` (32-char random,
  generated by `.bootstrap-write-env.sh`, never echoed),
  `DATABASE_URL` (double-quoted to handle the `&` in the query string).
  Mode 640, owner deploy:deploy.
- First migration `20260513180326_init` applied to the live DB; row
  exists in `_prisma_migrations` with `finished_at` set.
- `/opt/bvisible/deploy-queue/deploy-once.sh` and
  `/opt/bvisible/deploy-queue/db-verify.sh` will be synced from this
  commit (the worker runs the on-disk copies, not the repo copies).
- `bvisible_pgdata` named volume holds the data
  (`/var/lib/docker/volumes/bvisible_pgdata/_data`).

**Files touched**

- `docker-compose.yml` (new)
- `server-scripts/db/init/01-extensions.sql` (new)
- `server-scripts/db/db-verify.sh` (new)
- `server-scripts/db/.bootstrap-write-env.sh` (new)
- `server-scripts/db/.bootstrap-fix-env.sh` (new)
- `server-scripts/db/.bootstrap-migrate.sh` (new)
- `server-scripts/db/.bootstrap-verify.sh` (new)
- `packages/db/prisma/migrations/migration_lock.toml` (new)
- `packages/db/prisma/migrations/20260513180326_init/migration.sql` (new)
- `packages/db/package.json` (modified)
- `package.json` (modified)
- `server-scripts/04-layout-and-queue.sh` (modified)
- `server-scripts/deploy-queue/deploy-once.sh` (modified)
- `docs/ai-context/DATA_MODEL.md` (modified)
- `docs/ai-context/DEPLOYMENT.md` (modified)
- `docs/ai-context/DEPLOY_QUEUE.md` (modified)
- `docs/ai-context/ENVIRONMENT_VARIABLES.md` (modified)
- `docs/ai-context/DEBUGGING.md` (modified)
- `docs/ai-context/SECURITY_RULES.md` (modified)
- `docs/ai-context/CHANGELOG_AI.md` (this entry)

**Risks**

- **Port binding gotcha.** Docker's `-p 5432:5432` would bind
  `0.0.0.0` AND inject an iptables rule that bypasses UFW —
  publishing the DB to the entire internet. We use
  `127.0.0.1:5432:5432` and verified `ss -tln src 0.0.0.0:5432`
  returns empty. Future edits to `docker-compose.yml` MUST keep the
  `127.0.0.1:` prefix.
- **`.env` quoting.** `DATABASE_URL` contains an unquoted `&` (query
  string). Bash sourcing of `.env` interprets that as the background
  operator and silently fails to set the variable. The bootstrap
  script writes it double-quoted; `deploy-once.sh` documents the
  invariant; `DEBUGGING.md § 11` records the symptom and fix. If
  someone hand-edits `.env` and drops the quotes, the next deploy
  fails at `prisma migrate deploy` with a clear error.
- **First-deploy ordering.** This commit introduces both the compose
  file AND the deploy-once DB phase in a single change. The compose
  file is already brought up on the server out-of-band by the
  bootstrap, so the in-deploy `docker compose up -d db` is a no-op on
  the first deploy after this commit. If the bootstrap had been
  skipped, the deploy would still succeed: compose-up brings the
  service up cold, `prisma migrate deploy` applies all migrations
  fresh.
- **Migration ordering vs PM2.** `prisma migrate deploy` runs BEFORE
  PM2 reload, so a broken migration aborts the deploy without ever
  swapping the runtime. Trade-off: a successful migration that
  exposes a runtime bug will still flip PM2 to the new build; the
  healthcheck catches the runtime side. Rollback path is
  `re-enqueue previous-good commitHash` (DEBUGGING.md § 13).
- **No DB backups yet.** Postgres data is on a single named volume on
  a single host. A snapshot/`pg_dump` cron is the next obvious step
  (DEPLOYMENT.md outstanding step #3). Current data exposure: zero
  rows beyond the empty migration state.
- **Bootstrap scripts in repo.** The four `.bootstrap-*.sh` files in
  `server-scripts/db/` are tracked in git. They contain NO secrets —
  they generate the password at run time on the server. Audited.

**Verification performed (local)**

- `pnpm install --frozen-lockfile` — clean, no new deps.
- `pnpm run prisma:generate` — green, Prisma Client v6.19.3.
- `pnpm run build` — green (Next 15 build, 4 routes including
  `/api/health`).
- Migration files audited: `migration_lock.toml` pins `provider =
  "postgresql"`; `migration.sql` matches the schema (Role enum,
  tenants, users, indexes, FK).

**Verification performed (server)**

- Postgres container: `docker compose -p bvisible ps db` →
  `Up (healthy)`, ports `127.0.0.1:5432->5432/tcp`.
- Public reachability: `ss -tln src 0.0.0.0:5432` returns empty
  (i.e. NOT publicly bound). `ufw status` shows no 5432 rule. UFW
  allowed list still 22/80/443 only.
- Migration applied: `_prisma_migrations` contains
  `20260513180326_init` with `finished_at IS NOT NULL`.
- Tables present: `\dt` returns `_prisma_migrations`, `tenants`,
  `users` in `public`.
- Working tree at `/opt/bvisible/app`: `git status --porcelain`
  returns only `?? uploads` (the shared symlink, untracked, ignored
  by deploy-once dirty check).

**Env vars required (now in `/opt/bvisible/shared/env/.env`)**

- `POSTGRES_DB=bvisible`
- `POSTGRES_USER=bvisible`
- `POSTGRES_PASSWORD=` 32-char random (generated, never echoed)
- `DATABASE_URL="postgresql://bvisible:***@127.0.0.1:5432/bvisible?schema=public&connection_limit=20"` (double-quoted)

**Migration name**

`20260513180326_init` — first migration; creates `Role` enum and
`tenants` / `users` tables with all indexes and the `tenantId` FK.

**Deploy job IDs:**
- `20260513T181731-3f5f97` — failed (rc=1) at the legacy "Restart only
  requested services: web" block (no `web` service in compose). Failed
  job preserved in `/opt/bvisible/deploy-queue/failed/`.
- `20260513T182043-c362ac` — **done** in ~108 s after the follow-up fix.
  Release at `/opt/bvisible/releases/20260513T182044Z-b8fbfec303e3`.

**Deploy result (final):** `done`. End-to-end log:
- Build OK (Next.js standalone bundle).
- `docker compose up -d db` recreated the container (compose file
  changed in working tree — host config drift was reconciled). Healthy
  in <2s.
- `prisma migrate deploy`: "1 migration found in prisma/migrations / No
  pending migrations to apply" (expected — already applied during
  bootstrap).
- `db-verify.sh`: container running, connection OK,
  `_prisma_migrations` OK, `tenants`/`users` OK, applied migrations: 1
  (latest `20260513180326_init`).
- PM2 reload: `bvisible-web` online (pid 24100).
- PM2 save OK.
- Healthcheck: OK after 1 attempt.

**Postgres status:** `bvisible-db` running, healthy, port-published
`127.0.0.1:5432:5432` only (recreated at deploy time, named volume
`bvisible_pgdata` survived).
**Migration result:** idempotent no-op (`No pending migrations to apply`).
**Healthcheck result:** OK after 1 attempt
(`{"status":"ok","service":"bvisible-web"}`).
**HTTPS health endpoint:** `GET https://vmi3270817.contaboserver.net/api/health`
returns `200 OK` with body `{"status":"ok","service":"bvisible-web"}`,
70 ms over TLS.
**Public port safety:** `ss -tln src 0.0.0.0:5432` empty;
`ss -tlnp | grep ':5432'` shows ONLY `127.0.0.1:5432` (docker-proxy on
lo); UFW unchanged (22/80/443 only); no UFW rule for 5432 (none needed
because nothing external can reach it).
**Queue end state:** `bvisible-status` shows last 5 done includes
`20260513T182043-c362ac`; queue empty; serialization unchanged.

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
