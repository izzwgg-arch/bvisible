# ESTIMATE_ENGINE — B Visible

The pure pricing rules. Implementation lives in `packages/pricing/`. All
formulas operate on **integer cents** for money and **integer milli-units**
for quantity (`qtyMilli = qty * 1000`); the UI converts to dollars/feet/decimal
qty for display only.

## Implementation map

| File | Exports | What it computes |
|---|---|---|
| `packages/pricing/src/types.ts` | `LineKind`, `LineInput`, `EstimateInput`, `EstimateOutput`, `BreakdownByKind` | Shared shapes. |
| `packages/pricing/src/money.ts` | `formatMoney`, `parseMoney`, `roundCents` | Display + parse helpers, banker's rounding via `Math.round`. |
| `packages/pricing/src/qty.ts` | `qtyToMilli`, `qtyFromMilli`, `formatQty`, `parseQty` | Quantity scaling (1.5 → 1500). |
| `packages/pricing/src/sqft.ts` | `computeSqft`, `computeTotalSqftFromPieces` | R-EST-02 per-piece + total job sq ft (4-decimal rounding). |
| `packages/pricing/src/sheet-goods.ts` | `STANDARD_SHEET_SQ_FT`, `sheetsNeededForCoverage` | 4×8 / 5×10 nominal sheets + 75% / ceil billing rule. |
| `packages/pricing/src/roll-material.ts` | `computeRollNominalSqft`, `rollUsedFraction`, `rollEffectiveBillableSqft`, `rollMaterialLineCostCents` | Roll width (in) × length (ft) → sq ft; optional minimum billable hook. |
| `packages/pricing/src/banner.ts` | `bannerPrice({sqft, grommets})` | R-EST-03 — returns cents + breakdown + minimum-applied flag. |
| `packages/pricing/src/line.ts` | `computeLineCostCents({qtyMilli, unitCostCents})` | The single per-line formula. |
| `packages/pricing/src/estimate.ts` | `computeEstimate({multiplierMilli, designFlatCents, lines})` | The single source of truth for subtotal + final sell price. Called by the editor on every keystroke AND by `saveEstimateAction` server-side so cached totals match what the user saw. |
| `apps/web/lib/vendor-pricing/catalog-lookup.ts` | `lookupVendorCatalogIntelligence`, `mergeOrderedCatalogItemIds` | Tenant-scoped catalog resolution: vendor rows + managed shop items/aliases + capped `OCR_APPROVED` aggregates for receipt-backed hints + managed-item pricing summaries. **Cheapest vendor among OCR receipts** uses the same `latestObservationPerVendor` + `cheapestAmongLatest` helpers as managed items (including **effectiveAt** on receipt rows and managed **preferredVendorId** tie-break when prices tie). |
| `apps/web/lib/vendor-pricing/trends.ts` | `classifyPriceTrend`, `classifyPriceTrendForVendorHistory`, volatility helpers | Deterministic spike / volatility classification (basis-point thresholds; **+10% vs prior** default for “recent jump”). |

### Automated verification (Vitest)

Run from `apps/web`:

- **`pnpm --filter @bvisible/web run verify:estimate-pricing`** — `@bvisible/pricing` bucket/multiplier/math + allocated customer-quote sell (`allocateLineSellCents`, `buildCustomerQuoteLines` leak guards) + catalog→grid patch helpers (`apply-catalog-to-estimate-line`) + markup helpers (`markup.ts`) + vendor observation aggregation for catalog hints (`pricing-aggregate`) + **pricing calculators** (`pricing-calculators.test.ts`: sq ft, sheet, roll, banner).
- **`pnpm --filter @bvisible/web run verify:estimate-finalization`** — shared closeout gates (`evaluateEstimateFinalizeGates`), checklist builder, finalize action safety (no financial mutation; save lock while FINALIZED), **read-only editor UX helpers** (`isEstimateEditorReadOnly`, static UI lockdown checks in `estimate-read-only-ui.test.ts`).
- **`pnpm --filter @bvisible/web run verify:estimate-quote`** — public/staff quote links, timeline merge, dashboard quote attention, fulfillment hints (broader bundle).
- **`pnpm --filter @bvisible/web run verify:estimate-invoice-flow`** — estimate→invoice allocation + dashboard predicates.

The editor is `apps/web/app/(app)/estimates/[id]/{editor,line-grid,totals-panel,vendor-catalog-intel-panel,catalog-item-picker,pricing-helper-panel}.tsx`.
It hydrates from RSC bootstrap data, runs `computeEstimate(...)` synchronously
on every render, and on Save submits the entire grid to `saveEstimateAction`
which re-runs the same engine on the server inside one Prisma transaction.

**Customer quote preview + send** — **`/estimates/[id]/preview`** remains an authenticated,
tenant-scoped **staff** quote (company + bill-to + lines + total + notes/terms): same allocated-sell
presentation as the public page; **unit costs, multipliers, and internal breakdowns are never rendered**.
**`/quote/[token]`** is the **public** customer quote route (high-entropy token, SHA-256 hash only in
`estimate_quote_links`; revoked/expired tokens show a generic error). Customers can **Accept** or **Decline**
without logging in: **`submitPublicQuoteResponseAction`** / **`executePublicQuoteCustomerResponse`** persist
**`respondedAt`** plus accept/decline timestamps and optional name/note on **`estimate_quote_links`**, update
**`Estimate.status`** (accept → **`APPROVED`**, decline → **`REJECTED`**, **`FINALIZED`** blocked), append
**`estimate_timeline_events`** (**`QUOTE_ACCEPTED`** / **`QUOTE_DECLINED`**) and **`estimate_quote_accepted`** /
**`estimate_quote_declined`** audits **once** per first decision (replay-safe idempotency). Decision controls are
**`print:hidden`**; the quote document stays printable. Browser print uses `@media print` + root layout.
**`sendEstimateEmailAction`** (`preview/actions.ts`) verifies SMTP, **issues/rotates** a
public quote link for that estimate (invalidating prior active links), sends mail with the **`/quote/...`**
absolute URL, writes **`estimate_sent_to_client`**, and sets **`DRAFT → SENT` only after successful
`sendMail`**; failures leave status unchanged. **`FINALIZED`** blocks this send path; **`SENT`** may be
**resent** without forcing another status transition (each send rotates the public URL).

Estimate detail includes **Customer quote link** (`EstimateQuoteLinkPanel`): generate/regenerate (optional
expiry), revoke, copy URL immediately after rotation (plaintext URL is not stored server-side). In the premium
estimate workspace, staff-facing quote response (`EstimateQuoteResponseSummary`), public-link tooling, timeline,
PO, and reconciliation details live inside **supporting tabs** below the line-item workspace instead of stacking
as always-visible panels. The summary still derives link outcome (**Not issued / Awaiting / Accepted / Declined /
Revoked / Expired**), responder name + optional note, `respondedAt`, latest link issuance/expiry, last public view
time, and whether any URL is currently usable; **Regenerate** is disabled once the newest link row records
`respondedAt` (customer already decided — rotation remains intentional escalation only). The read-only timeline
merges chronological **`estimate_timeline_events`** (`QUOTE_ACCEPTED` / `QUOTE_DECLINED` / `INVOICE_CREATED_FROM_ESTIMATE`) with selected,
estimate-targeted **`audit_logs`** (`estimate_sent_to_client`, `estimate_quote_viewed_public`,
`estimate_status_changed`, `estimate_finalized`, `estimate_unfinalized`) — **not** duplicate
`estimate_quote_accepted` / `estimate_quote_declined` rows because timeline carries authoritative QUOTE_* lines.
There is **still no audit row solely for “link issued outside SMTP send”** — purely manual generations appear via link
metadata/UI without inventing synthetic timeline bullets.

**Estimator starting path:** `/estimates` → **New estimate** (client + job title) → `/estimates/[id]` editor. List rows expose `getEstimateListNextAction()` (empty drafts → **Add lines** `#estimate-line-grid`) and `getEstimateListWorkflowChips()` (approved PO+invoice shows **Potentially ready — open to confirm.** — list has no QBO/recon). Detail uses `getEstimateEditorPrimaryAction()` for compact header CTAs while the sticky right rail exposes pricing, customer, workflow status, closeout, status controls, and low-priority danger actions. The route scopes the shell to a mockup-like estimate workspace (no top command bar, narrower white sidebar), but does not change route/data behavior. The line grid is the visual and keyboard hub; catalog Apply and pricing helper require a focused row. Supporting tabs (Workflow, Files, Activity, Purchase Orders, Reconciliation, Notes) ensure secondary panels are one-at-a-time instead of vertically stacked. The pricing breakdown in the right rail contains editable multiplier/design controls when not finalized, keeping the initial rail focused on Sell/Cost/Profit/Margin. `buildEstimateFinalizeChecklist()` + `evaluateEstimateFinalizeGates()` remain display-only — no auto-finalize. **`FINALIZED`** estimates use **`isEstimateEditorReadOnly()`** — line grid, meta, multiplier/design flat, catalog/pricing Apply, and vendor Apply are client-locked; **`saveEstimateAction`** remains the server gate. Staff quote preview/print stays available (sell allocation only).

The **`/dashboard`** command center surfaces unified operational queues via **`getOperationalWorkflowQueues`** (see `apps/web/lib/workflow/operational-matrix.ts`) — estimate-centric buckets include **Awaiting customer**, **Approved waiting for PO**, **Ready to finalize**, and **Invoice follow-up**, each with blocker copy + deep links. UI prioritizes operator buckets (OCR, recon, mail) ahead of customer-wait rows and shows a **Needs operator** rail for blocked/stale/unresolved items (display sort only). **Ready to finalize** rows use the same gates as detail when recon data is present; estimates with QBO but open recon show **Potentially ready — open to confirm.** **PO vendor lifecycle** queues (`getPoLifecycleDashboardQueues`) surface **Ready to finalize** when linked estimate is `APPROVED`, all linked POs have QBO numbers, and recon is clean — same gate as `deriveReadyToFinalizeOverlay()` in `po-lifecycle-state.ts` (does not auto-finalize). Legacy **`getDashboardQuoteAttention`** remains for tests: (distinct estimates by latest **`QUOTE_ACCEPTED`** timeline hit), recently declined (**`QUOTE_DECLINED`**), and **`SENT`** estimates that still have an active (`respondedAt` null, not revoked/expired) link awaiting customer response — each row links back to `/estimates/[id]` (**tenant-scoped queries only**). **`getDashboardEstimatePoFlow`** adds an operational bridge layered purely on explicit joins: **`APPROVED`** estimates with **`purchaseOrders: none`**, newest **`purchase_orders`** rows carrying **`estimateId`**, **`APPROVED`** estimates that already have linked POs, and **`purchase_orders.estimateId`** rows whose newest **`POReconciliation`** snapshot is outside **`MATCHED`/`RESOLVED`** — deterministic helper strings only (counts/status/time deltas). **`getDashboardEstimateInvoiceFlow`** layers **`APPROVED`** estimates with **`invoices: none`**, unpaid **`Invoice`** rows tied to **`APPROVED`** estimates, and recently **`PAID`** estimate-linked invoices (**`paidAt`**) — visibility only.

Fulfillment UX beside quotes lives on **`/estimates/[id]`**: **`EstimateFulfillmentPanel`** merges **`EstimateOperationalStepRail`** (milestones derived strictly from persisted **`Estimate.status`**, first **`estimate_sent_to_client`** audit, **`QUOTE_ACCEPTED`**, earliest linked **`purchase_orders`**, non-deleted **`Invoice`** rows/`paidAt`, **`estimate_finalized`** audit while **`FINALIZED`**) and **`EstimateRelationshipFlowStrip`** (Quote → PO → Invoice → Paid deep links when IDs exist), explicit PO anchors from **`purchase_orders.estimateId`**, **`Create invoice`** (**Approved** estimates **without** a linked invoice yet — copies customer/lines/sell total into **`Invoice`/`InvoiceLineItem`**, timeline **`INVOICE_CREATED_FROM_ESTIMATE`**, audit **`invoice_created_from_estimate`**), linked invoice status chips + paid banners, and receipts/OCR/reconciliation summaries — operations staff never infer fulfillment from **`Estimate.status`** alone when PO or invoice linkage matters.

**Vendor pricing intelligence (read-only)** — material rows call
`lookupVendorCatalogIntelligence` (`apps/web/lib/vendor-pricing/catalog-lookup.ts`)
via `lookupVendorCatalogForEstimateAction`, debounced in the client.
Matching uses **`normalizeVendorItemName`** + **`canonicalMaterialKey`** (deterministic
token folds, no fuzzy AI), then the priority ladder: managed item → managed alias →
vendor exact alias → vendor exact name → vendor SKU → prefix alias → prefix name.
Every response includes **`materialMatch`** (path, reason, confidence, whether
operator confirmation is still required). Receipt-backed stats still read capped
**`OCR_APPROVED`** histories when a primary `VendorCatalogItem` resolves.
Managed-item intelligence aggregates **all** extraction methods for cheapest/preferred
suggestions, **`unitConversionHint`** when vendor unit ≠ catalog unit (sheet↔sq ft
4×8 rule; uncertain conversions stay null until Apply), a **latest-per-vendor** table
with **source + confidence**, compact trend copy, and preferred-vs-cheapest premium.
The rail exposes **Apply suggested cost**, **Apply cheapest vendor cost** (when
strictly lower), and **Apply converted unit cost** (only when a certain converted
cents value exists) — each patches **only** `unitCostCents` on click with
`onMouseDown` preventDefault — never automatic mutations and never focus stealing.
Unresolved matches show guidance only; pricing is never applied automatically.
**Browser smoke:** `pnpm --filter @bvisible/web run smoke:vendor-normalization` (coroplast
variants + Apply-only checks; requires `BVISIBLE_*` env).

**Pricing helper (estimate UI)** — `pricing-helper-panel.tsx` sits beside the catalog picker. Modes: **Square footage** (in × in ÷ 144 × piece count → qty as sq ft), **Sheet goods** (32 or 50 sq ft nominal + 75% / ceil rule → qty as sheet count), **Roll material** (width in × length ft → nominal roll sq ft; optional minimum billable sq ft; qty as billed sq ft), **Banner** (`bannerPrice` → one MATERIAL line at qty 1 × computed raw cents). Each mode only patches the **currently focused grid row** when the user clicks **Apply**; typing in the helper never mutates lines.

**Managed Items picker** — **Catalog items** (`catalog-item-picker.tsx`) lists active shop catalog rows. MATERIAL rows show **unit cost** that **Apply** writes (preferred vendor’s latest linked observation when set, else cheapest latest among linked vendors, else internal catalog cost). **Cheapest** and **preferred** vendor snapshots render as **read-only sub-lines** so estimators can compare without auto-switching vendors. **Cheapest among latest** in the picker bootstrap uses the same deterministic tie-breaks as `pricing-aggregate.cheapestAmongLatest` (preferred among price ties, then recency, then name). **Sell hint** uses markup % or catalog sell override as **guidance only**; the estimate grid total still uses **`computeEstimate`** (lines + estimate multiplier). Focus any grid row, filter/search, click **Apply** to fill **description**, **line kind**, **qty**, **unit cost**, and **machine** when applicable. No hooks while typing.


## Bid Estimator (seven-step signage bid workflow)

`EstimateType.BID` estimates are built in **`/estimates/[id]/bid`** (start at
**`/estimates/new/bid`**): project details → upload takeoff + plans → review
pricing → office questions → design → installation → customer estimate + QBME.
They are ordinary `Estimate` + `EstimateLineItem` rows — quotes, send, approval,
PO creation and finalize behave exactly as before — but their lines carry source
links, match evidence and pricing snapshots, so the **classic grid opens them
read-only** (`isEstimateEditorReadOnly(status, estimateType)`) and
`saveEstimateAction` refuses them.

| Module (`apps/web/lib/bid/`) | Responsibility |
|---|---|
| `parse-bid-takeoff.ts` | Spreadsheet → classified rows + product candidates. Section/building/floor/pod headings, repeated headers, blanks, subtotals, tax rows, grand totals, notes and legends are **never** products; every row is retained with its sheet name + row number. The same sign type is combined across floors/pods, keeping each contributing row. |
| `read-workbook.ts` | Server-side SheetJS read (bounded: 12 tabs × 2000 rows × 40 cols). |
| `match-standard-sign.ts` | Deterministic ladder: sign key → exact normalized name → approved alias (sign aliases + the Sheet `ALIASES` tab) → strong fuzzy; then size / braille / tactile / illumination / material checks → `EXACT` (auto-price) · `PROBABLE` (priced, needs a check) · `AMBIGUOUS` (office question, never guesses) · `NONE`. |
| `price-line.ts` | Billable quantity per method (`PER_SIGN PER_SET PER_SQFT PER_CHARACTER PER_LINEAR_FT PER_HOUR PER_DAY`), minimum charge, waste factor, rate ladder (literal rate → `Sq Ft Pricing` final price → `Meterial price` cost × company markup → the sign's stored rate), ordered explanation steps, and the persisted `BidPricingSnapshot`. Source quantity is stored separately from the billable quantity. |
| `design-calc.ts` / `install-calc.ts` | Recommendations from real setup work / site conditions, priced at the live operating rates. Design is never derived from total sign quantity; installation never from sign count alone. |
| `questions.ts` | Office-question persistence, answering (recalculates the line), and admin promotion of a decision into a standard sign or alias (duplicate-safe). |
| `standard-sign-sync.ts` | Sheet `Standard Signs` tab → `standard_signs` (see below). |
| `ai-suggest.ts` | Optional ranking of candidate signs for lines the deterministic ladder could not settle. Structured confidence + evidence, stored as a suggestion. **Never** sets a quantity, size, material, rate or price; failure or no API key leaves the deterministic import untouched. |
| `checklist.ts` | Step 7 completion checklist. Blocking items stop send/finalize; the estimate can always be saved as a draft. |

### Standard signs (Sheet contract — no deploy needed)

Optional tab named **`Standard Signs`**, matched by HEADER NAME (columns may be
reordered or extended). Recognition requires `Sign Key` plus `Sign Name` or
`Pricing Method`; anything else is treated as "tab not set up" and simply means
nothing matches automatically. Recommended headers:

```
Sign Key | Active | Category | Sign Name | QB Item | Customer Description |
Width | Height | Unit | Material | Thickness | Construction | Mounting |
Tactile | Braille | Illumination | Pricing Method | Pricing Unit | Rate Key |
Minimum Charge | Waste Percent | Default Machine | Shop Hours | Design Units |
Install Hours | Aliases | Formula Version | Notes
```

* `Rate Key` is either a literal amount (`60`, `$60.00`) or a Sheet item name
  (`Sq Ft Pricing` id/name, or a `Meterial price` item — cost × company markup).
* `Aliases` is a `;`/`,`-separated list; it drives future automatic matching.
* Sync runs inside `runSheetSync` (webhook + 5-minute fallback + manual refresh):
  upsert by `signKey`, duplicate names/aliases skipped, rows that disappeared are
  **deactivated, never deleted**, `source = APP` promotions are never overwritten,
  and a missing/unrecognized tab is a no-op. Read-only view: Pricing backend →
  **Standard signs**.
* **Do not create, rename, or modify a live Sheet tab without the owner's
  approval.** The app only reads it.

### Pricing snapshots and repricing

Every priced bid line stores a `BidPricingSnapshot` in
`pricingInputsSnapshotJson` (sheet key/tab, sync timestamp, formula version,
method/unit, rate + source, minimum/waste, source vs billable quantity,
dimensions/characters, project-specific decision + approver + reason). A later
Sheet change therefore **never** alters a saved estimate. Admins may run
**Check for updated pricing** on a DRAFT bid estimate: it shows old vs new
source, rate, total and difference per line; applying is explicit, writes new
snapshots, audits `bid_draft_repriced`, and leaves human decisions
(`OFFICE_DECISION` / `CUSTOM_RATE`) untouched. Sent, approved and finalized
estimates keep their saved pricing.

### Customer estimate, tax and terms

`loadEstimatePdfData` is the single source for the on-screen estimate, the PDF,
the public quote and the QBME block. Sales tax comes from
`tenant_operating_rates.salesTaxPercentMilli` (0 → the estimate shows a pre-tax
total and says tax is not included); terms come from
`lib/estimate/estimate-terms.ts` plus the project's installation assumptions;
the company identity is guarded by `lib/company/business-info.ts` so a stale
Florida address or 407 phone can never print.

### QBME — line by line

`buildQbmeExport` emits **one QBME line per customer estimate line, in the same
order**: `Line=ITEM|DESCRIPTION|QTY|RATE|` with AMOUNT empty and a trailing
pipe. Allowed items: `Wrapping · Sales · 3D Lettering · Design · Shipping ·
Installation · Channel Letters · Canopy`, taken from the stored
`EstimateLineItem.qbItem` (legacy lines fall back to `inferQbItem`). Pipes in
descriptions are sanitized; no tax line, no customer information, no dates.
`reconcileQbme` checks that Σ(QTY × RATE) equals the pre-tax subtotal and
surfaces any cent-level drift instead of hiding it in a large line.

### Permissions (bid)

* Estimator (any authenticated user): create bids, upload sources, review lines,
  confirm yellow matches, supply missing size/wording, choose a standard sign,
  enter design/installation assumptions, exclude a row, generate previews.
* ADMIN / SUPER_ADMIN additionally: approve custom or project-specific rates,
  promote a decision to a company standard (alias / standard sign), edit
  operating rates + sales tax, reprice a draft, unfinalize.
* FINALIZED bid estimates are read-only everywhere (server-enforced).

### Verification

`pnpm --filter @bvisible/web run verify:bid-estimator` ·
`pnpm --filter @bvisible/web run smoke:bid-estimator` (complete seven-step run,
resume, QBME reconciliation; needs the local dev server + seeded standard signs
via `tsx smoke/fixtures/seed-bid-standard-signs.ts`) ·
`smoke/estimate-classic-regression.spec.ts` for the classic lifecycle.

## Cost components

How **`packages/pricing`** implements raw cost today:

```
Materials  = unit_cost × quantity      (qtyMilli × unitCostCents / 1000)
Machines   = hours × machine_rate      (same line helper; MACHINE rows use hourly unit cost)
Shop labor = hours × labor_rate        (LABOR unitCostCents is the hourly shop rate)
Design     = Σ DESIGN lines + flat fee (Estimate.designFlatCents, default $150)
Install    = hours × composite_rate    (single unitCostCents × qtyMilli — see limitation below)
Misc       = sum of MISC lines

Raw cost   = Materials + Machines + Shop labor + Design + Install + Misc
```

**Install limitation:** Spreadsheet rules often use **hours × installers × hourly rate**. The live estimate engine does **not** store installers separately on `EstimateLineItem` — only **`qtyMilli`** and **`unitCostCents`**. Treat **`qtyMilli`** as job-hours (scaled ×1000), **`unitCostCents`** as **$/hour already multiplied by installer count** when needed, or fold installers into quantity before entry.

## Catalog sell hints vs estimate sell total

| Mechanism | Applies to |
|---|---|
| `ShopMaterialItem.markupPercentMilli`, `defaultSellPriceCents` | **Catalog items** picker **Sell hint** column only (guidance when choosing Apply targets). |
| `Estimate.multiplierMilli` | **`computeEstimate`**: applies to **entire raw cost subtotal** after line math + design flat (default **×3**, R-EST-01). |

Customer-facing quotes and invoices show **allocated sell** from **`finalPriceCents`** — never internal costs or vendor detail.

## Sell price

```
Final sell price = Raw cost × 3      (default multiplier — R-EST-01)
```

The multiplier is stored as `multiplierMilli = multiplier * 1000` (default
`3000`) on `Estimate`. The multiplier may be **manually overridden** per
estimate. Whenever `saveEstimateAction` sees a value different from the row's
prior `multiplierMilli` it writes an `estimate_multiplier_overridden` row to
`audit_logs` with `{from, to, defaultMultiplierMilli}` so deviations from the
default 3.000× are easy to audit. Never silently change the multiplier in
code; never display the multiplier as `markup` in a UI affordance unless that
matches the value the user sees on the editor.

## Square footage

```
sqft_each = width_inches × height_inches / 144
total_sqft = sqft_each × piece_count   (integer piece count; 4-decimal rounding on the product)
```

Round to 2 decimals for display only; keep raw `sqft` to 4 decimals when
chaining into another formula.

## Banner pricing (R-EST-03)

- Base rate: **$4.00 per sq ft**.
- Overage rate: **$3.00 per sq ft** for area above **200 sq ft**.
- Minimum charge: **$45.00**.
- Grommets: **$0.50 each**.

```ts
function bannerPrice(sqft: number, grommets: number): number {
  const baseSqft = Math.min(sqft, 200);
  const overSqft = Math.max(0, sqft - 200);
  const material = baseSqft * 400 + overSqft * 300; // cents
  const grommetCost = grommets * 50;                // cents
  return Math.max(material + grommetCost, 4500);    // $45 minimum
}
```

## Machine rates ($ / hour)

| Machine | Rate |
|---|---|
| Colex Sharp Cut Cutter — CNC | **$90.78 / hr** |
| Laser cutter | **$68.77 / hr** |
| Flatbed printer | **$33.45 / hr** |
| Roll-to-roll printer | **$44.21 / hr** |

Rates are stored in the `Machine` table so they can be edited without a code
deploy. The defaults above are seeded on the first save **per tenant** by
`apps/web/lib/estimate/seed-machines.ts` (`ensureDefaultMachines(tenantId)`).
The seeder is `createMany({skipDuplicates: true})` keyed by
`unique(tenantId, name)` so re-seeding never overwrites an admin's custom
rate. `createTenantAction` calls it after creating a tenant; if it ever fails
the error is logged but tenant creation still succeeds (the admin can edit
machines manually later).

## Channel-letter formula

Channel letters are priced as the sum of:

```
letter_cost  = perimeter_inches × material_rate_per_in
              + face_area_sqft × face_rate_per_sqft
              + return_area_sqft × return_rate_per_sqft
              + led_count × led_unit_cost
              + transformer_count × transformer_unit_cost

assembly     = labor_hours × shop_rate (50)
finishing    = labor_hours × shop_rate (50)

raw_letter   = letter_cost + assembly + finishing

job_total    = sum(letters) × size_multiplier × complexity_multiplier
```

### Multipliers

| Letter height | size_multiplier |
|---|---|
| ≤ 12" | 1.00 |
| 13–24" | 1.15 |
| 25–36" | 1.30 |
| 37–48" | 1.55 |
| > 48" | 1.85 |

| Style | complexity_multiplier |
|---|---|
| Standard face-lit | 1.00 |
| Halo / reverse-lit | 1.20 |
| Open face / exposed neon | 1.35 |
| Custom shape / mixed | 1.50 |

> The numeric values for `material_rate_per_in`, `face_rate_per_sqft`,
> `return_rate_per_sqft`, `led_unit_cost`, `transformer_unit_cost`, and the
> multipliers above must be **confirmed with the shop owner** before code
> freeze. Flag any change in `CHANGELOG_AI.md`.

## Manual overrides

- Any line item may have a manual override on price or quantity.
- Any total may be overridden at the estimate level (post-multiplier).
- Every override writes a row to the estimate audit log with the original
  computed value and the override value.
- Overrides do not silently propagate into `VendorPrice` or `Machine` rows.

## Where to put new rules

- New formulas → `packages/pricing/src/<rule>.ts` with a `vitest` test.
- New machine rates → DB seed + this doc.
- New product type (e.g. flag, decal) → its own file in `packages/pricing/`,
  documented here.
