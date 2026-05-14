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

## What's implemented today (Phase 7 foundation)

- `Vendor` (minimal: name / email / phone / notes; per-tenant uniqueness on
  `(tenantId, name)`).
- `PurchaseOrder` with per-tenant monotonic `number` (`PO-NNNNNN`), nullable
  `estimateId` and `vendorId`, manually-entered `qboPoNumber`,
  cached `subtotalCents`, soft delete via `deletedAt`.
- `POLineItem` mirroring `EstimateLineItem` (integer cents, integer
  `qtyMilli`). PO has no markup — `subtotalCents` is the sum of
  line `computedCostCents`.
- `POAttachment` rows + on-disk bytes under
  `/opt/bvisible/shared/uploads/<tenantId>/po/<poId>/<randomKey>.<ext>`.
- `POEvent` append-only timeline (kinds: `CREATED`,
  `CREATED_FROM_ESTIMATE`, `LINES_SAVED`, `STATUS_CHANGED`,
  `QBO_NUMBER_ASSIGNED`, `VENDOR_ASSIGNED`, `ATTACHMENT_ADDED`,
  `ATTACHMENT_DELETED`, `NOTE_ADDED`, `CANCELED`).
- `EstimateStatus.FINALIZED` enum value + R-EST-04 finalize gate
  (`finalizeEstimateAction` / `unfinalizeEstimateAction`).
- UI: `/purchase-orders`, `/purchase-orders/new`,
  `/purchase-orders/[id]`, `/vendors`, `/vendors/new`. Spreadsheet-like
  PO line editor reusing the estimate grid primitives.
- "Create PO from estimate" flow on the estimate editor's totals panel
  (copies lines, preserves quantities and costs, never mutates the
  source estimate, writes a `CREATED_FROM_ESTIMATE` POEvent).
- Tenant-gated attachment download route at
  `/api/po/[id]/attachments/[attachmentId]` with server-side MIME
  re-detection on every stream.

## What's deferred (intentionally out of scope this phase)

- Vendor email ingestion / `vendor_reply` POEvents — Phase 8.
- Mobile receipt uploads (presigned URLs, JWT auth) — mobile app phase.
- OCR / invoice parsing.
- Vendor pricing intelligence (`VendorPrice`, `VendorPriceHistory`).
- QBO API auto-fetch of PO numbers (today the user pastes manually).
- Approval workflows beyond the simple status enum.
- The `closed` / `reopened` gate from R-PO-03 (today attachments can
  be added at any non-deleted status).

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

- Triggered from the estimate editor's totals panel ("Create PO from
  estimate"). Picks an optional vendor, copies every line of the
  estimate into the new PO (kind, description, `qtyMilli`,
  `unitCostCents`, `sortOrder` preserved), seeds the PO's
  `subtotalCents` from the estimate's cached line costs, and writes a
  `CREATED_FROM_ESTIMATE` event.
- Server action: `createPoFromEstimateAction` (in
  `apps/web/app/(app)/purchase-orders/actions.ts`).
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
  VENDOR_DOC / DRAWING / OTHER), `uploadedById`.
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
- `Content-Disposition: attachment; filename="..."` always set so
  rogue HTML can't render in-origin. `X-Content-Type-Options: nosniff`
  set as a backstop.

## Future: vendor reply routing (deferred)

Inbound emails (Phase 8) will be matched to a PO by the QBO PO number
found in the **subject** or **body** of the email. Matching order:

1. Exact match on `qboPoNumber` in the subject.
2. Exact match in the body (first occurrence).
3. Fallback: vendor + recent date heuristics → review queue.

Once matched, the email body and attachments will become a `POEvent` of
type `vendor_reply` (new enum value at that time) and the attachments
will become `POAttachment` rows. None of that is implemented yet.

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
`audit_logs` row (security audit). `AuditAction` values added by this
phase: `vendor_created`, `po_created`, `po_created_from_estimate`,
`po_saved`, `po_status_changed`, `po_qbo_number_set`, `po_vendor_set`,
`po_attachment_added`, `po_attachment_deleted`, `po_note_added`,
`po_deleted`, `estimate_finalized`, `estimate_unfinalized`.
