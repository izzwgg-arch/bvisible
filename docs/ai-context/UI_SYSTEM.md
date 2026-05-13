# UI_SYSTEM — B Visible

The look, feel, and behavior of the web app.

## Brand & vibe

- **B Visible** branded throughout — logo top-left of the sidebar, favicon,
  title bar.
- **SaaS 2026 professional look:** clean, minimal, lots of whitespace, calm
  color palette with a single bright accent.
- **Practicality is king, user-friendly is queen.** Don't add a flourish that
  costs the user a click.

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
