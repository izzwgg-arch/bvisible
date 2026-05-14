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
  (dashboard, settings, admin/users, admin/tenants). Edge middleware
  (`apps/web/middleware.ts`) gates the protected paths with a cookie
  presence check; the page RSC re-validates against the DB via
  `requireUser()`.
- **App shell** at `apps/web/components/app-shell.tsx` — fixed 240px
  sidebar, role-aware nav via `<NavLinks>` (active route highlighted
  from `usePathname()`), `<UserMenu>` at sidebar bottom (server
  component) with email/tenant/role label, Settings link, and a
  no-JS sign-out `<form action={logoutAction}>`. Topbar shows
  "B Visible" eyebrow + tenant label + healthy pill.
- **PageHeader** export from `app-shell.tsx` — per-page H1/subtitle/
  actions slot used inside main content. Pages own their own H1; the
  shell only renders chrome.
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
  + wordmark + "Operations" eyebrow.
- **Design tokens** defined in `apps/web/app/globals.css` under `@theme`
  (CSS custom properties): `--color-bv-bg`, `--color-bv-surface`,
  `--color-bv-border`, `--color-bv-text`, `--color-bv-muted`,
  `--color-bv-accent`, `--radius-bv` (12px), `--shadow-bv-card`,
  `--shadow-bv-elevated`, and `--font-sans` (Inter stack).
- **Utility helper** `cn()` at `apps/web/lib/cn.ts` (clsx + tailwind-merge).
- **Empty states** are inline in their tables (e.g. "No users yet.") —
  the dedicated `<EmptyState>` component lands when the first list view
  needs more than one line.
- **Estimate editor** at `apps/web/app/(app)/estimates/[id]/{editor,line-grid,totals-panel}.tsx`:
  - Two-column desktop layout: line grid on the left, sticky totals
    panel (320px) on the right. Single-column on narrow widths.
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
- **Reusable grid keyboard helper** at
  `apps/web/lib/keyboard/grid-nav.ts` (`makeGridKeyHandler`). Any grid
  attaches a single `onKeyDown` to its root and tags cells with
  `data-cell-row` / `data-cell-col` / `data-cell-grid`. Enter steps
  down (auto-appends a row when at the bottom); Shift+Enter steps up;
  Tab is left to the browser default. Arrow keys are intentionally
  not hijacked — that would break caret navigation inside text inputs.
- **Sidebar nav** for tenant users now shows
  `Dashboard / Estimates / Purchase orders / Clients / Vendors` in
  `BASE_NAV`. ADMIN adds `Users`, `Email ingestion`, **`Receipt OCR`**
  (`/admin/ocr-review`), and **`PO reconciliation`** (`/admin/reconciliation`); SUPER_ADMIN
  additionally adds `Tenants`, `Inboxes`, and `Email test`.
- **Email ingestion review** at `/admin/email-ingestion` (ADMIN+):
  filterable buckets (Unmatched / Matched / Failed / Dismissed / All)
  with count badges. Per-row expand panel renders the body snippet
  inside `<pre>` (never `dangerouslySetInnerHTML`), the per-attachment
  download links (skipped attachments show their `skipReason`), and
  inline forms for **Link** (PO combobox), **Retry**, and **Dismiss**.
  Sidebar carries the read-only inbox config card (host / port /
  mailbox / `lastPolledAt` / `lastErrorAt` / `lastErrorMessage`;
  password is **never** displayed) and a "Recent ticks" list. The
  page header includes a "Configure inbox" CTA when the viewer is
  SUPER_ADMIN.
- **Receipt OCR review** at `/admin/ocr-review` (ADMIN+): queue + detail views for
  `OcrDocument` suggestions (`REVIEW_REQUIRED`), truncated OCR preview, editable line
  picks, **Approve** (writes `VendorPriceHistory` via `OCR_APPROVED`) vs **Reject**.
  Approving also enqueues a replay-safe `POReconciliation` snapshot for that PO batch.
- **PO reconciliation** (ADMIN+): inbox `/admin/reconciliation`, detail
  `/purchase-orders/[id]/reconciliation` (includes a **Spend alerts** table with `OPEN` /
  `SUPERSEDED` / `DISMISSED` chips for audit), dashboard summary cards + operational spend alert
  strip (`OPEN` only). Humans confirm pairs, accept variance, reject mappings, manually merge unmatched
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
  - Same two-column layout as the estimate editor: line grid + notes +
    attachments + timeline on the left, sticky meta panel (320px) on the
    right.
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
- **Estimate totals panel** now exposes the **PO bridge**: a "Linked
  POs" list (with a status pill per linked PO and a deep link to the PO
  page), a "Create PO from estimate" form (optional vendor picker; submits
  `createPoFromEstimateAction` and navigates to the new PO on success),
  and the **Finalize / Unfinalize** buttons. Finalize is disabled with an
  inline reason when R-EST-04 isn't satisfied (no linked PO, or no
  qboPoNumber on any linked PO). Unfinalize only renders for ADMIN+.
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
