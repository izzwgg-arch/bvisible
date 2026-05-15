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
| `packages/pricing/src/sqft.ts` | `computeSqft(w_in, h_in)` | R-EST-02. |
| `packages/pricing/src/banner.ts` | `bannerPrice({sqft, grommets})` | R-EST-03 — returns cents + breakdown + minimum-applied flag. |
| `packages/pricing/src/line.ts` | `computeLineCostCents({qtyMilli, unitCostCents})` | The single per-line formula. |
| `packages/pricing/src/estimate.ts` | `computeEstimate({multiplierMilli, designFlatCents, lines})` | The single source of truth for subtotal + final sell price. Called by the editor on every keystroke AND by `saveEstimateAction` server-side so cached totals match what the user saw. |
| `apps/web/lib/vendor-pricing/catalog-lookup.ts` | `lookupVendorCatalogIntelligence`, `mergeOrderedCatalogItemIds` | Tenant-scoped catalog resolution: vendor rows + managed shop items/aliases + capped `OCR_APPROVED` aggregates for receipt-backed hints + managed-item pricing summaries. |
| `apps/web/lib/vendor-pricing/trends.ts` | `classifyPriceTrend`, volatility helpers | Deterministic spike / volatility classification (basis-point thresholds). |

The editor is `apps/web/app/(app)/estimates/[id]/{editor,line-grid,totals-panel,vendor-catalog-intel-panel,catalog-item-picker}.tsx`.
It hydrates from RSC bootstrap data, runs `computeEstimate(...)` synchronously
on every render, and on Save submits the entire grid to `saveEstimateAction`
which re-runs the same engine on the server inside one Prisma transaction.

**Vendor pricing intelligence (read-only)** — material rows call
`lookupVendorCatalogIntelligence` (`apps/web/lib/vendor-pricing/catalog-lookup.ts`)
via `lookupVendorCatalogForEstimateAction`, debounced in the client.
Matching uses normalized **exact** vendor-catalog keys, vendor **aliases**, tenant **ShopMaterialItem** names + **ShopMaterialItemAlias** rows, then deterministic **prefix** scans. Receipt-backed stats still read capped **`OCR_APPROVED`** histories when a primary `VendorCatalogItem` resolves. Managed-item intelligence aggregates **all** extraction methods (manual + OCR-approved + legacy regex methods) for cheapest/preferred suggestions. The rail exposes an explicit **Use this cost** control that patches **only** `unitCostCents` when clicked — never automatic mutations and never focus stealing.

**Managed Items picker** — **Catalog items** (`catalog-item-picker.tsx`) lists active shop catalog rows with MATERIAL vendor cost hints. Focus any grid row, filter/search, click **Apply** to fill **description**, **line kind**, **qty**, **unit cost** (vendor-preferred/cheapest/internal basis via `apply-catalog-to-estimate-line.ts`), and **machine** when applicable. No hooks while typing; keyboard grid navigation unchanged.

## Cost components

```
Materials  = unit_cost × quantity
Machines   = hours × machine_rate
Shop labor = hours × 50
Design     = 150  (flat per estimate; may be waived)
Install    = hours × installers × 150
Misc       = sum of any ad-hoc lines

Raw cost   = Materials + Machines + Shop labor + Design + Install + Misc
```

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
sqft = width_inches × height_inches / 144
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
