# BILLING — B Visible (sales invoices)

Tenant-scoped **sales invoices** complement **purchase orders** (vendor spend). They are **visibility + workflow orchestration only**: nothing posts to QuickBooks automatically, nothing reconciles bank feeds, and nothing marks estimates finalized/paid unless operators take explicit actions documented elsewhere.

## Data model (Prisma)

- **`Invoice`** — `tenantId`, `number` (`INV-######` via tenant sequence lock **`invoice`**), `clientId`, optional **`estimateId`** (**`@@unique([tenantId, estimateId])`** — one active conversion target per estimate while the row exists), **`InvoiceStatus`** (`UNPAID` | `PAID` | `VOIDED`), **`subtotalCents`** (sell snapshot at creation), optional notes, **`paidAt`** when **`PAID`**, soft-delete **`deletedAt`**.
- **`InvoiceLineItem`** — mirrors estimate line kinds/descriptions/qty with **`lineTotalCents`** allocated from **`Estimate.finalPriceCents`** via **`allocateEstimateSellToInvoiceLines`** (largest remainder over **`computedCostCents`** weights; equal split when weights sum to zero).

## Conversion (`createInvoiceFromEstimateAction`)

- Allowed only when **`Estimate.status === APPROVED`** and **no** existing non-deleted invoice rows for that **`estimateId`**.
- Copies customer (`clientId`), lines (allocated sell cents per line), notes trim, and stamps **`estimateId`** on the invoice.
- Side effects: **`EstimateTimelineKind.INVOICE_CREATED_FROM_ESTIMATE`** (+ metadata `{ invoiceId, invoiceNumber }`), audit **`invoice_created_from_estimate`** (`apps/web/lib/auth/audit.ts`).
- **Never** auto-finalizes estimates, **never** auto-marks paid.

## Payment toggle (`markInvoicePaidAction`)

- **`UNPAID` → `PAID`** with **`paidAt = now()`**, audit **`invoice_marked_paid`**. No background jobs; operators explicitly click **Mark paid** on **`/invoices/[id]`**.

## UI surfaces

- **`/estimates/[id]`** — **`EstimateFulfillmentPanel`**: operational milestones rail + Quote→PO→Invoice→Paid strip + **Create invoice** CTA + linked invoice chip/paid banner.
- **`/invoices`** / **`/invoices/[id]`** — list/detail; estimate-backed invoices render **`InvoiceEstimateOriginSection`** (quote summary + linked PO count + workspace links).
- **`/dashboard`** — **`getDashboardEstimateInvoiceFlow`**: approved estimates missing invoices; unpaid estimate-linked invoices; recently paid estimate-linked rows (**`paidAt`** sort).

## Ops checklist

- Run **`pnpm prisma migrate deploy`** on servers whenever **`packages/db/prisma/migrations/*invoices*`** ships — invoices UI depends on the schema + enums.

See also: **`ESTIMATE_ENGINE.md`** (estimate lifecycle), **`API_STRUCTURE.md`** (server actions table), **`CHANGELOG_AI.md`** (release notes).
