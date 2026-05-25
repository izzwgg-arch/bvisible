# KNOWN_RULES — B Visible

The non-obvious business rules. Each rule has a stable ID so PRs can reference
it.

## Company scope (`tenantId`)

- **R-COMP-01** The product is **single-company** (user-facing **Company**). The
  schema keeps **`tenantId`** + Prisma model **`Tenant`** as the internal workspace
  boundary. Canonical company slug is **`bvisible`** (display name **B Visible**),
  enforced idempotently by `ensureDefaultCompany()` (`apps/web/lib/company/default-company.ts`).
  Multiple `tenants` rows without that slug are an **operator ambiguity** — resolve manually;
  runtime surfaces `/dashboard?error=multi-company` rather than guessing.

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
- **R-EST-04** An estimate cannot be **finalized** until: (1) status is
  **`APPROVED`**, (2) at least one linked, non-deleted `PurchaseOrder` exists,
  (3) **every** linked PO has a non-null `qboPoNumber`, and (4) no linked PO has
  a latest reconciliation snapshot outside **`MATCHED`/`RESOLVED`** (no snapshot
  is OK). Enforced server-side by `evaluateEstimateFinalizeGates()` +
  `finalizeEstimateAction` (`apps/web/app/(app)/estimates/[id]/actions.ts`);
  typed errors include `not_approved`, `no_linked_po`, `no_qbo_number`,
  `reconciliation_unresolved`, `already_finalized`. Success writes
  `audit_logs` **`estimate_finalized`** only — **no** pricing recompute.
  `updateEstimateStatusAction` rejects `FINALIZED` directly. **`saveEstimateAction`**
  refuses edits while FINALIZED. Unfinalize: `unfinalizeEstimateAction` (ADMIN+).
  `EstimateStatus` enum: `DRAFT / SENT / APPROVED / REJECTED / FINALIZED`.

## Purchase Orders

- **R-PO-01** The PO is the master file for a job. Estimates, vendor docs,
  receipts, attachments, timeline, and price updates all link to it.
- **R-PO-02** Vendor email replies are routed by **PO number** in the
  subject or body. Mobile receipts likewise. The vendor email half is
  shipped: the matcher (`apps/web/lib/email-ingest/match.ts`) tries
  `PurchaseOrder.qboPoNumber` first, then internal
  `PurchaseOrder.number`, then falls back to a vendor + recent-PO
  heuristic, and otherwise marks the email `UNMATCHED` for operator
  review at `/admin/email-ingestion`. Field uploads use `/api/v1/uploads/*`
  against an authenticated PO (`MOBILE_APP.md`).
- **R-PO-03** Once a PO is `closed`, no further attachments may be added
  without a `reopened` event in the timeline. (Foundation: today the
  PO foundation accepts attachments at any non-deleted status; the
  closed/reopened gate lands with vendor email ingestion.)
- **R-PO-04** PO numbers are per-tenant, monotonic, format `PO-NNNNNN`.
  Allocation uses a Postgres advisory lock — see
  `apps/web/lib/po/number.ts` (`nextPoNumber`) and the shared
  `acquireTenantSequenceLock` helper in `apps/web/lib/sequence/lock.ts`.
  The internal `PurchaseOrder.number` is independent from
  `PurchaseOrder.qboPoNumber`, which the user pastes in after creating
  the PO inside QuickBooks.
- **R-PO-05** Attachment uploads are restricted to PDF / JPEG / PNG /
  WEBP, max 25 MB. The MIME type is detected from the file's magic
  bytes server-side; the client `Content-Type` is never trusted. The
  bytes-on-disk MIME is re-detected on every download stream so a
  tampered DB row cannot influence what the browser receives. See
  `apps/web/lib/po/uploads.ts` and `SECURITY_RULES.md`.
- **R-MOB-01** `POST /api/v1/uploads/complete` is **idempotent**: repeating the
  same `uploadId` after success returns the existing attachment (`data.idempotentReplay`)
  without inserting another `POAttachment`, duplicate timeline rows, or
  duplicate finalize audits (`finalize-mobile-upload.ts`).
- **R-MOB-02** Expo uploads **persist locally** in AsyncStorage (`upload-queue`)
  when offline or partially finished; processing waits on connectivity +
  exponential backoff (processor drains automatically — never hammer retries).

## Vendors / pricing

- **R-VEN-01** Long-term "cheapest vendor" ranking still targets canonical
  `VendorPrice` / `Item` rows (`VENDOR_PRICE_ENGINE.md`). **Phase 10** adds
  parallel **operational** observations: `VendorCatalogItem` +
  append-only `VendorPriceHistory` populated by deterministic email
  extraction (subject, body snippet, filenames). **Phase 13** adds optional
  **`OCR_APPROVED`** rows after operators confirm local OCR suggestions — never
  automatically from raw OCR. Those rows inform alerts and history UI; they do
  not automatically overwrite PO lines or the estimate engine.
- **R-VEN-02** Vendor email matching falls back from full sender address →
  domain → registered alias. Ambiguity routes to the review queue.
  Catalog linkage for extracted lines uses **deterministic** resolution only:
  exact normalized catalog name → exact `VendorItemAlias` → create catalog row.
- **R-VEN-03** When extraction records a **lower** price than the latest
  prior `VendorPriceHistory` row for the same `VendorCatalogItem`, the
  system creates a `VendorPriceNotification` that **requires manual
  dismissal**, emits `POEventKind.VENDOR_LOWER_PRICE`, and audits the
  event. Prices are **never** auto-applied and vendors are **never**
  auto-switched from this signal alone.
- **R-VEN-06** Estimate vendor-intelligence matching is **deterministic only**
  (`normalize.ts` + `catalog-lookup.ts`): managed item/alias → vendor exact alias →
  exact name → vendor SKU → prefix alias → prefix name. **`materialMatch.needsConfirmation`**
  is true for prefix buckets and unresolved rows. **Unit conversion** (`unit-conversion.ts`)
  may propose sheet↔sq ft (4×8 rule) but **`convertedPriceCents` stays null** when the
  sheet size is unknown or roll length is unknown — estimators must click **Apply converted
  unit cost** explicitly; the rail never auto-patches `unitCostCents` while typing.
- **R-VEN-04** Operators may append **`MANUAL`** `VendorPriceHistory` rows from `/items`
  for **`ShopMaterialItem` rows where `kind = MATERIAL`** (ADMIN/SUPER_ADMIN). Rows are append-only with unique `dedupeKey`, optional
  `effectiveAt`, audited via `shop_material_manual_price_recorded`. Manual pricing
  never mutates PO lines or estimates automatically — estimate editors only change if
  the estimator clicks **Apply suggested cost** or **Apply cheapest vendor cost** on the intelligence rail.
- **R-VEN-05** Managed MATERIAL picker hints aggregate **`VendorPriceHistory`** for every **`VendorCatalogItem`** linked to the shop item. **Latest observation per vendor** orders by economic instant (`effectiveAt`, else `createdAt`), breaks ties by extraction source (**`MANUAL` > `OCR_APPROVED` > regex-derived methods**) then **`vendorCatalogItemId`**. **Cheapest among latest** is the minimum latest price; **price ties** resolve in order: **preferred vendor when it shares the minimum**, else **newer observation instant**, else **`vendorName`**, else **`vendorId`**. **Suggested Apply unit cost** prefers the **preferred vendor’s** latest snapshot when linked; otherwise **cheapest latest** — the UI still shows **cheapest** and **preferred** separately (including a short note when preferred is more expensive). Source copy uses `vendor-price-source-label.ts` (no raw enum strings in these surfaces). **Apply** remains the only catalog auto-fill path (**R-CAT-01**).
- **R-CAT-01** The estimate editor **Catalog items** picker applies catalog defaults (`kind`, description, unit label, unit cost, qty, markup hint) **only when the estimator clicks Apply** on a chosen row — never while typing or on debounced focus alone; grid keyboard navigation must not be stolen from `makeGridKeyHandler`.
- **R-CAT-02** The estimate **Pricing helper** (`pricing-helper-panel.tsx`) may precompute sq ft, sheet counts, roll billable area, or banner raw cents, but **only writes the focused line when the estimator clicks Apply** on that helper — never while typing in helper fields; it shares the same focused-row target as the catalog picker and must not register a document-level keyboard handler that competes with `makeGridKeyHandler`.
- **R-OCR-01** Local OCR (`apps/web/lib/ocr/*`) produces **suggestions only**
  until an ADMIN confirms on `/admin/ocr-review/*`. Automatic extraction
  never writes `VendorPriceHistory`; approved writes use
  `extractionMethod = OCR_APPROVED` and dedupe via `(tenantId, dedupeKey)`
  plus unique optional `ocrLineItemId`.
- **R-OCR-02** Each eligible `POAttachment` enqueues **at most one**
  `OcrDocument` row (`poAttachmentId` UNIQUE). Processing runs only from the
  internal tick (`/api/internal/ocr/tick`); bounded `attemptCount` transitions
  to `FAILED` instead of infinite retries.

## Email ingestion

- **R-MAIL-01** Duplicate detection is by `(tenantId, messageId)`.
  Enforced by a UNIQUE index on `IngestedEmail (tenantId, messageId)`.
  An IMAP message is only marked `\Seen` AFTER the row commits — a
  crash mid-tick is replay-safe; the unique constraint short-circuits
  the second write. See `EMAIL_INGESTION.md`.
- **R-MAIL-02** Attachments are stored under
  `/opt/bvisible/shared/uploads/<tenantId>/email/<ingestedEmailId>/<storageKey>`
  (file mode `0640`, dir mode `0750`, owned by `deploy:deploy`). The
  on-disk filename is the server-generated `storageKey`; the original
  filename is sanitized to `[A-Za-z0-9._-]{1,200}` and stored only as
  display metadata. When matched to a PO the bytes are copied into the
  per-PO directory; the email-side row + bytes are retained for audit.
- **R-MAIL-03** Uncertain parses (no PO number found, ambiguous
  vendor) land in the operator queue at `/admin/email-ingestion` with
  `status = UNMATCHED` and are not applied automatically. Operators
  can manually link, retry, or dismiss; every action is audited.
- **R-MAIL-04** IMAP credentials are encrypted at rest with
  AES-256-GCM keyed on `INGEST_SECRET` and stored in
  `TenantEmailInbox.passwordCipher`. The plaintext password lives only
  in process memory for the duration of a single IMAP connection and
  is never logged, audited, or returned by any API. The single-tenant
  fallback path reads `IMAP_PASSWORD` from `.env`.
- **R-MAIL-05** Email attachments share the PO upload allowlist
  (PDF / JPEG / PNG / WEBP, magic-byte sniffed, 25 MB cap). Anything
  outside the allowlist lands as `IngestedEmailAttachment` with
  `skipped = true` + a non-secret `skipReason` and bytes are NOT
  written to disk.
- **R-MAIL-06** After a matched email successfully materializes onto a PO,
  deterministic vendor price extraction may run (`runVendorPriceExtractionAfterMaterialize`).
  Failures are isolated (warn log `vendor_price_extraction_failed`); they do
  not roll back ingestion or change `IngestedEmail` status.

## Notifications

- **R-NOTIF-01** Vendor lower-price alerts (`VendorPriceNotification`) never
  auto-dismiss. They remain visible on the tenant dashboard until the user
  submits the per-row **Dismiss** control (`dismissVendorPriceNotificationAction`).
- **R-NOTIF-02** Tenant-scoped rows only; queries always include `tenantId`.
  Never cross tenants.

## PO reconciliation

- **R-RECON-01** Reconciliation snapshots and spend alerts never auto-mutate PO lines,
  estimates, or accounting payloads. Alerts reference normalized labels + ids — not raw
  OCR text. Every query includes `tenantId`. Humans confirm pairs, accept variance,
  reject mappings, manually merge unmatched rows, dismiss alerts, or stamp a PO
  reconciled.

## Tenancy

- **R-TEN-01** Every tenant-scoped query includes `tenantId`. No exceptions.
  Enforced in code review and ideally by a Prisma extension.

## Deploy

- **R-DEP-01** Code that is not on `origin/main` is not real. Push first,
  deploy second.
- **R-DEP-02** Deploys require an exact `commitHash`. The server refuses
  branch-tip deploys.
- **R-DEP-03** Only one deploy at a time (flock). See `DEPLOY_QUEUE.md`.
