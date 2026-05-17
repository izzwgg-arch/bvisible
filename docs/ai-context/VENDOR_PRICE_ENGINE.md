# VENDOR_PRICE_ENGINE — B Visible

Operational vendor pricing intelligence **shipped today** is **deterministic
regex extraction** from matched inbound email metadata — not a separate worker
process and not AI/OCR.

Implementation lives in:

- `apps/web/lib/vendor-pricing/normalize.ts` — deterministic material normalization
  (`normalizeVendorItemName`, `stripTrailingUnitSuffix`, `canonicalMaterialKey`,
  `normalizeVendorSku`, token folds such as `CORO`/`CORO PLAST` → `COROPLAST`).
- `apps/web/lib/vendor-pricing/material-match.ts` — explainable match metadata
  (`path`, `matchReason`, `confidenceLabel`, `needsConfirmation`) for estimator UI.
- `apps/web/lib/vendor-pricing/unit-conversion.ts` — sheet↔sq ft (4×8 rule) and
  roll guidance; never silently converts uncertain units.
- `apps/web/lib/vendor-pricing/extract.ts` — subject / body snippet / filename
  patterns only.
- `apps/web/lib/vendor-pricing/persist.ts` — catalog resolution, append-only
  history, dedupe, lower-price side effects.
- Hook: after PO materialization succeeds, `apps/web/lib/email-ingest/run.ts`
  calls `runVendorPriceExtractionAfterMaterialize` inside `try/catch` so pricing
  failures never fail ingestion. Emails that remain **`UNMATCHED`** never hit
  this hook — there is no regex pricing pass until an operator links a PO or
  the deterministic matcher finds a single safe target. Operator-facing
  **`reviewReasonCodes`** on `IngestedEmail` document ambiguous matchers,
  attachment rejections, and OCR job state without implying AI scoring.

## Data model (tenant-scoped)

| Model | Role |
|-------|------|
| `VendorCatalogItem` | One row per `(tenantId, vendorId, nameNormalized)`. Optional nullable FK `shopMaterialItemId` ties OCR/email-created vendor rows back to a managed tenant **Item**. |
| `ShopMaterialItem` | Tenant estimating catalog row (`name` + unique `nameNormalized`). Stores `kind` (`EstimateLineKind`), `ShopCatalogUnit`, internal cost, markup (`markupPercentMilli` — **default 200000** = 200% above cost → catalog sell hint ≈ 3× cost unless overridden), optional sell override, default qty/`machineId`, preferred vendor + inactive flag — vendor pricing intelligence applies when `kind = MATERIAL`. |
| `ShopMaterialItemAlias` | Tenant-wide alias → managed item (`tenantId`, `aliasNormalized` UNIQUE). Feeds deterministic estimate lookups alongside vendor aliases. |
| `VendorItemAlias` | Optional deterministic vendor-scoped alias → catalog row (exact normalized match only today). |
| `VendorPriceHistory` | **Append-only** observations: integer `priceCents`, optional `unit` / `quantityMilli`, `sourceEmailId`, nullable `sourceAttachmentId`, optional `effectiveAt` (manual economic date), `confidence`, `extractionMethod`, `dedupeKey`. |
| `VendorPriceNotification` | Lower-price operational alert (manual dismiss via dashboard form). |

See `DATA_MODEL.md` for column-level detail.

### Automated verification

Managed catalog→estimate patches (`resolveCatalogUnitCostCents`, `buildLinePatchFromCatalogSelection`) and **deterministic vendor aggregation** for the estimate picker (`apps/web/lib/shop-material/pricing-aggregate.ts`: latest per vendor, cheapest among latest with **preferred tie among equal minimum prices**, then **newest observation instant**, then **vendor name** / `vendorId`; preferred-vs-cheapest display metadata via `estimate-catalog-bootstrap.ts`) are exercised under **`pnpm --filter @bvisible/web run verify:estimate-pricing`** (includes `pricing-aggregate.test.ts`, `trends.test.ts`) and **`pnpm --filter @bvisible/web run verify:vendor-catalog`** (includes `pricing-aggregate`, `vendor-price-source-label`, `apply-catalog-to-estimate-line`).

### Cheapest vendor + operator copy (managed items)

- **Latest per vendor** uses `latestObservationPerVendor` on merged `VendorPriceHistory` for all `VendorCatalogItem` rows linked to the shop item (same tie-break as above).
- **Cheapest among those latest rows** = minimum `priceCents`; ties resolve in order: **preferred vendor id when it is among the tied minima**, else **newer `effectiveAt ?? createdAt`**, else **`vendorName` localeCompare**, else **`vendorId`**.
- **Suggested unit cost** still prefers **preferred vendor’s latest** when that snapshot exists; it does **not** silently replace the numeric “cheapest” display — UI shows both.
- **Human-readable source labels** (not raw Prisma enum strings) map through `apps/web/lib/vendor-pricing/vendor-price-source-label.ts` (**Manual**, **OCR verified**, **Email text**, **Filename**, **OCR text (unverified)**, **Unknown**) plus optional **confidence** copy (**High / Medium / Lower confidence**).
- **Per-vendor trend** for managed surfaces uses `classifyPriceTrendForVendorHistory` in `trends.ts` (90d window on that vendor’s merged history; **>10%** spike vs prior observation uses `DEFAULT_SPIKE_VS_PREV_BPS = 1000`).

## What is extracted (Phase 10)

**Allowed inputs**

- Email subject line.
- Stored plain-text `bodyTextSnippet` (already sanitized at ingest parse time).
- Sanitized attachment **filenames** for non-skipped attachments.

**Explicitly not parsed**

- PDF bytes, embedded images, HTML rendering, OCR.
- LLM / embeddings / fuzzy SKU matching beyond exact normalized strings.

Confidence enum on each history row: `HIGH` \| `MEDIUM` \| `LOW` (mostly HIGH/MEDIUM
from production paths).

## Dedupe / idempotency (`dedupeKey`)

Each candidate observation computes `dedupeKey = SHA-256(JSON.stringify({ tenantId,
emailId, attachmentId, method, ord, itemNormalized, price, unit }))`.

Unique constraint `(tenantId, dedupeKey)` on `VendorPriceHistory` guarantees safe
retries: duplicate inserts surface as `P2002` and are counted as duplicates without
a second history row.

## Catalog resolution (deterministic)

**Estimate rail / `lookupVendorCatalogIntelligence`** (`catalog-lookup.ts`):

1. **Managed shop item** — exact `ShopMaterialItem.nameNormalized` → linked vendor catalog IDs.
2. **Managed alias** — exact `ShopMaterialItemAlias.aliasNormalized` → linked vendor catalog IDs.
3. **Vendor exact alias** — `VendorItemAlias.aliasNormalized`.
4. **Vendor exact name** — `VendorCatalogItem.nameNormalized`.
5. **Vendor SKU** — `normalizeVendorSku` exact on `vendorSku` (min length 3).
6. **Prefix alias** — `aliasNormalized` startsWith query (capped).
7. **Prefix name** — `nameNormalized` startsWith query (capped).

Each result includes **`materialMatch`** (`material-match.ts`) with human-readable
**why**, **confidence** (`High` / `Medium` / `Needs review`), and
**`needsConfirmation`** for prefix buckets. Unresolved rows never auto-apply pricing.

**Email ingest persist** (`persist.ts`) still uses vendor-scoped exact + alias + create
semantics documented in ingest paths — unchanged by this normalization pass.

No semantic similarity or embeddings.

## Managed Items + manual pricing (`MANUAL`)

Administrators maintain tenant-level **`ShopMaterialItem`** rows under `/items`.
Manual vendor quotes append **`VendorPriceHistory`** rows with
`extractionMethod = MANUAL`, **HIGH** confidence, a random dedupe nonce per click,
and optional `effectiveAt` for back-dated economics (`createdAt` still reflects
insert time). Linked `VendorCatalogItem` rows reuse the item's `nameNormalized`
per vendor; OCR/email ingestion behavior is unchanged — manual rows simply
participate in the same append-only ledger + estimate intelligence aggregates.

## Lower-price detection (R-VEN-03)

After a **successful** history insert, if there was a **prior** row for the same
`VendorCatalogItem` with strictly higher `priceCents`, the system:

1. Inserts `VendorPriceNotification` (`dismissedAt = null` until an operator posts
   the dismiss action).
2. Appends `POEventKind.VENDOR_LOWER_PRICE` on the linked PO with sanitized message +
   structured metadata (includes `sourceEmailId`).
3. Writes audit `vendor_price_lower_detected`.

**Does not:** mutates PO lines, estimates, or canonical live price sheets.

Comparison baseline is “latest prior history row for this catalog item” — no
quantity-tier normalization yet.

## Operator surfaces

- **Dashboard** (`/dashboard`): amber **Vendor price alerts** banner listing unread
  notifications with vendor link, item label, old/new price delta, email subject,
  PO deep-link when `matchedPurchaseOrderId` exists. **Dismiss** posts
  `dismissVendorPriceNotificationAction` (`apps/web/lib/vendor-pricing/actions.ts`).
- **Vendor detail** (`/vendors/[id]`): newest-first price history table with source
  email linkage and a simple “lower vs prior row” hint.

## Verification & tests

- **Unit / integration (mocked Prisma):** `pnpm run test` — `apps/web/lib/vendor-pricing/*.test.ts`.
- **Deterministic DB script (no IMAP):** `bash server-scripts/db/.verify-vendor-pricing.sh`
  (sources `/opt/bvisible/shared/env/.env` on the deploy box) or
  `pnpm --filter @bvisible/web exec tsx --tsconfig tsconfig.json scripts/verify-vendor-pricing.ts`
  with `DATABASE_URL` set. Creates tenant slug `vendor-pricing-verify`, runs extraction,
  asserts counts + replay dedupe, deletes the tenant.

## Phase 13 — local OCR receipt foundation (human-gated)

- **Queue:** `OcrDocument` rows keyed by `poAttachmentId` (unique). Enqueued when
  receipt-like `POAttachment` rows are created (web upload, mobile finalize,
  email materialization).
- **Worker:** internal `POST /api/internal/ocr/tick` (`apps/web/lib/ocr/worker.ts`),
  bounded concurrency + retry cap (`R-OCR-02`). Extractors: `pdf-parse` for PDF
  text layers; host **`tesseract` CLI** + **`sharp`** for images; optional **`pdftoppm`**
  (Poppler) when PDF has no extractable text layer.
- **Parsing:** header guesses (`parse-receipt.ts`) + line candidates via
  `parse-receipt-lines.ts` (skips subtotal/tax/total; supports `qty N`, `N x $price`;
  stores `parseReason` on `OcrLineItem.extractionSource`). Each worker tick
  `deleteMany` line items then re-inserts (replay-safe).
- **Human gate:** `/admin/ocr-review/*` (ADMIN+). Only **Approve** runs
  `persistApprovedOcrPriceLines` (`extractionMethod = OCR_APPROVED`). Automatic OCR
  never writes pricing rows. `REVIEW_REQUIRED` is suggestions only.
- **Verification:** `pnpm --filter @bvisible/web run verify:ocr-quality`;
  `bash server-scripts/db/.verify-ocr-quality.sh` (host + vitest);
  `bash server-scripts/db/.verify-ocr-receipt-parse.sh` (parse-only, no binaries).

## Estimate editor catalog hints (read-only)

- Service: `lookupVendorCatalogIntelligence` in `apps/web/lib/vendor-pricing/catalog-lookup.ts`
  (ladder above; strips trailing unit tokens from queries before match; **tenant scoped**
  on every query).
- **Unit basis:** `resolveManagedItemIntel` may attach `unitConversionHint` when vendor
  latest unit differs from shop `catalogUnit` (sheet↔sq ft 4×8 rule; roll→LF manual).
- Trends / spikes: `apps/web/lib/vendor-pricing/trends.ts` — compares latest OCR-approved
  unit observation vs rolling average / prior point using fixed basis-point thresholds
  plus coefficient-of-variation volatility — **no embeddings**, **no substring scoring**.
- UI: debounced rail under the estimate line grid (`vendor-catalog-intel-panel.tsx`);
  shows match reason + confidence; compact trend lines; Apply buttons use
  `onMouseDown` preventDefault; never auto-fills costs. Automated regression:
  `pnpm --filter @bvisible/web run verify:vendor-catalog`;
  `bash server-scripts/db/.verify-vendor-normalization.sh` (bundles vendor-catalog +
  estimate-pricing + ocr-quality vitest). **Browser smoke (operator creds):**
  `pnpm --filter @bvisible/web run smoke:vendor-normalization` — see `DEBUGGING.md` § 0c.

## Phase 14 — PO reconciliation (deterministic, human-gated)

- Pairing engine: `apps/web/lib/reconciliation/match.ts` + runner `run.ts`. Consumes
  **`OCR_APPROVED` rows only** for the receipt side so email-regex observations stay out
  of this comparison unless operators promote data via OCR approve.
- New reconciliation snapshots **supersede prior `OPEN` spend alerts** tied to older runs for the same PO (`SpendAlertStatus.SUPERSEDED`, `supersededByReconciliationId`), then insert alerts for the current snapshot (`dedupeKey` uniqueness). Operator-dismissed rows stay `DISMISSED`.
- UX + actions: `apps/web/lib/reconciliation/actions.ts`; surfaces documented in
  `PO_SYSTEM.md` + `UI_SYSTEM.md`.

## Managed MATERIAL aggregation (estimate catalog picker)

For **`ShopMaterialItem`** rows with **`kind = MATERIAL`** and linked **`VendorCatalogItem`** IDs, the estimate editor hydrates picker rows via **`loadEstimateCatalogPickerRows`** (`apps/web/lib/shop-material/estimate-catalog-bootstrap.ts`), which merges **`VendorPriceHistory`** across all linked catalog IDs.

Rules (**`pricing-aggregate.ts`**, deterministic):

1. **Latest per vendor:** prefer larger **`effectiveAt`** when present; otherwise **`createdAt`**. When those tie, prefer **`MANUAL`** over **`OCR_APPROVED`** over regex-derived methods; final tie-break **`vendorCatalogItemId`** lexicographic ascending.
2. **Cheapest among latest:** minimum **`priceCents`** among vendors’ latest rows; price ties break on **`vendorId`** ascending.
3. **Suggested unit cost for Apply:** preferred vendor’s latest observation when that vendor has history; otherwise global cheapest among latest. **Never** mutates the grid without **Apply** or explicit rail **Use this cost**.

These hints differ from vendor-intelligence rail matching (`catalog-lookup.ts`), which resolves rows by normalized keys for an existing estimate line description.

## Future / not implemented here

- Canonical `VendorPrice` table + Redis cache described in older planning docs.
- Cloud LLM extraction / semantic SKU resolution / autopilot accounting.
