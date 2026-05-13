# ESTIMATE_ENGINE — B Visible

The pure pricing rules. Implementation lives in `packages/pricing/`. All
formulas operate on **integer cents** for money and **inches** for size; only
the UI converts to dollars/feet.

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

The multiplier may be **manually overridden** per estimate. Overrides are
recorded in the estimate audit log (who, when, old, new). Never silently change
the multiplier in code.

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
deploy. The defaults above are seeded on first run.

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
