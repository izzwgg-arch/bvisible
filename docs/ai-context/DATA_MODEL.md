# DATA_MODEL — B Visible

The Prisma schema lives in `packages/db/prisma/schema.prisma`. This file is the
human-readable map. Update it whenever the schema changes.

## Currently shipped (foundation)

Tracked since the `chore: scaffold web app and db foundation` commit.

```prisma
enum Role { SUPER_ADMIN  ADMIN  USER }

model Tenant {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  users     User[]
  @@map("tenants")
}

model User {
  id           String   @id @default(cuid())
  tenantId     String?              // null for SUPER_ADMIN
  email        String
  name         String?
  role         Role     @default(USER)
  passwordHash String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  tenant       Tenant?  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@unique([tenantId, email], name: "tenant_email_unique")
  @@index([tenantId])
  @@index([role])
  @@map("users")
}
```

Notes:
- `User.tenantId` is nullable specifically to allow `SUPER_ADMIN` accounts that
  do not belong to any tenant. Tenant users have a unique `(tenantId, email)`.
- No migrations have been generated yet. `prisma migrate dev` / `migrate deploy`
  will create the first one when a real database is wired in.
- `passwordHash` is nullable because auth is not yet wired (no UI, no
  registration flow). Once auth lands, it is required for accounts that log in
  with a password (Google OAuth users may still leave it null).

## Core entities (target schema)

```
Tenant ──< User
       ├──< Client ──< Project ──< Estimate ──< EstimateLineItem
       │                       └──< PurchaseOrder ──< POLineItem
       │                                          └──< POAttachment
       │                                          └──< POReceipt
       │                                          └──< POEvent (timeline)
       ├──< Vendor ──< VendorPrice ──< VendorPriceHistory
       │            └──< VendorContact (sender email/domain matching)
       ├──< Item   ──< ItemAlias    (vendor-specific item names)
       ├──< Machine                  (rates listed in ESTIMATE_ENGINE.md)
       ├──< IngestedEmail            (messageId unique per tenant)
       └──< Notification             (manual-dismiss flag for price alerts)
```

## Hard rules per table

- Every table that belongs to a tenant has a non-nullable `tenantId` and a
  composite index `(tenantId, ...)` on every commonly queried column.
- `IngestedEmail` has a unique constraint on `(tenantId, messageId)` to prevent
  duplicate processing — see `EMAIL_INGESTION.md`.
- `PurchaseOrder.qboPoNumber` (QuickBooks PO number) is required before an
  estimate may be marked finalized — see `PO_SYSTEM.md`.
- `VendorPrice.unitPriceCents` is **integer cents** (see `CODING_STANDARDS.md`).
- `VendorPriceHistory` is append-only. Never `UPDATE` or `DELETE` rows; insert a
  new row with the new price and `effectiveAt`.

## Soft delete

Tables that support soft delete use `deletedAt` (nullable timestamp).
Filter `deletedAt: null` in every list query.

## Migrations

- One migration per logical change. Name them descriptively
  (`20260520_add_qbo_po_number`).
- Migrations must be reversible whenever possible. If a destructive step is
  required, document it in the PR description and in `CHANGELOG_AI.md`.

> When the actual schema lands, replace the ASCII diagram above with the
> generated DB ML or paste the relevant `model` blocks here.
