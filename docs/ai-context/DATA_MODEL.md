# DATA_MODEL — B Visible

The Prisma schema lives in `packages/db/prisma/schema.prisma`. This file is the
human-readable map. Update it whenever the schema changes.

## Currently shipped (foundation + auth + estimates)

```prisma
enum Role { SUPER_ADMIN  ADMIN  USER }

model Tenant {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  users     User[]
  invites   UserInvite[]
  @@map("tenants")
}

model User {
  id               String   @id @default(cuid())
  tenantId         String?              // null for SUPER_ADMIN
  email            String
  name             String?
  role             Role     @default(USER)
  passwordHash     String?              // null until invite accepted
  lastLoginAt      DateTime?
  disabledAt       DateTime?            // soft-disable; verifyAuth refuses
  invitedAt        DateTime?
  inviteAcceptedAt DateTime?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  tenant           Tenant?  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  sessions         Session[]
  resetTokens      PasswordResetToken[]
  invitesIssued    UserInvite[]         @relation("UserInviteInviter")
  @@unique([tenantId, email], name: "tenant_email_unique")
  @@index([tenantId])
  @@index([role])
  @@map("users")
}

model Session {
  id         String    @id @default(cuid())
  userId     String
  tokenHash  String    @unique          // SHA-256 of the cookie token
  expiresAt  DateTime
  createdAt  DateTime  @default(now())
  lastSeenAt DateTime  @default(now())
  ipAddress  String?
  userAgent  String?
  revokedAt  DateTime?
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@index([expiresAt])
  @@map("sessions")
}

model UserInvite {
  id          String    @id @default(cuid())
  tenantId    String?                    // SUPER_ADMIN invites are tenant-less
  email       String
  role        Role
  tokenHash   String    @unique          // SHA-256 of the link token
  invitedById String
  expiresAt   DateTime
  acceptedAt  DateTime?
  createdAt   DateTime  @default(now())
  tenant      Tenant?   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  invitedBy   User      @relation("UserInviteInviter", fields: [invitedById], references: [id], onDelete: Restrict)
  @@index([tenantId])
  @@index([email])
  @@index([expiresAt])
  @@map("user_invites")
}

model PasswordResetToken {
  id        String    @id @default(cuid())
  userId    String
  tokenHash String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@index([expiresAt])
  @@map("password_reset_tokens")
}

model AuditLog {
  id         String   @id @default(cuid())
  tenantId   String?
  userId     String?
  action     String                     // see AuditAction in apps/web/lib/auth/audit.ts
  targetType String?
  targetId   String?
  ipAddress  String?
  userAgent  String?
  metadata   Json?                      // NEVER raw passwords or token plaintexts
  createdAt  DateTime @default(now())
  @@index([tenantId, createdAt])
  @@index([userId, createdAt])
  @@index([action, createdAt])
  @@map("audit_logs")
}

enum EstimateStatus { DRAFT  SENT  APPROVED  REJECTED }
enum EstimateLineKind { MATERIAL  MACHINE  LABOR  DESIGN  INSTALL  MISC }

model Client {
  id          String    @id @default(cuid())
  tenantId    String                                            // never null
  companyName String
  contactName String?
  email       String?
  phone       String?
  notes       String?
  deletedAt   DateTime?                                          // soft delete
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  tenant    Tenant     @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  estimates Estimate[]
  @@index([tenantId, companyName])
  @@index([tenantId, deletedAt])
  @@map("clients")
}

model Machine {
  id               String   @id @default(cuid())
  tenantId         String
  name             String
  ratePerHourCents Int                                          // integer cents per hour
  isActive         Boolean  @default(true)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  tenant Tenant             @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  lines  EstimateLineItem[]
  @@unique([tenantId, name])
  @@index([tenantId, isActive])
  @@map("machines")
}

model Estimate {
  id                String         @id @default(cuid())
  tenantId          String
  clientId          String
  number            String                                      // EST-NNNNNN, per-tenant
  title             String
  status            EstimateStatus @default(DRAFT)
  multiplierMilli   Int            @default(3000)                // 3.000× sell multiplier (R-EST-01)
  designFlatCents   Int            @default(15000)               // $150 flat, set 0 to waive
  notes             String?
  // Cached totals — recomputed by @bvisible/pricing inside save tx.
  subtotalCostCents Int            @default(0)
  finalPriceCents   Int            @default(0)
  createdById       String
  deletedAt         DateTime?
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt
  tenant    Tenant             @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  client    Client             @relation(fields: [clientId], references: [id], onDelete: Restrict)
  createdBy User               @relation("EstimateCreator", fields: [createdById], references: [id], onDelete: Restrict)
  lines     EstimateLineItem[]
  @@unique([tenantId, number])
  @@index([tenantId, status, updatedAt])
  @@index([tenantId, clientId])
  @@index([tenantId, deletedAt])
  @@map("estimates")
}

model EstimateLineItem {
  id                String           @id @default(cuid())
  tenantId          String
  estimateId        String
  sortOrder         Int                                          // explicit, 0-based
  kind              EstimateLineKind                             // discriminator → engine bucket
  description       String
  qtyMilli          Int              @default(1000)              // qty × 1000 (1.5h = 1500)
  unitCostCents     Int              @default(0)
  computedCostCents Int              @default(0)                 // cached, refreshed on save
  machineId         String?                                      // only meaningful for kind=MACHINE
  notes             String?
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt
  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  estimate Estimate @relation(fields: [estimateId], references: [id], onDelete: Cascade)
  machine  Machine? @relation(fields: [machineId], references: [id], onDelete: SetNull)
  @@index([tenantId, estimateId, sortOrder])
  @@index([estimateId, sortOrder])
  @@map("estimate_line_items")
}
```

Notes:

- `User.tenantId` is nullable specifically to allow `SUPER_ADMIN`
  accounts that do not belong to any tenant. Tenant users have a unique
  `(tenantId, email)`. Postgres treats NULLs as distinct in a regular
  composite unique, so the `20260513192157_auth_and_invites` migration
  hand-adds a partial unique index `users_email_super_admin_key` on
  `users(email) WHERE "tenantId" IS NULL` to close that hole. Hand-edit
  is necessary because Prisma's schema language can't express partial
  indexes.
- `passwordHash` is nullable so we can model the invited-but-not-accepted
  state. The login flow rejects users with a NULL hash with the same
  generic "invalid credentials" message and the same response time as a
  bad password (it does a real `hashPassword(input)` to match argon2's
  ~50ms cost — see `apps/web/app/(auth)/login/actions.ts`).
- Tokens (session/invite/reset) are stored as SHA-256 hashes. The raw
  token only ever lives in the user's cookie (session) or in the invite
  / reset URL the user holds. A DB leak does not leak live tokens.

## Migrations

| Name | Date | What |
|---|---|---|
| `20260513180326_init` | 2026-05-13 | `Role` enum, `tenants`, `users`, indexes, `tenantId` FK. |
| `20260513192157_auth_and_invites` | 2026-05-13 | New columns on `users` (`lastLoginAt`, `disabledAt`, `invitedAt`, `inviteAcceptedAt`); new tables `sessions`, `user_invites`, `password_reset_tokens`, `audit_logs`; partial unique index `users_email_super_admin_key`. Generated against a shadow Postgres on the server (`server-scripts/db/.shadow-migrate.sh`) so the production DB was not touched until the deploy ran `migrate deploy`. |
| `20260513221527_estimates_clients_machines` | 2026-05-13 | New enums `EstimateStatus`, `EstimateLineKind`; new tables `clients`, `machines`, `estimates`, `estimate_line_items`. All tenant-scoped, all money in integer cents, qty in `qtyMilli`. Indexes for `(tenantId, *)` lookups and `unique(tenantId, number)` on estimates. Generated via the same shadow-Postgres workflow; `.shadow-migrate.sh` was extended with a `--append-superadmin-index` flag (default off) so it no longer hand-appends the SUPER_ADMIN partial unique index for every migration. |

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

## Generating new migrations

- One migration per logical change. Name them descriptively
  (`20260520_add_qbo_po_number`).
- Migrations must be reversible whenever possible. If a destructive step is
  required, document it in the PR description and in `CHANGELOG_AI.md`.
- **Production applies migrations via `prisma migrate deploy`** (run
  from `deploy-once.sh`). Never use `prisma db push` or `prisma migrate
  dev` against the production DB — they can destroy data.
- **Preferred workflow: shadow Postgres on the server** —
  `server-scripts/db/.shadow-migrate.sh /tmp/new-schema.prisma
  <migration_name>` brings up a temporary Postgres on `:5433`
  (project `bvisible-shadow`), applies existing migrations to it, runs
  `prisma migrate dev --create-only`, lets you append any hand-written
  SQL (e.g. partial unique indexes), validates by re-applying, and
  tears down. The production DB is never touched. SCP the resulting
  migration directory back into the repo and commit it alongside the
  schema change. The next deploy applies it via `migrate deploy` and
  `db-verify.sh` confirms key tables exist before PM2 reload.

> When the actual schema lands, replace the ASCII diagram above with the
> generated DB ML or paste the relevant `model` blocks here.
