# PO_SYSTEM — B Visible

## The PO is the master file

A Purchase Order is the single record around which a job revolves. Everything
else attaches to it:

```
PurchaseOrder
├── linked Estimate           (1:1 in 95% of cases; multi-estimate jobs allowed)
├── linked Vendor             (nullable — set later if not known at creation)
├── POLineItem[]              (kind / description / qty / unit cost / cached cost)
├── POAttachment[]            (PDFs, drawings, vendor docs, receipts, invoices)
├── POEvent[]                 (created, status changed, qbo number set, ...)
└── (later) Vendor documents, receipts, price updates
```

## What's implemented today (Phase 7 foundation + Phase 10 vendor pricing observations)

- `Vendor` (minimal: name / email / phone / notes; per-tenant uniqueness on
  `(tenantId, name)`).
- **Vendor pricing intelligence (Phase 10, observation-only):** after a matched
  email materializes onto a PO, deterministic extraction writes
  `VendorCatalogItem` / `VendorItemAlias` (normalized names),
  append-only `VendorPriceHistory` (integer cents, `sourceEmailId`,
  optional `sourceAttachmentId`), and `VendorPriceNotification` when a new
  observation is strictly cheaper than the latest prior row for that catalog
  item. Dashboard banner + dismiss server action; `/vendors/[id]` shows
  history newest-first. See `EMAIL_INGESTION.md` and `DATA_MODEL.md`.
- `PurchaseOrder` with per-tenant monotonic `number` (`PO-NNNNNN`), nullable
  `estimateId` and `vendorId`, manually-entered `qboPoNumber`,
  cached `subtotalCents`, soft delete via `deletedAt`.
- `POLineItem` mirroring `EstimateLineItem` (integer cents, integer
  `qtyMilli`). PO has no markup — `subtotalCents` is the sum of
  line `computedCostCents`.
- **Regression bundle:** `pnpm --filter @bvisible/web run verify:estimate-po-flow` locks **`EstimateLineKind` → `POLineKind`** mapping (`lib/purchase-orders/map-estimate-kind-to-po-kind.ts`) plus dashboard PO-queue predicates (`get-estimate-po-flow`).
- `POAttachment` rows + on-disk bytes under
  `/opt/bvisible/shared/uploads/<tenantId>/po/<poId>/<randomKey>.<ext>`.
- `POEvent` append-only timeline (kinds: `CREATED`,
  `CREATED_FROM_ESTIMATE`, `LINES_SAVED`, `STATUS_CHANGED`,
  `QBO_NUMBER_ASSIGNED`, `VENDOR_ASSIGNED`, `ATTACHMENT_ADDED`,
  `ATTACHMENT_DELETED`, `NOTE_ADDED`, `CANCELED`, `VENDOR_REPLY`,
  `VENDOR_LOWER_PRICE`).
  `VENDOR_REPLY` is emitted by the email ingestion pipeline; its row
  also carries a non-null `sourceEmailId` pointing to the originating
  `IngestedEmail`. `VENDOR_LOWER_PRICE` is emitted when deterministic
  extraction records a strictly lower unit price than the prior
  `VendorPriceHistory` row for the same catalog item (operational alert
  only — no auto-repricing).
- `EstimateStatus.FINALIZED` enum value + R-EST-04 finalize gate
  (`finalizeEstimateAction` / `unfinalizeEstimateAction`).
- UI: `/purchase-orders`, `/purchase-orders/new`,
  `/purchase-orders/[id]`, `/vendors`, `/vendors/new`. Spreadsheet-like
  PO line editor reusing the estimate grid primitives.
- "Create PO from estimate" flow on the estimate editor's totals panel
  (**`EstimateStatus.APPROVED` only** — sidebar mirrors `createPoFromEstimateAction`;
  copies lines, preserves quantities and costs, never mutates the
  source estimate, writes a `CREATED_FROM_ESTIMATE` POEvent). **`/purchase-orders/new?estimateId=`**
  remains the explicit blank PO linker without silently cloning estimate rows.
- Tenant-gated attachment download route at
  `/api/po/[id]/attachments/[attachmentId]` with server-side MIME
  re-detection on every stream.

## What's deferred (intentionally out of scope this phase)

- Auto-applying extracted vendor prices to PO lines or estimates.
- Probabilistic vendor/item matching (embeddings / fuzzy SKU resolution beyond deterministic aliases).
- QBO API auto-fetch of PO numbers (today the user pastes manually).
- Approval workflows beyond the simple status enum.
- The `closed` / `reopened` gate from R-PO-03 (today attachments can
  be added at any non-deleted status).
- IMAP IDLE / push (today: polling only — see `EMAIL_INGESTION.md`).

## QuickBooks PO number

- `PurchaseOrder.qboPoNumber` is **required on at least one linked PO**
  before the linked estimate may be finalized (R-EST-04). Enforced by
  `finalizeEstimateAction`; UI affordances on the estimate page are
  hints, not the source of truth.
- The number is entered manually after creating the PO in QuickBooks.
  The PO's meta panel exposes a small text input that commits on blur.
  Allowed characters: letters, digits, dash, underscore (max 40).
- Future: vendor email matching will use this number (see
  `EMAIL_INGESTION.md` once it lands).

## Estimate → PO conversion

- Triggered from the estimate totals sidebar (**`APPROVED` workspace only**) via anchored **`#estimate-create-po`** mirroring the server gate — **`DRAFT`/`SENT`/`REJECTED`** editors explain that fulfillment waits on acceptance rather than silently failing later.
- Optional vendor picker, copies every estimate line into the new PO (kind, description, `qtyMilli`,
  `unitCostCents`, `sortOrder` preserved), seeds the PO's
  `subtotalCents` from the estimate's cached line costs, and writes a
  `CREATED_FROM_ESTIMATE` event.
- Server action: `createPoFromEstimateAction` **requires `EstimateStatus.APPROVED`** before allocating **`PO-NNNNNN`** (`apps/web/app/(app)/purchase-orders/actions.ts`).
- **Link existing PO** path stays explicit (`/purchase-orders/new?estimateId=…`), storing **`purchase_orders.estimateId`** without touching estimate lines.
- The original estimate is **not mutated**. Multiple POs per estimate
  are allowed.

## Status lifecycle

```
DRAFT → SENT → ORDERED → PARTIALLY_RECEIVED → RECEIVED
                                                 ↑
                                                 └── CANCELED (terminal)
```

- Any tenant member can transition status; the change writes a
  `STATUS_CHANGED` POEvent and an `audit_logs` row
  (`po_status_changed`).
- Foundation does NOT enforce ordering between statuses (e.g. can jump
  DRAFT → RECEIVED). Strict transitions land later if needed.

## PO timeline / events

- Append-only `POEvent` rows with a `kind` enum + free-form
  `message` + optional `metadata` JSON.
- Newest-first display on the PO detail page. Notes added via the
  inline form go in as `NOTE_ADDED` events.
- `POEvent` is the human-facing operational log. `audit_logs` remains
  the security audit log; both are written for state changes that
  matter to operators AND auditors.

## PO attachments

### What's stored
- DB row in `po_attachments`: `storageKey` (server-generated random),
  `originalFilename` (sanitized for display only), `mimeType` (server-
  detected at upload), `sizeBytes`, `kind` (RECEIPT / INVOICE /
  VENDOR_INVOICE / INSTALL_PHOTO / FIELD_DOCUMENT / VENDOR_DOC / DRAWING /
  OTHER / EMAIL_ATTACHMENT for ingest), `uploadedById`.
- Bytes on disk at
  `/opt/bvisible/shared/uploads/<tenantId>/po/<purchaseOrderId>/<storageKey>`.
  Mode 640, owned by the deploy user via the standard upload root.

### What's enforced
- Allowlist: PDF, JPEG, PNG, WEBP. The list is gated by **magic-byte
  detection**, not by the client's `Content-Type`. See
  `apps/web/lib/po/uploads.ts` (`detectMimeFromBytes`).
- Max 25 MB per upload (`MAX_UPLOAD_BYTES`). Next.js
  `serverActions.bodySizeLimit` is set to `25mb` to match.
- Per-tenant directory isolation. The download route resolves a
  candidate path with `path.resolve` and refuses anything that
  escapes the per-PO subtree.
- Tenant-gated download: `/api/po/[id]/attachments/[attachmentId]` runs
  `requireTenantId()` and joins on `tenantId` + `purchaseOrderId`
  before opening the file.
- Re-detection on download: the route reads the first bytes off disk
  and sets `Content-Type` from that, NOT from the DB row. A tampered
  `mimeType` value can never influence what the browser parses.

### Mobile `/api/v1/uploads/*`

Same byte storage and magic-byte rules as the web uploader. Flow:
`presign` → `PUT` raw bytes to the returned URL (Bearer on both steps) →
`complete`. Declared size must match actual bytes. See `MOBILE_APP.md`.

- `Content-Disposition: attachment; filename="..."` always set so
  rogue HTML can't render in-origin. `X-Content-Type-Options: nosniff`
  set as a backstop.

### Receipt OCR (Phase 13)

Eligible receipt-like attachment kinds enqueue **one** tenant-scoped
`OcrDocument` per `POAttachment` (unique FK). Processing is asynchronous via the
internal OCR tick (`DEBUGGING.md` §11f); operators confirm suggestions at
`/admin/ocr-review/*` before any `VendorPriceHistory` row is written (`KNOWN_RULES.md`
R-OCR-01).

### PO reconciliation & spend alerts (Phase 14)

Append-only `POReconciliation` snapshots compare **expected `POLineItem` rows**
(normalized descriptions using the vendor naming pipeline) against
**`VendorPriceHistory` rows with `extractionMethod = OCR_APPROVED`** tied to this PO via
`sourcePoAttachment`. Deterministic pairing requires equal counts per normalized label;
otherwise ambiguous PO/receipt rows + `SpendAlert` candidates.

**Triggers:** approving OCR lines runs `runPoReconciliationSnapshot` with a dedupe key
(`tenantId + PO + OCR doc + sorted line ids`). Manual **Recompute snapshot** uses a fresh
UUID nonce. Duplicate triggers short-circuit via `@@unique([tenantId, triggerDedupeKey])`.

**Humans only:** confirm pairs, accept variance, reject mappings, merge unmatched rows,
dismiss alerts, stamp `PurchaseOrder.operatorMarkedReconciledAt`. Nothing silently mutates
PO lines, estimates, or QuickBooks fields.

Env thresholds: `RECON_PRICE_TOLERANCE_BPS`, `RECON_ABSOLUTE_PRICE_TOLERANCE_CENTS`,
`RECON_QTY_TOLERANCE_BPS`.

## Vendor email ingestion (Phase 8 foundation)

Inbound vendor emails are pulled by the IMAP poller and matched to a
PO using the strict order in `EMAIL_INGESTION.md`:

1. Exact match on internal `PurchaseOrder.number` (token `PO-` + 4–8 digits) in subject, body snippet, or **stored attachment original filenames** (ambiguous multi-PO hits → unmatched).
2. Exact match on `qboPoNumber` among extracted QBO-like tokens from the same haystack (ambiguous multi-PO hits → unmatched).
3. `From:` address matches a vendor that has **exactly one** open PO (`SENT`, `ORDERED`, `PARTIALLY_RECEIVED`) with `updatedAt` in the last **30 days**.
4. Otherwise unmatched → operator review at `/admin/email-ingestion`.

Behaviour:

- Each matched email writes a single `VENDOR_REPLY` POEvent with sender,
  subject, attachment count and `messageId` in the metadata; accepted
  files become `POAttachment` rows (`kind = EMAIL_ATTACHMENT`) without
  a separate per-file POEvent.
- Attachments allowed by the existing PO allowlist (PDF / JPEG / PNG /
  WEBP) are persisted as `POAttachment` rows with
  `kind = EMAIL_ATTACHMENT`, `sourceEmailId` set to the originating
  `IngestedEmail.id`, and bytes hard-linked into the per-PO upload
  directory under the same secure scheme as manual uploads.
- **Idempotency** is the unique `(tenantId, messageId)` constraint on
  `IngestedEmail` (R-MAIL-01). Already-seen messages short-circuit
  before any side effect. Materialization no-ops when a `VENDOR_REPLY`
  event already exists for that `sourceEmailId`.
- Unmatched / failed emails sit in `/admin/email-ingestion` until an
  operator either links them to a PO (`manualLinkEmailToPoAction`)
  or dismisses them (`dismissEmailAction`). Each row carries deterministic
  **`reviewReasonCodes`** (matcher + attachment + OCR state) for the review UI.

See `EMAIL_INGESTION.md` for the full pipeline, lease/lock model,
systemd timer, encryption-at-rest scheme for IMAP credentials, and
operator runbook.

## Future: mobile receipts (deferred)

Receipts uploaded from the mobile app will carry the QBO PO number
scanned/typed by the installer. The server will attach them to the
matching PO as `POAttachment` rows with `kind = RECEIPT`. If no match,
they go to the review queue. Auth for that path is JWT (not session
cookie) and uses presigned URLs — neither is implemented yet.

## Permissions

- Tenant `USER` can create/edit POs, edit lines, set vendor / qbo /
  status, upload + delete attachments, add notes.
- `ADMIN` (and `SUPER_ADMIN`) can additionally **soft-delete** a PO
  (sets `deletedAt`), and **unfinalize** an estimate via
  `unfinalizeEstimateAction`.
- `SUPER_ADMIN` continues to have global access through the existing
  auth foundation.

## Audit

Every state change writes both a `POEvent` (timeline) and an
`audit_logs` row (security audit). `AuditAction` values added by
Phase 7: `vendor_created`, `po_created`, `po_created_from_estimate`,
`po_saved`, `po_status_changed`, `po_qbo_number_set`, `po_vendor_set`,
`po_attachment_added`, `po_attachment_deleted`, `po_note_added`,
`po_deleted`, `estimate_finalized`, `estimate_unfinalized`. Phase 8
adds `email_ingest_tick`, `email_ingest_message_ingested`,
`email_ingest_message_matched`, `email_ingest_message_failed`,
`email_ingest_manual_link`, `email_ingest_dismissed`,
`email_ingest_retried`, `tenant_inbox_configured`. Phase 14 reconciliation adds
`po_reconciliation_run`, `spend_alert_dismissed`, `po_reconciliation_line_resolution`,
`po_reconciliation_manual_merge`, `po_operator_marked_reconciled`,
`po_reconciliation_manual_refresh`.
