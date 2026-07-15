# Estimate & PO Redesign Plan — matching the customer's reference system

Date: 2026-07-15
Source: full audit of the customer-built reference app at
`b-visible-pricing-external-62jlgjqmo.vercel.app` + its Google Sheet
("B Visible Formula", ID `1mvk26cMgwpPE3nEYSHmOtKTNcoRvTvdIJGNssDR1yiI`).

---

## 1. What the customer built (audit findings)

### 1.1 Home hub
A task-first launcher ("What do you need to do?") instead of a dashboard:
- **Create a new estimate** (Office role)
- **Order materials** (Shop role) — purchasing flow
- **Pricing backend** — Google Sheet sync + overrides + operating rates
- **Purchase inbox** — Gmail order/supplier-confirmation tracking
- **Scan & receive** — mobile receipt photo → approve material prices
- **Manage users** — passwordless email invites, roles (Estimator / Shop / Administrator)
- **Classic estimator** — the full "pricing desk" workspace

Every page header shows live Sheet status ("Live Sheet • 250 materials • 3 saved
bundles • 222 vehicle wraps") and the signed-in user + role ("Estimator",
"Requested by", "Reviewer", "Receiver").

### 1.2 Simple estimate flow (`/estimate/new`)
- Job name + Customer + **Markup %** up top. Line-by-line building.
- **"Add line" always offers exactly 3 options** ("the permanent estimate structure"):
  1. **Materials / ready items** — tabs: Full materials (sheet catalog),
     Saved bundles, Vehicle wraps (222 vehicles at flat prices).
  2. **Custom build** — opens the classic estimator, result returns as one line.
  3. **Square footage items** — Dura-Bond, reflective, wrap, banner, coroplast
     (item → width × height ft × qty × $/sq ft from the Sheet).
  Plus an optional **AI generate** entry ("describe a sign → suggested build").
- Sticky totals bar: Subtotal / Markup / Estimate Total / **Save estimate**.

### 1.3 Classic estimator (`/estimate/classic`)
Cost-up calculator ("Build the price from the real cost"):
- Sections: **Ready items & bundles** (+ *Save this estimate as a ready item/bundle*),
  **Price by square foot**, **AI generate**, **1. Materials** (search 429 sheet
  materials, + to add, editable unit $ / qty), **2. Machines** (click machine →
  hours row; rates from Sheet), **3. Labor & installation** (fixed shop rates:
  shop labor $50/hr, design $150 flat, on-site $150/installer/hr, round-trip
  travel hours, installer count).
- **Live price rail**: Materials / Machine cost / Shop labor / Design /
  Install + travel → **True cost** → editable **Markup %** (default 200) →
  **Recommended price** ("Final = total cost × 3.00").
- **Continue to estimate** → "READY FOR QUICKBOOKS" panel:
  - **Cost check** (production / design / installation cost, markup, customer price)
  - **QuickBooks-ready block** — copy-paste text allocating the sell price to
    exactly three QB lines: `Sales`, `Design`, `Installation`
    (`QB_ESTIMATE_START … Line=Sales|…|1|629.09| … QB_ESTIMATE_END`).
- **Optional material suggestions** driven by sign type (Sheet tab
  "Estimator Recommendations").

### 1.4 Purchasing flow (`/purchasing`)
- "What materials do you need?" — one search box (misspelling-tolerant),
  148 orderable materials from the Sheet's **Vendor Catalog** tab.
- Each result shows **lowest price + vendor**, auto-picked; vendor changeable
  per line; custom material entry allowed.
- **Review order** groups lines by vendor → "N purchase orders will be created";
  vendor cards show contact emails; notes for suppliers.
- Buttons: **Save as draft only** or **Create PO & email from
  estimates@bvisible.us** (Gmail Workspace OAuth required once).
- Result: sequential PO numbers (#409, #410), branded **PDF per PO**
  ("follows the uploaded Be Visible purchase-order format"), email status.
- "Retail items open in the correct cart" — Amazon/Home Depot items are carted
  rather than emailed.

### 1.5 Purchase inbox (`/purchasing/inbox`)
Gmail order tracking: imported supplier confirmations + Amazon/Home Depot
orders, AI summary per email, detected items with SKU/ASIN + match confidence,
link to original Gmail message.

### 1.6 Scan & receive (`/purchasing/receipts`)
3-step mobile receiving: photograph receipt → review detected lines → **choose
pricing action** (update the matched material's price or track purchase only).
Everything operator-approved.

### 1.7 Pricing backend (`/admin`)
- **The Google Sheet supplies the catalog.** Status card (Connected, last sync),
  counts (429 materials, 4 machines, 1 override), **Refresh Sheet** button,
  auto-refresh every 5 min in the estimator.
- **Operating rates** editable in-app: shop labor, design flat, installation
  $/person/hr, default markup %.
- Materials/Machines tables: **Sheet Price vs Active Price**, Vendor, Source
  badge; **Edit → app override** ("changes the app price only; reset anytime to
  follow the live Google Sheet again").

### 1.8 The Google Sheet ("B Visible Formula") — the business engine
Key tabs:
- **Meterial price** — estimate-side catalog: item, category, price per vendor
  (S&F / Grimco / Letra lit), computed Cheapest Price + Cheapest Vendor.
- **Vendor Catalog** — purchasing-side catalog: catalog ID, category,
  subcategory, thickness/spec, size/unit, per-vendor prices + Other/Other
  Vendor, cheapest price.
- **Machinary Price** — machine hourly rates.
- **Sq Ft Pricing** — item ID/name, category, $/sq ft, waste %, **default
  machine**, **shop minutes per sq ft**, active flag.
- **Vehicle Pricing** — 222 vehicles: billable sq ft, design units, production/
  install hours, installers, waste %, flat price in notes.
- **Estimator Packages / Package Components** — saved bundles + component lines
  (material or square-foot component, qty/hours, optional flag).
- **Estimator Recommendations** — sign type → suggested materials + reason.
- **ALIASES** — "AI name" → canonical sheet material name.
- **AI_INPUT** — JSON job spec + system instruction (their AI estimate path).
- **Vendor Directory, PO Log, PO Line Log, Purchase Inbox, Purchase Items** —
  purchasing records written back by the app.
- **Formula / TEMPLATE / per-job tabs** — the original manual calculator.

---

## 2. What B Visible has today (relevant)

- `packages/pricing` engine: integer cents/milli-qty, `computeEstimate`
  (multiplier default ×3, design flat $150), sqft/sheet/roll/banner
  calculators, machine rates in DB (same 4 machines & rates).
- Estimate editor: spreadsheet-like line grid (MATERIAL/MACHINE/LABOR/DESIGN/
  INSTALL/MISC), catalog picker (ShopMaterialItem), pricing helper panel,
  vendor-intel rail (OCR/email-derived price history), totals rail,
  quote preview + public accept/decline links, finalize gates.
- PO system: PO from approved estimate, vendors, attachments, QBO number
  (manual), email ingestion (IMAP), receipt OCR + reconciliation, lifecycle
  queues, dashboard command center.
- No Google Sheet integration; catalog lives in Postgres
  (`ShopMaterialItem`, `VendorCatalogItem`, `VendorPriceHistory`).

## 3. Gap analysis

| # | Customer's flow | B Visible today | Gap |
|---|---|---|---|
| 1 | Google Sheet is the live pricing catalog (per-vendor prices, cheapest vendor, sq-ft rates, vehicles, bundles, rates) | Postgres catalog + OCR/email observations | **New: Sheet sync service** (read Sheet → catalog; app overrides; write-back of PO logs optional) |
| 2 | Task-first home hub with big role paths | Ops dashboard command center | **New: launcher home** (keep dashboard for ops, add hub as landing) |
| 3 | Line-by-line estimate w/ 3-option add-line chooser | Free-form grid + pickers | **New guided add-line flow** on top of existing grid |
| 4 | Ready items: bundles + vehicle wraps as one-click lines | Catalog picker (flat items only) | **New: bundles + vehicle wrap entities** (from Sheet tabs) |
| 5 | Sq-ft items with $/sq ft, waste, default machine, shop min/sq ft | Pricing helper (sqft/sheet/roll/banner) patches focused row | **Extend helper into first-class sq-ft item path** driven by Sheet rates |
| 6 | Custom build = cost sections + live price rail + markup % | Same math, different UX (grid) | **Optional re-skin**: sectioned cost view over the same engine |
| 7 | Markup % displayed (200%) | Multiplier ×3 | Same number, different label — **display both** (200% markup = ×3) |
| 8 | QuickBooks-ready block (Sales/Design/Installation allocation) | Allocated customer quote lines; QBO # manual on PO | **New: QB estimate block generator** (deterministic 3-bucket allocation) |
| 9 | Save estimate as ready item / bundle | — | **New: save-as-bundle** action |
| 10 | Purchasing: search → lowest vendor auto → split into per-vendor POs | Manual PO creation, one vendor per PO | **New: shop-order flow** (multi-vendor cart → N POs) — reuses existing PO model |
| 11 | PO PDF in company format + email to vendor from shop mailbox | PO detail page only | **New: PO PDF renderer + vendor email send** (SMTP exists) |
| 12 | Purchase inbox (Gmail import incl. Amazon/HD, AI summary, SKU match) | IMAP ingestion + PO matching + review queue | Mostly have it — **surface a simplified inbox UI**; Amazon/HD import optional later |
| 13 | Scan & receive (photo → lines → update price or track) | Receipt OCR + operator approval + price history | Have the backend — **new simplified 3-step mobile UI** |
| 14 | Estimator recommendations by sign type | — | **New: recommendations table** (from Sheet tab) |
| 15 | AI "describe a sign → draft build" | — | Deferred/optional phase |
| 16 | Passwordless invite users | Password auth + invites | Keep ours; no change needed |

## 4. Modification plan (phased)

### Phase A — Google Sheet integration (the foundation)
1. `packages/sheet-sync` (or `apps/web/lib/sheet-sync/`):
   - Google Sheets API (service-account; the shop shares the Sheet with the
     service account email — owner keeps editing in Google).
   - Tab readers: Meterial price, Vendor Catalog, Machinary Price, Sq Ft
     Pricing, Vehicle Pricing, Estimator Packages/Components, Recommendations,
     ALIASES, Vendor Directory.
   - Sync into new tenant-scoped tables: `sheet_catalog_items`
     (per-vendor prices, cheapest computed), `sheet_sqft_rates`,
     `sheet_vehicle_wraps`, `sheet_bundles` + `sheet_bundle_components`,
     `sheet_recommendations`, `sheet_aliases`, plus `sheet_sync_runs` audit.
   - **Active price = app override ?? sheet price** (`price_overrides` table,
     reset-to-sheet action) — mirrors their Pricing backend exactly.
   - Cron/tick sync (5 min) + manual **Refresh Sheet**; status surface.
2. Admin page **Pricing backend** (`/admin/pricing-backend`): status cards,
   operating rates (shop labor / design flat / install rate / default markup —
   new tenant settings), Materials/Machines tables w/ Sheet vs Active price +
   override modal.
3. Keep existing `ShopMaterialItem`/vendor-intel plumbing; Sheet catalog
   becomes an additional (primary) source feeding the same pickers.
   Existing OCR/email price observations remain as *intelligence*, and can
   later write suggestions back to the Sheet (deferred).

### Phase B — Guided estimate flow
1. **Home hub** route (`/hub` or make it `/` for non-admin roles): the six big
   cards, live Sheet status chip in header.
2. **New estimate wizard** (`/estimates/new` rework): job + customer +
   markup %; line list with sticky totals bar (Subtotal / Markup / Total /
   Save); **Add line → 3-option chooser**:
   - *Materials / ready items*: tabs Full materials / Saved bundles / Vehicle
     wraps (card grid, one-click add).
   - *Custom build*: opens the full editor (existing grid workspace) in
     "return a line" mode — result collapses to one estimate line group.
   - *Square footage items*: item dropdown from `sheet_sqft_rates`,
     W×H×qty → auto machine time (shop min/sq ft) + waste %.
3. Persist as today's `Estimate` + `EstimateLineItem` (line groups tagged with
   `sourceKind`: READY_ITEM / BUNDLE / VEHICLE_WRAP / SQFT_ITEM / CUSTOM) —
   pricing engine unchanged.
4. **Markup display**: show "Markup %" (multiplier−1) alongside ×; default
   from tenant operating rates; audit unchanged.
5. **QuickBooks-ready block** on preview/closeout: deterministic allocation of
   sell into Sales / Design / Installation buckets (same rule as reference:
   design lines → Design, install+travel → Installation, rest → Sales),
   copy button. (QBO API push stays future.)
6. **Save as ready item / bundle** from the editor (writes `sheet_bundles`
   locally; optional write-back to Sheet later).
7. **Recommendations panel**: sign type selector → suggested materials
   (add-one-click), from `sheet_recommendations`.

### Phase C — Shop order (purchasing) flow
1. `/purchase-orders/shop-order` (linkable from hub "Order materials"):
   search `sheet_catalog_items` (Vendor Catalog tab; fuzzy match via ALIASES
   + trigram), lowest-vendor auto-select, qty + vendor dropdown per line,
   custom material row.
2. **Review step**: group by vendor → preview "N POs will be created", notes,
   combined total.
3. Create N `PurchaseOrder` rows (existing model, `CREATED` events, vendor
   linkage by name match into `Vendor`).
4. **PO PDF** renderer (their branded format) at
   `/api/po/[id]/pdf` + "Open PDF" everywhere.
5. **Email PO to vendor** from the shop mailbox via existing SMTP
   (vendor emails from Vendor Directory tab); draft-only path too. Sent
   status on the PO timeline (`PO_EMAILED` event).
6. Existing PO detail/lifecycle/recon stays the master record underneath.

### Phase D — Receive & inbox simplification
1. **Scan & receive**: mobile-first 3-step page over existing OCR pipeline
   (upload → detected lines → approve: "update material price" writes
   override/observation, or "track only").
2. **Purchase inbox**: simplified list over existing email ingestion
   (vendor, subject, status, matched PO, items) + link to full admin review.
   Amazon/Home Depot parsing: later phase.

### Phase E — polish / deferred
- AI "describe a sign" draft builds.
- Sheet write-back (PO Log / Purchase Items tabs) so the owner's Sheet stays
  his reporting home.
- QBO API estimate push (replace copy-paste block).
- Amazon/Home Depot cart integration.

### Suggested order & sizing
A (foundation, ~1 wk) → B (core estimate UX, ~1–2 wk) → C (~1 wk) → D (~0.5 wk)
→ E as agreed. Each phase independently shippable; existing flows keep working
throughout (guided flow writes the same entities).

## 4b. Contractor handoff package (received 2026-07-15) — confirmed internals

Izzy received the customer's AI handoff zip (full source + checklists). It
confirms and sharpens the plan:

**Stack of the reference app:** Next.js 16 / React 19 / TS on Vercel, Supabase
(passwordless magic-link, invite-only; roles `admin` / `estimator` / `shop` /
`purchasing`), Google Sheet read **client-side via the GViz API** (no service
account), Google **Apps Script webhooks** bound to the Sheet for PO email +
package write-back, OpenAI API for AI estimate + receipt extraction.

**Critical pricing rule (must not regress when we port it):**
- `lib/pricing.ts`: markup applies to all lines **except `sqft` lines** —
  the Sq Ft Pricing tab prices **already include markup**. Never apply the
  general 200% markup to a square-foot line.
- Impact on Phase B: sq-ft-sourced lines must carry sell-side pricing
  directly (excluded from the estimate multiplier), unlike cost-up lines.
  In our engine terms: SQFT_ITEM line groups bypass `multiplierMilli`
  (or get multiplier 1.0 with an explicit sell price) — needs a small,
  tested extension to `computeEstimate` or allocation layer.

**PO email mechanics (reference):** Vercel server POSTs to an Apps Script
web app (Execute as: Me = the estimates@bvisible.us owner) which appends to
the Sheet's `PO Log` / `PO Line Log`, builds the PDF, and sends via Gmail
alias `estimates@bvisible.us`; missing vendor email returns "Setup required"
instead of pretending to send. For B Visible we can either (a) reuse this
Apps Script webhook as-is, or (b) send via our existing SMTP and write the
PO Log rows through the Sheets API — decide in Phase C (option b preferred:
one mail path, still keeps the owner's Sheet logs).

**Sheet contract:** exact tab names are intentional (incl. misspellings
`Meterial price`, `Machinary Price`) — our sync must match them verbatim.
Main pricing tab GID 934141133, Sq Ft GID 1845127301. Sheet is read via
public GViz today; our Phase A should upgrade to the Sheets API with a
service account for reliability, keeping the same tab contract.

**Reference data model (Supabase):** profiles, app_settings (operating
rates), rate_overrides (app-price overrides), estimate_packages +
package_components, estimates + estimate_lines, purchase_orders +
purchase_order_lines, received_receipts + received_receipt_items — maps
cleanly onto the Phase A/B tables proposed above.

**Business constants:** PO PDF must show *B Visible Signs & Printing,
97 Route 17M, Harriman, New York, 407-374-1527* (the deployed build still
shows the old Winter Garden FL address — known fix in their latest commit).
Initial admin sales@bvisible.us; production domain pricing.bvisible.us.

Handoff source is unpacked for reference during implementation; keep it out
of our repo (it's their codebase, we only port behavior).

## 5. Open questions for the customer
1. Should the Sheet stay the **source of truth** long-term, or eventually
   migrate into the app with the Sheet as an export? (Plan assumes Sheet = SoT.)
2. Sq-ft **waste %** is 0 everywhere today — keep the column live?
3. QuickBooks: is the copy-paste block enough for now, or is QBO API push a
   near-term requirement?
4. Vendor emails: send from tenant SMTP (estimates@bvisible.us) — confirm
   mailbox + template wording.
5. Do estimates from the guided flow still need the approval → PO → finalize
   gates, or is the simple Save enough for this customer? (Plan keeps gates,
   hidden behind the simple UI.)

## 6. Navigation decisions (confirmed with Izzy, 2026-07-15)

- **Home** — new sidebar route at the top; the task-first hub becomes the
  landing page after login.
- **Overview** — the existing dashboard, renamed. Sits directly under Home.
  No functional changes.
- **Estimates** — still lands on the estimate **list** (re-skinned), but
  **New estimate** opens the guided line-by-line flow instead of the bare
  job/client form. Row click opens estimate detail as today.
- **Purchase orders** — still lands on the PO **list** (re-skinned) with two
  actions: **Order materials** (new shop-order flow, one PO per vendor) and
  **From approved estimate** (existing path). Row click opens PO detail
  (lifecycle, QBO, reconciliation) as today.

## 7. Mockups
HTML mockups (open in a browser) live beside this file, all in the existing
app theme (globals.css tokens + app-shell sidebar):
- `mockup-1-home-hub.html` — new Home landing hub (above Overview)
- `mockup-2-new-estimate.html` — guided estimate + 3-option add-line chooser
- `mockup-3-custom-build.html` — sectioned cost build + live price rail + QB block
- `mockup-4-shop-order.html` — purchasing search → vendor-split PO review
- `mockup-5-pricing-backend.html` — Google Sheet sync admin
- `mockup-6-estimates-list.html` — re-skinned estimate list; New estimate → guided flow
- `mockup-7-po-list.html` — re-skinned PO list; Order materials → shop-order flow
