# VENDOR_PRICE_ENGINE — B Visible

Operational vendor pricing intelligence **shipped today** is **deterministic
regex extraction** from matched inbound email metadata — not a separate worker
process and not AI/OCR.

Implementation lives in:

- `apps/web/lib/vendor-pricing/normalize.ts` — normalized catalog keys.
- `apps/web/lib/vendor-pricing/extract.ts` — subject / body snippet / filename
  patterns only.
- `apps/web/lib/vendor-pricing/persist.ts` — catalog resolution, append-only
  history, dedupe, lower-price side effects.
- Hook: after PO materialization succeeds, `apps/web/lib/email-ingest/run.ts`
  calls `runVendorPriceExtractionAfterMaterialize` inside `try/catch` so pricing
  failures never fail ingestion.

## Data model (tenant-scoped)

| Model | Role |
|-------|------|
| `VendorCatalogItem` | One row per `(tenantId, vendorId, nameNormalized)`. Created when a normalized item label is seen for the first time (or resolved via `VendorItemAlias`). |
| `VendorItemAlias` | Optional deterministic alias → catalog row (exact normalized match only today). |
| `VendorPriceHistory` | **Append-only** observations: integer `priceCents`, optional `unit` / `quantityMilli`, `sourceEmailId`, nullable `sourceAttachmentId`, `confidence`, `extractionMethod`, `dedupeKey`. |
| `VendorPriceNotification` | Lower-price operational alert (manual dismiss via dashboard form). |

See `DATA_MODEL.md` for column-level detail.

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

1. Exact `VendorCatalogItem` match on `(tenantId, vendorId, nameNormalized)`.
2. Else exact `VendorItemAlias.aliasNormalized` for that vendor.
3. Else **create** a new `VendorCatalogItem`.

No semantic similarity or embeddings.

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
- **Parsing:** header guesses (`parse-receipt.ts`) + line candidates via existing
  `extractPricesFromTextBlob(..., OCR_TEXT_REGEX, ...)`.
- **Human gate:** `/admin/ocr-review/*` (ADMIN+). Only **Approve** runs
  `persistApprovedOcrPriceLines` (`extractionMethod = OCR_APPROVED`). Automatic OCR
  never writes pricing rows.
- **Verification (no OCR binaries):** `bash server-scripts/db/.verify-ocr-receipt-parse.sh`.

## Estimate editor catalog hints (read-only)

- Service: `lookupVendorCatalogIntelligence` in `apps/web/lib/vendor-pricing/catalog-lookup.ts`
  (deterministic exact → alias → **prefix** on normalized keys; **tenant scoped**
  on every query).
- Trends / spikes: `apps/web/lib/vendor-pricing/trends.ts` — compares latest OCR-approved
  unit observation vs rolling average / prior point using fixed basis-point thresholds
  plus coefficient-of-variation volatility — **no embeddings**, **no substring scoring**.
- UI: debounced rail under the estimate line grid (`vendor-catalog-intel-panel.tsx`);
  never auto-fills costs or moves focus. Automated regression:
  `pnpm --filter @bvisible/web run verify:vendor-catalog`.

## Phase 14 — PO reconciliation (deterministic, human-gated)

- Pairing engine: `apps/web/lib/reconciliation/match.ts` + runner `run.ts`. Consumes
  **`OCR_APPROVED` rows only** for the receipt side so email-regex observations stay out
  of this comparison unless operators promote data via OCR approve.
- New reconciliation snapshots **supersede prior `OPEN` spend alerts** tied to older runs for the same PO (`SpendAlertStatus.SUPERSEDED`, `supersededByReconciliationId`), then insert alerts for the current snapshot (`dedupeKey` uniqueness). Operator-dismissed rows stay `DISMISSED`.
- UX + actions: `apps/web/lib/reconciliation/actions.ts`; surfaces documented in
  `PO_SYSTEM.md` + `UI_SYSTEM.md`.

## Future / not implemented here

- Canonical `VendorPrice` table + Redis cache described in older planning docs.
- Cheapest-vendor ranking across vendors for a shared master `Item`.
- Cloud LLM extraction / semantic SKU resolution / autopilot accounting.
