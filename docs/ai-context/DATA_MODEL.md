# DATA_MODEL — B Visible

The Prisma schema lives in `packages/db/prisma/schema.prisma`. This file is the
human-readable map. Update it whenever the schema changes.

## Currently shipped (foundation + auth)

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
