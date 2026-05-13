# VENDOR_PRICE_ENGINE — B Visible

How B Visible always knows the cheapest vendor for an item, and how it reacts
when an inbound document shows a better price.

Worker: `workers/vendor-price/`. Pure logic: `packages/pricing/src/vendor*`.

## Cheapest vendor logic (R-VEN-01)

For a given `(tenantId, itemId, quantityNeeded)`:

1. Pull all `VendorPrice` rows where:
   - `tenantId` matches
   - `itemId` matches (or matches via `ItemAlias`)
   - `effectiveAt <= now`
   - `expiredAt is null OR expiredAt > now`
   - `minQuantity <= quantityNeeded`
2. Group by vendor; take each vendor's most recent row.
3. Compute `extendedCents = unitPriceCents × quantityNeeded
   + flatFeeCents + shippingCents`.
4. Order ascending by `extendedCents`. Ties broken by vendor preference, then
   alphabetical.
5. Return the top row plus the next two as alternatives so the UI can show
   "you saved $X by picking this vendor."

The cheapest result is cached per `(tenantId, itemId, qtyTier)` in Redis with a
short TTL. Cache invalidates whenever a `VendorPrice` for that item is
inserted.

## Vendor matching (R-VEN-02)

When an inbound email or document arrives, the system identifies the vendor in
this order:

1. **Exact sender email** — `VendorContact.email` matches.
2. **Sender domain** — `VendorContact.domain` matches.
3. **Registered alias** — `VendorAlias.value` (e.g. a sub-brand "Acme Print
   Solutions" maps to vendor "Acme").
4. Otherwise → review queue.

Domain matching ignores well-known free providers (gmail.com, yahoo.com, etc.)
to avoid false positives.

## Item alias support

- `ItemAlias` rows let one canonical `Item` be referenced by many vendor SKUs
  or human names ("3M IJ180Cv3", "3M Controltac IJ180").
- The parser tries: exact SKU → exact name → fuzzy name (Levenshtein ≤ 2 on
  cleaned strings) → review queue.

## Lower-price detection (R-VEN-03)

When a parsed invoice/proposal shows a unit price **below** the current
`VendorPrice` for the same `(tenantId, vendorId, itemId, qtyTier)`:

1. **Do not auto-apply.** The current price stays live.
2. Insert a row into `VendorPriceHistory` with `source='detected'`,
   `proposedUnitPriceCents`, `documentRef` (PO + email + page), and
   `appliedAt = null`.
3. Create a `Notification` of type `vendor_lower_price` for the purchasing
   role(s). This is a **dashboard notification requiring manual dismissal**.
4. The notification **does not auto-dismiss** (R-NOTIF-01). It survives
   reloads. Only an explicit user action (manual dismiss / manual-dismiss)
   can either:
   - **Apply** → write a new `VendorPrice` row (and a `VendorPriceHistory` row
     with `source='applied'`, `appliedAt=now`), then dismiss.
   - **Dismiss** → leave the price unchanged, mark the history row
     `dismissedAt=now`.

## VendorPriceHistory (append-only) — R-VEN-04

Schema sketch:

| field | meaning |
|---|---|
| `id` | cuid |
| `tenantId` | tenant |
| `vendorId`, `itemId`, `qtyTier` | scope |
| `unitPriceCents` | the price that was current at this record |
| `proposedUnitPriceCents` | when source=`detected` |
| `source` | `manual` \| `applied` \| `detected` \| `dismissed` |
| `documentRef` | JSON: `{ poId?, emailId?, page?, sha256? }` |
| `effectiveAt` | when this price became current (null if proposal only) |
| `appliedAt`, `dismissedAt`, `createdBy`, `createdAt` | timestamps |

The history is the audit trail; the latest applied row is the live price.

## Dashboard surfacing

- Bell-menu badge counts unread `vendor_lower_price` notifications.
- Vendor detail page lists pending proposals with one-click Apply/Dismiss.
- An Estimate Edit screen shows "Cheaper alternative available" inline if the
  selected vendor is no longer cheapest.
