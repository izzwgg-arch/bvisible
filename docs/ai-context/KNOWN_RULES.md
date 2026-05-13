# KNOWN_RULES — B Visible

The non-obvious business rules. Each rule has a stable ID so PRs can reference
it.

## Estimates

- **R-EST-01** Default sell multiplier is **3x raw cost**. Manual override is
  allowed and must be logged on the estimate. Implemented in
  `packages/pricing/src/estimate.ts` (`computeEstimate`) and stored as
  `Estimate.multiplierMilli` (default `3000` = 3.000×). Overrides are written
  to `audit_logs` as `action = 'estimate_multiplier_overridden'` by
  `saveEstimateAction`. See `ESTIMATE_ENGINE.md`.
- **R-EST-02** Square footage uses inches: `sqft = width_in × height_in / 144`.
  Helper: `packages/pricing/src/sqft.ts`.
- **R-EST-03** Banners price at $4/sf, drop to $3/sf for the area over 200 sf,
  $45 minimum, $0.50 per grommet. Helper: `packages/pricing/src/banner.ts`.
  (Editor calculator UI to compose a banner line lands in the next phase;
  the engine helper is shipped now so other surfaces can use it.)
- **R-EST-04** An estimate cannot be **finalized** until its linked PO has a
  QuickBooks PO number (`PurchaseOrder.qboPoNumber`). See `PO_SYSTEM.md`.
  No `finalized` status exists yet — Phase 6 statuses are
  `DRAFT / SENT / APPROVED / REJECTED`. Finalization gating lands with the
  PO module.

## Purchase Orders

- **R-PO-01** The PO is the master file for a job. Estimates, vendor docs,
  receipts, attachments, timeline, and price updates all link to it.
- **R-PO-02** Vendor email replies are routed by **PO number** in the subject
  or body. Mobile receipts likewise.
- **R-PO-03** Once a PO is `closed`, no further attachments may be added
  without a `reopened` event in the timeline.

## Vendors / pricing

- **R-VEN-01** "Cheapest vendor" is computed per `Item` per quantity tier from
  the latest `VendorPrice` rows. See `VENDOR_PRICE_ENGINE.md`.
- **R-VEN-02** Vendor email matching falls back from full sender address →
  domain → registered alias. Ambiguity routes to the review queue.
- **R-VEN-03** When an ingested document shows a **lower price** than the
  current `VendorPrice`, the system creates a Notification that **requires
  manual dismissal** before the price is applied.
- **R-VEN-04** `VendorPriceHistory` is append-only.

## Email ingestion

- **R-MAIL-01** Duplicate detection is by `(tenantId, messageId)`.
- **R-MAIL-02** Attachments are stored under
  `/opt/bvisible/shared/uploads/<tenantId>/email/<yyyy>/<mm>/<messageId>/...`.
- **R-MAIL-03** Uncertain parses (no PO number found, ambiguous vendor) go to
  the review queue and are not applied automatically.

## Notifications

- **R-NOTIF-01** Price-change notifications never auto-dismiss. They survive
  page reloads and remain in the bell menu until the user clicks Dismiss.
- **R-NOTIF-02** Per-user, per-tenant. Never cross tenants.

## Tenancy

- **R-TEN-01** Every tenant-scoped query includes `tenantId`. No exceptions.
  Enforced in code review and ideally by a Prisma extension.

## Deploy

- **R-DEP-01** Code that is not on `origin/main` is not real. Push first,
  deploy second.
- **R-DEP-02** Deploys require an exact `commitHash`. The server refuses
  branch-tip deploys.
- **R-DEP-03** Only one deploy at a time (flock). See `DEPLOY_QUEUE.md`.
