# PO_SYSTEM — B Visible

## The PO is the master file

A Purchase Order is the single record around which a job revolves. Everything
else attaches to it:

```
PurchaseOrder
├── linked Estimate           (1:1 in 95% of cases; multi-estimate jobs allowed)
├── Client                    (denormalized for fast read)
├── Vendor documents          (PDFs, proposals, invoices — see EMAIL_INGESTION.md)
├── Receipts                  (mobile uploads from installers — MOBILE_APP.md)
├── Attachments               (photos, drawings, customer-supplied art)
├── Timeline (POEvent[])      (created, sent-to-vendor, received, closed, ...)
└── Price updates             (rows in VendorPriceHistory linked by POId)
```

## QuickBooks PO number

- `PurchaseOrder.qboPoNumber` is **required** before the linked estimate may be
  finalized (R-EST-04).
- The number is entered manually after creating the PO in QuickBooks. Future
  work may automate this through the QBO API; until then the UI prompts the
  user to paste it.
- Vendor email matching uses this number (see below).

## Vendor reply routing

Inbound emails (see `EMAIL_INGESTION.md`) are matched to a PO by the QBO PO
number found in the **subject** or **body** of the email. Matching order:

1. Exact match on `qboPoNumber` in the subject.
2. Exact match in the body (first occurrence).
3. Fallback: vendor + recent date heuristics → review queue.

Once matched, the email body and attachments become a `POEvent` of type
`vendor_reply` and the attachments become `POAttachment` rows.

## Mobile receipts

Receipts uploaded from the mobile app carry the QBO PO number scanned/typed by
the installer. The server attaches them to the matching PO as `POReceipt`
rows. If no match, they go to the review queue.

## Status lifecycle

```
draft → sent → in_progress → received → closed
                 │
                 └── reopened (logged as POEvent; clears `closed`)
```

- Only `purchasing` or higher may transition past `draft`.
- Only `admin`/`owner` may `reopen` a closed PO.

## Required fields before "sent"

- Vendor (resolved)
- Line items with quantities and unit cost (defaults pulled from
  `VendorPrice`)
- `qboPoNumber`
- Ship-to / pickup choice

## Audit

Every status change, attachment add, receipt, and price update writes a
`POEvent`. The timeline is the source of truth for who-did-what-when.
