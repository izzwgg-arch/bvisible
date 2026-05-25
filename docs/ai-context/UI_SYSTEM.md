# UI_SYSTEM — B Visible

The look, feel, and behavior of the web app.

## Brand & vibe

- **B Visible** branded throughout — logo top-left of the sidebar, favicon,
  title bar.
- **SaaS 2026 professional look:** clean, minimal, lots of whitespace, calm
  color palette with a single bright accent.
- **Practicality is king, user-friendly is queen.** Don't add a flourish that
  costs the user a click.

## Currently shipped (foundation + auth + estimates + purchase orders)

- Next.js 15 App Router + React 19 + TypeScript + Tailwind 4.
- **Route groups**: `app/(auth)/*` for unauthenticated pages (login,
  forgot, reset, invite) and `app/(app)/*` for authenticated pages
  (dashboard, settings, admin/users, admin/tenants as **Company settings**). Edge middleware
  (`apps/web/middleware.ts`) gates the protected paths with a cookie
  presence check; **`/quote/*`** is allowed without a session and receives no-store / noindex headers.
  Authenticated routes rely on the page RSC re-validating against the DB via
  `requireUser()` / `requireUserForAppShell()` for chrome that needs a resolved **company** label.
- **App shell** at `apps/web/components/app-shell.tsx` — ~268px sidebar with
  soft shadow, grouped nav (**Workspace** vs **Administration**) via
  `<NavLinks sections={…}>`, active route ring/highlight from `usePathname()`,
  `<UserMenu>` at the sidebar bottom (initials avatar, workspace line, role chip,
  Settings + no-JS **Sign out** via `<form action={logoutAction}>`). Top bar:
  **B Visible** product title + workspace name subtitle (no decorative health pill).
- **PageHeader** export from `app-shell.tsx` — larger title rhythm; per-page H1/subtitle/actions inside main.
- **Auth card** at `apps/web/components/auth/auth-card.tsx` — centered
  420px card layout used by login/forgot/reset/invite, with the brand
  mark above and an optional footer link below.
- **Auth forms**: `LoginForm`, `ForgotForm`, `ResetForm`, `InviteForm`,
  `ChangePasswordForm`, `InviteUserForm`, `CreateTenantForm`,
  `TestEmailForm`. All use `useActionState` for inline error display
  and disabled-while-pending buttons.
- **Sidebar (SUPER_ADMIN)** also includes **Email test** under
  `/settings/email-test` — SMTP diagnostics + send-test-email. The
  page reads `loadSmtpConfig()` and renders host/port/secure/maskedUser
  /from/replyTo as read-only fields (passwords are NEVER displayed),
  plus a single-input form. Errors render with sanitized SMTP error
  codes; success shows the SMTP message ID.
- **Form helpers**: `<FormError>` (red banner) and `<FormNotice>`
  (info/success banner) at `apps/web/components/auth/form-error.tsx`.
- **Brand mark** at `apps/web/components/brand.tsx` — square accent tile
  + wordmark + **Operations platform** eyebrow.
- **Design tokens** defined in `apps/web/app/globals.css` under `@theme`
  (CSS custom properties): `--color-bv-bg`, `--color-bv-surface`,
  `--color-bv-border`, `--color-bv-text`, `--color-bv-muted`,
  `--color-bv-accent`, `--radius-bv` (12px), `--shadow-bv-card`,
  `--shadow-bv-elevated`, and `--font-sans` (Inter stack).
- **Utility helper** `cn()` at `apps/web/lib/cn.ts` (clsx + tailwind-merge).
- **Empty states** — reusable `<EmptyState>` at `apps/web/components/app/empty-state.tsx`
  for clients/vendors/estimates/PO list pages (replace bare table placeholders when a list is empty).
  Admin surfaces (Receipt OCR index, email ingestion review grid with deterministic **PO suggestions** on unmatched rows, reconciliation spend inbox,
  vendor price alerts on the dashboard) use the same card language + next-step CTAs where helpful.
- **Dashboard** (`apps/web/app/(app)/dashboard/page.tsx`) — **operations command center** layout (display-only; no workflow derivation changes). Server-loaded **real counts** via `getDashboardMetrics()`: open estimates, open POs, vendor price notifications, pending OCR (ADMIN+), unreconciled POs, recent `audit_logs`. **Hierarchy (top → bottom):** dark **`DashboardCommandSummary`** rail (actionable / blocked / stale / unresolved counts from existing queue rows — chips link `?queue=` filters) → slate **work queues** panel (two columns on `xl`: **`DashboardOperationalQueues`** + **`DashboardPoLifecycleQueues`**) → inline quick actions + compact metric chips → vendor price alerts when count &gt; 0 (collapsed `<details>` when empty) → collapsed **Recent records** + **Audit timeline**. Queue UX: sticky filter pills, **Needs operator** rail (blocked/stale/unresolved, max 8), priority bucket order (OCR/recon/mail before customer-wait), dense shared **`DashboardQueueRow`** (grid row, stale badge, CTA column). Filters: `?queue=stale|blocked|unresolved|mine`. PO detail **`PoLifecycleRail`** unchanged. Legacy quote/PO/invoice dashboard widgets remain out of layout; fetch helpers kept for Vitest.
  **First-login onboarding card** (`components/onboarding/onboarding-checklist-card.tsx`)
  shows a dismissible checklist whose completion state is computed from real tenant data
  (`lib/onboarding/checklist-data.ts`; dismiss cookie via `lib/onboarding/dismiss-action.ts`).
  Existing **VendorPriceAlerts** list + **SpendOperationAlerts** strip remain beneath the summary (no fake stats).
  **Browser smoke** (operator laptop only — `%USERPROFILE%\.bvisible-smoke.env` on Windows, `~/.bvisible-smoke.env` elsewhere; **not** server `.env`): verify with `bash server-scripts/smoke/check-smoke-env.sh`, then `smoke:core`, `smoke:vendor-normalization`, `smoke:po-lifecycle`, or wrapper `bash server-scripts/smoke/run-smoke.sh all`. Agents skip smoke without the operator password. See `DEBUGGING.md` § 0c.
  **Regression bundles** (operator/CI): `verify:po-lifecycle`, `verify:workflow-queues`, `verify:estimate-pricing`, `verify:estimate-quote`, `verify:estimate-po-flow`, `verify:estimate-invoice-flow`, `verify:ocr-reconciliation-flow` — see `DEBUGGING.md` § 0b.
- **Presentation status labels** — internal enums stay as-is in Prisma; user-facing copy maps through
  `apps/web/lib/ui/status-labels.ts` (e.g. OCR jobs, email ingest, reconciliation, estimate/PO/**invoice** statuses)
  so lists and admin grids read like operations software, not raw enum strings.
- **Estimates list** (`/estimates`) — compact table: job, client, **Workflow** chips (awaiting customer, approved waiting PO, **Potentially ready — open to confirm.** when PO+invoice on approved rows — heuristic only), status, sell, **Next** action (empty drafts → **Add lines** with `#estimate-line-grid`), quick links (quote / PO / invoice by status). **New estimate** (`/estimates/new`) — numbered 1·2·3 helper + small form; routes to create client when none exist.
- **Estimate editor** at `apps/web/app/(app)/estimates/[id]/{editor,line-grid,totals-panel,vendor-catalog-intel-panel,catalog-item-picker}.tsx`:
  - **Daily workflow strip** (`EstimateDailyWorkflowStrip`) — Draft → Quote sent → Approved → PO → Invoice with one primary CTA; header mirrors the same primary link (no duplicate Preview/Send buttons).
  - **Estimating phase layout (Draft / Sent / Rejected)** — editor (line grid first) renders **above** fulfillment/quote panels; quote stack lives in collapsible **Quote & customer response** (`EstimateCollapsibleSection`, open when Sent). **Approved / Finalized** keep fulfillment + quote panels above the editor.
  - **Closeout checklist** (`EstimateFinalizeChecklistPanel` + `buildEstimateFinalizeChecklist`) — compact row gates: quote approved, PO linked, QBO # on every PO, reconciliation clean, invoice paid (**Optional**); **Ready to finalize** badge when shared gates pass (`evaluateEstimateFinalizeGates`); finalize still explicit in totals panel; Save disabled while FINALIZED.
  - **Layout order (editor column)** — line grid first (keyboard), then catalog picker, pricing helper, vendor intel rail.
  - **Vendor intelligence rail** (`vendor-catalog-intel-panel.tsx`) — compact idle copy; **Cheapest** / **Preferred** cards with premium delta, **match reason + confidence** from `materialMatch`, **unit conversion guidance**, **latest-per-vendor** table only when **>1** vendor row (source vendor + unit basis via source labels), explicit **Apply** actions (`onMouseDown` preventDefault — no focus steal). Unresolved matches show guidance only — nothing auto-applies.
  - **Workflow rail** (`components/workflow/estimate-workflow-rail.tsx`) above the editor: estimate lifecycle
    (Draft → Sent → Approved → Finalized), linked PO summary + QBO gap copy, finalize gate explanation,
    and contextual **next recommended action** when something blocks progress.
  - Two-column desktop layout: line grid on the left, sticky totals
    panel (320px) on the right. Single-column on narrow widths.
  - **Material-row vendor intelligence** — debounced `lookupVendorCatalogForEstimateAction` when a material description/qty cell is focused; see bullet above for shipped UX (cards, table, explicit Apply). Suggestions never overwrite cells or steal keyboard navigation from `makeGridKeyHandler`. **Browser smoke:** `pnpm --filter @bvisible/web run smoke:vendor-normalization` (requires `BVISIBLE_*` env; see `DEBUGGING.md` § 0c).
  - **Catalog items** (`catalog-item-picker.tsx`) — search tenant `ShopMaterialItem` rows. MATERIAL rows show **unit cost** (what **Apply** writes: preferred vendor’s latest linked snapshot when set, else cheapest latest, else internal item cost) plus read-only **cheapest** and **preferred** lines when vendor history exists. **Sell hint** uses catalog markup % or sell override as guidance only (estimate total still follows **`computeEstimate`**). **Apply** patches the focused line once per explicit click — no hooks while typing.
  - **Pricing helper** (`pricing-helper-panel.tsx`) — compact card under the catalog: **Square footage**, **Sheet goods** (4×8 / 5×10 + 75% / ceil rule), **Roll material** (nominal roll sq ft, optional minimum billable sq ft), **Banner** (R-EST-03). Shows plain-English explanation + optional $ fields; **Apply to focused line** only (no auto-fill on keystroke). Same focus target as catalog **Apply**.
  - Grid uses `<table>` semantics (one DOM node per cell) and the shared
    cell primitives at `apps/web/components/grid/cell-input.tsx` —
    `<CellInput>` for text, `<NumericCell>` for money / qty / multiplier.
    `<NumericCell>` keeps an internal "raw" string so users can type
    invalid intermediate states (`"1."`); on blur it parses, snaps back
    on garbage, and reformats on success.
  - Per-row controls: × (delete), ↑ / ↓ (reorder).
  - Add-row buttons at the bottom — one per `EstimateLineKind`
    (Material / Machine / Labor / Design / Install / Misc). Pressing
    Enter on the last row also appends a row of the same kind.
  - Totals panel shows breakdown by kind + raw cost + (editable) design
    flat fee + (editable) sell multiplier + final sell price. An amber
    note appears when the multiplier deviates from the default 3.000×.
  - Save button is the primary CTA in the totals panel, disabled until
    the editor is dirty. `Cmd/Ctrl+S` anywhere inside the editor saves.
  - **Customer quote** — detail header primary CTA from **`getEstimateEditorPrimaryAction()`** (Preview / Send track / PO / invoice anchors). **`/estimates/[id]/preview`** for print/PDF and **`#customer-send`** email block.
  - **Staff-facing quote visibility stack** — `EstimateFulfillmentPanel.tsx` leads with **`EstimateOperationalStepRail`** + **`EstimateRelationshipFlowStrip`** (Quote→PO→Invoice→Paid) + fulfillment/next-step rails + anchored CTAs (`#estimate-create-po`, `/purchase-orders/new?estimateId=`) grounded on **`purchase_orders.estimateId`** + **`Invoice.estimateId`**, explicit **Create invoice** when **`APPROVED`** without a linked invoice, linked invoice chips — plus timeline acceptance timestamps (never status-alone guesses). Immediately after, **`EstimateQuoteResponseSummary.tsx`**
    (`apps/web/components/estimate/estimate-quote-response-summary.tsx`) keeps responders/name/note/timing states glanceable ahead of the public-link tooling.
  - **Estimate timeline (operations)** — `EstimateTimelineSection.tsx` renders chronological merges from **`estimate_timeline_events`** plus whitelist **`audit_logs`** (`estimate_sent_to_client`, public quote views, status transitions, finalize/unfinalize); duplicated Accept/Decline audits intentionally suppressed because **`QUOTE_*`** timeline rows already cover customer outcomes — avoids fake duplicates while respecting “real rows only”.
  - **Public customer link** — panel (`components/estimate/estimate-quote-link-panel.tsx`)
    manages **`/quote/[token]`** shares; empty state links to **Preview → Send to customer** before first issuance.
  - **Public quote page** (`app/quote/[token]/`) — customer **`QuoteDocument`** plus **`print:hidden`** Accept /
    Decline panel (optional name + note); finalized estimates with no prior customer response show a responses-closed
    message instead of buttons.
- **Reusable grid keyboard helper** at
  `apps/web/lib/keyboard/grid-nav.ts` (`makeGridKeyHandler`). Any grid
  attaches a single `onKeyDown` to its root and tags cells with
  `data-cell-row` / `data-cell-col` / `data-cell-grid`. Enter steps
  down (auto-appends a row when at the bottom); Shift+Enter steps up;
  Tab is left to the browser default. Arrow keys are intentionally
  not hijacked — that would break caret navigation inside text inputs.
- **Sidebar nav** for tenant users now shows
  `Dashboard / Estimates / Purchase orders / Invoices / Clients / Vendors / Items` in
  `BASE_NAV`. ADMIN adds `Users`, `Email ingestion`, **`Receipt OCR`**
  (`/admin/ocr-review`), and **`PO reconciliation`** (`/admin/reconciliation`); SUPER_ADMIN
  additionally adds `Tenants`, `Inboxes`, and `Email test`.
- **Email ingestion review** at `/admin/email-ingestion` (ADMIN+):
  filterable buckets (Unmatched / Matched / Failed / Dismissed / All)
  with count badges. On **Unmatched**, secondary reason chips filter by
  attachment rejected / ambiguous match / OCR pending (counts from
  `reviewReasonCodes`). Per-row collapsed layout: compact status + short
  reason chips, subject/sender, optional compact PO suggestions, and
  always-visible **Link** (primary) / **Retry** / **Dismiss** (Body expand
  for snippet + attachments only). Enter on a focused row toggles Body.
  Sidebar carries the read-only inbox config card and Recent ticks.
- **Receipt OCR review** at `/admin/ocr-review` (ADMIN+): **operational approval workspace** —
  dense queue rows (status chips, vendor, line count, relative updated time, **Stale** badge after
  2d via `STALE_OCR_REVIEW_MS`), tab pills with always-on counts (Queue / Confirmed / Rejected / Failed),
  optional **Stale** sub-filter on Queue (`?stale=1`), “Showing N” summary, **Review →** column,
  and `j`/`k` keyboard focus between row links (Shift+click opens). Detail `/admin/ocr-review/[id]`:
  two-column layout — left: context strip (PO, vendor, attachment), compact **line candidate table**
  (qty / price hierarchy, parse + confidence chips, collapsed source line), collapsible metadata +
  OCR preview; right: **sticky decision rail** (Approve / Reject, trust copy, **Next steps** +
  **Review next →** when another queue job exists, Ctrl+Enter shortcut). **FAILED** vs **Needs review**
  are visually distinct. Confirmed rows link to PO reconciliation. No workflow logic changes — polish only.
  **Regression:** `verify:ocr-quality`, `verify:ocr-reconciliation-flow`. **Smoke:** `smoke:vendor-normalization`.
- **PO reconciliation** (ADMIN+): inbox `/admin/reconciliation`, detail
  `/purchase-orders/[id]/reconciliation` (includes a **Spend alerts** table with `OPEN` /
  `SUPERSEDED` / `DISMISSED` chips for audit). The **dashboard** links into this inbox via the
  unreconciled PO metric for admins; **SpendOperationAlerts** (`OPEN` only) lists actionable rows on `/dashboard`.
  Humans confirm pairs, accept variance, reject mappings, manually merge unmatched
  receipt / PO rows, dismiss alerts, or stamp the PO reconciled — **no automatic PO /
  estimate mutation**.
- **Per-tenant inbox config** at `/admin/tenants/[id]/email-inbox`
  (SUPER_ADMIN). Two-column layout: left card carries the form (host,
  port, mailbox, username, password, poll interval, TLS toggle,
  enabled toggle), right rail carries diagnostics + recent ticks +
  recent ingested emails. The password input is **always rendered
  empty** — an empty submit keeps the existing AES-256-GCM ciphertext;
  a non-empty value rotates it. The placeholder shows
  "•••••••• (configured)" so the operator can see at a glance that a
  cipher is on file. Three buttons: **Save changes**, **Test
  connection**, **Delete inbox** (with confirm). Test result panel
  renders inline with sanitized friendly messages — `Connected.`
  (with mailbox count + duration), `Authentication failed.`, `Mailbox
  not found.`, `Connect failed.`, `TLS error.`, or a generic message
  for unclassified failures. Form errors show via `<FormError>`;
  success via `<FormNotice tone="success">`.
- **All-inboxes overview** at `/admin/email-ingestion/inboxes`
  (SUPER_ADMIN). Top stat strip: configured / healthy / errored /
  disabled counts. Table: every tenant + status chip (`healthy` /
  `errored` / `disabled` / `not configured`) + masked username +
  last-polled timestamp + per-row "Configure" / "Edit" link to the
  tenant's `/admin/tenants/[id]/email-inbox`.
- **Tenants page** (`/admin/tenants`, SUPER_ADMIN) now includes an
  "Inbox" status column with the same chip palette and a per-row
  "Email inbox" link to the tenant's inbox config page.
- **Purchase order editor** at
  `apps/web/app/(app)/purchase-orders/[id]/{editor,line-grid,meta-panel,timeline-panel,attachments-panel}.tsx`:
  - **Execution workspace** (`components/po/po-execution-workspace.tsx`): sticky operations bar at the top of `/purchase-orders/[id]` — primary/secondary CTAs (merged lifecycle + receipt actions via `lib/po/po-receipt-next-actions.ts`), compact vendor-order lifecycle chips, vendor/receipt/blocker pills, collapsible receipt-pipeline strip (admin), inline **`PoLifecycleControls`**. Replaces the former stacked **`PoReceiptWorkflowSummaryCard`** + full **`PoLifecycleRail`** on the detail page (those components remain for reuse; summary card logic is shared).
  - **Originating estimate** (`PoEstimateOriginSection`): collapsed `<details>` below the editor when `estimateId` is set (quote summary + link to `/estimates/[id]`).
  - Same two-column layout as the estimate editor: **lines first**, then attachments, internal notes, timeline on the left; sticky meta panel (~300px) on the right with **latest vendor reply** when present.
  - Line grid reuses the **shared cell primitives** (`<CellInput>` /
    `<NumericCell>`) and the **same `makeGridKeyHandler`** from the
    estimate grid — Enter steps down (auto-appending a row of the same
    kind at the bottom), Shift+Enter steps up, Tab is browser-default.
    Per-row × / ↑ / ↓ controls match the estimate editor.
  - **Meta panel**: cached subtotal, save button (disabled until dirty —
    `Cmd/Ctrl+S` also saves), QBO PO number input that **commits on blur**
    (via `setPoQboNumberAction`; UI hint warns "save first" if the field
    is touched while still dirty), vendor `<select>` (commits on change
    via `setPoVendorAction`), linked-estimate row (read-only — links to
    the estimate page), six-button status grid (one button per
    `POStatus`; the active status is the highlighted button), danger
    zone with soft-delete (ADMIN+ only — hidden for USER).
  - **Attachments panel**: kind picker + file `<input>` (allowed
    extensions surfaced via `accept`); inline list of existing
    attachments (filename, kind tag, MIME, size, date, uploader) with a
    download link to `/api/po/[id]/attachments/[attachmentId]` and a
    "Remove" button. Submission is a `<form action={uploadPoAttachmentAction}>` 
    with the standard `useActionState` busy / error / success treatment.
  - **Timeline panel**: newest-first list of `POEvent` rows with an icon
    derived from `POEventKind` and a human-readable timestamp; inline
    "Add note" form posts to `addPoNoteAction` and re-renders the
    timeline via `revalidatePath`.
- **Estimate totals panel** exposes the **PO bridge**: anchored **Linked POs** (`#estimate-linked-pos`) showing vendor, cached PO total, short `createdAt`, status chips, plus deterministic reconciliation/receipt OCR badges when rows exist; anchored **Create PO from estimate** (`#estimate-create-po`, **`APPROVED` gate** + explanatory copy beforehand); explicit **Link existing purchase order** (`/purchase-orders/new?estimateId=`); and the **Finalize / Unfinalize** controls with shared R-EST-04 gate copy from `evaluateEstimateFinalizeGates` (Save disabled while FINALIZED). Unfinalize stays ADMIN+ only.
- **Status pills** for both `EstimateStatus` (now including `FINALIZED`
  in slate) and `POStatus` (DRAFT / SENT / ORDERED /
  PARTIALLY_RECEIVED / RECEIVED / CANCELED) live in the same six-tone
  vocabulary as the rest of the app.
- **Vendor list** at `/vendors` is a single-table view (name, email,
  phone, PO count, updated). Vendor names link to `/vendors/[id]`.
  New vendor form at `/vendors/new` is the
  standard single-column auth-card pattern.
- **Vendor detail + pricing history** at `/vendors/[id]`: below the
  header card, an append-only **Price history** table (newest first)
  with extraction method, confidence, amount, optional unit, link to the
  matched PO when the source ingested email recorded `matchedPurchaseOrderId`,
  and a heuristic "Lower vs prior" flag comparing each row to the next
  newer observation for the same normalized item.
- **Items catalog** (`/items`, `/items/new`, `/items/[id]`): tenant estimating catalog (`ShopMaterialItem`) — `EstimateLineKind`, `ShopCatalogUnit`, internal cost / markup / optional sell override, default qty + optional machine pointer (`machineId`), preferred vendor, inactive flag; aliases (`ShopMaterialItemAlias`). **MANUAL** vendor pricing + linkage applies when `kind = MATERIAL` (append-only `VendorPriceHistory`, optional `vendorSku`). List/new/detail surface pricing settings, vendor grid, aliases, history & guidance. **USER** can browse; **ADMIN+** mutates catalog + MATERIAL vendor rows.
- **Estimate vendor intelligence rail** (`vendor-catalog-intel-panel.tsx`): surfaces receipt-backed OCR-approved stats when a vendor catalog primary exists **and** highlights linked managed items with optional **Use this cost** (dispatched `unitCostCents` patch only — never automatic).
- **Dashboard vendor price alerts** (`VendorPriceAlerts` on `/dashboard`):
  amber banner listing unread `VendorPriceNotification` rows with old/new
  prices, vendor link, subject line, PO link when available, and a
  **Dismiss** `<form action={dismissVendorPriceNotificationAction}>`.
  Nothing auto-dismisses (R-NOTIF-01). Automated regression: `pnpm run test`
  (`apps/web/lib/vendor-pricing/*.test.ts`) plus optional DB script
  `server-scripts/db/.verify-vendor-pricing.sh` — see `DEBUGGING.md` § 9.

## Layout (web)

```
┌─────────────────────────────────────────────────────┐
│ Sidebar (fixed left, 240px)                         │
│  - Logo                                             │
│  - Primary nav (Dashboard, Clients, Estimates, …)  │
│  - Pinned saved views                               │
│  - User menu (bottom)                               │
├─────────────────────────────────────────────────────┤
│ Topbar (search, breadcrumbs, notifications bell)    │
├─────────────────────────────────────────────────────┤
│ Main content (cards, tables, forms)                 │
└─────────────────────────────────────────────────────┘
```

A **sliding drawer** (right-edge, 480–640px) opens for:

- Quick edit of any record (estimate line, vendor price, PO line item).
- Detail view without losing the list context.
- Notification details / dismiss flow.

Drawers stack max 1 deep (no nested drawers). ESC closes; overlay click
closes; URL deep-linking is supported via query params (`?drawer=estimate-42`).

## Component vocabulary

| Pattern | Use it for |
|---|---|
| **Card** | Group of related fields. Soft shadow, rounded `--radius-lg` (12px). |
| **Table** | List views. Always with search + filter pills + column sort. |
| **Badge** | Status, role, count. Six tones: neutral, info, success, warn, danger, accent. |
| **Empty state** | Every list view. Icon + 1-line headline + 1-button CTA. |
| **Modal** | Destructive confirm only. For everything else, use the drawer. |
| **Toast** | Async result (saved, deploy queued). Auto-dismiss 4s. |
| **Skeleton** | Show during initial load, never spinners alone. |

## Visual rules

- **Rounded corners** everywhere: `4px` for badges/inputs, `8px` for buttons,
  `12px` for cards, `16px` for the drawer.
- **Soft shadows** (`0 1px 2px`, `0 4px 12px` for elevated). No harsh borders.
- Single accent color used sparingly — primary CTA, links, focused state.
- 8-pt spacing scale (4, 8, 12, 16, 24, 32, 48).
- Fonts: a clean sans (Inter) at 14/16/18/24/32. Numbers tabular for tables.

## Tables

- Server-paginated, cursor-based.
- Top toolbar: search box (left), filter pills (center), saved view button
  (right).
- Empty state replaces the table body when 0 rows.
- Row click opens the drawer; double-click navigates to the full detail page.

## Forms

- Single-column inputs. Fieldsets grouped by purpose.
- Validation errors inline below the field, in `danger` tone.
- Primary action right-aligned at the bottom; secondary "Cancel" to the left.
- Save buttons disabled until the form is dirty AND valid.

## Notifications

- Bell icon in topbar with unread count.
- Vendor lower-price notifications (R-NOTIF-01) **never auto-dismiss** —
  badge persists across reloads.

## Anti-patterns (don't ship these)

- Raw JSON dumps in the UI — always render meaningful fields.
- Endless modals over modals.
- Tooltips that hide critical info — put it on the page.
- Spinner-only loading states.

## Mobile web

The web app must remain usable at 768px+. The sidebar collapses to a hamburger
below that. The full-power workflow remains the desktop. The dedicated mobile
app (`apps/mobile`) handles field/install/receipt capture — see
`MOBILE_APP.md`.
