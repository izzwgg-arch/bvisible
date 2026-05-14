# DATA_MODEL — B Visible

The Prisma schema lives in `packages/db/prisma/schema.prisma`. This file is the
human-readable map. Update it whenever the schema changes.

## Currently shipped (foundation + auth + estimates + purchase orders + email ingestion + vendor pricing observations)

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

enum EstimateStatus { DRAFT  SENT  APPROVED  REJECTED  FINALIZED }
enum EstimateLineKind { MATERIAL  MACHINE  LABOR  DESIGN  INSTALL  MISC }
enum POStatus { DRAFT  SENT  ORDERED  PARTIALLY_RECEIVED  RECEIVED  CANCELED }
enum POLineKind { MATERIAL  MACHINE  LABOR  DESIGN  INSTALL  MISC }
enum POAttachmentKind { RECEIPT  INVOICE  VENDOR_INVOICE  INSTALL_PHOTO  FIELD_DOCUMENT  VENDOR_DOC  DRAWING  OTHER  EMAIL_ATTACHMENT }
enum POEventKind {
  CREATED  CREATED_FROM_ESTIMATE  LINES_SAVED  STATUS_CHANGED
  QBO_NUMBER_ASSIGNED  VENDOR_ASSIGNED  ATTACHMENT_ADDED
  ATTACHMENT_DELETED  NOTE_ADDED  CANCELED  VENDOR_REPLY  VENDOR_LOWER_PRICE
}
enum EmailIngestStatus { PENDING  MATCHED  UNMATCHED  FAILED  DISMISSED }
enum EmailMatchReason  { QBO_NUMBER  PO_NUMBER  VENDOR_AND_RECENT  MANUAL  NONE }
enum VendorPriceConfidence { HIGH  MEDIUM  LOW }
enum VendorPriceExtractionMethod { LINE_REGEX  SUBJECT_REGEX  FILENAME_REGEX }

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

model Vendor {
  id        String    @id @default(cuid())
  tenantId  String
  name      String
  email     String?
  phone     String?
  notes     String?
  deletedAt DateTime?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  tenant         Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  purchaseOrders PurchaseOrder[]
  catalogItems   VendorCatalogItem[]
  itemAliases    VendorItemAlias[]
  priceHistory   VendorPriceHistory[]
  priceNotifications VendorPriceNotification[]
  @@unique([tenantId, name])
  @@index([tenantId, deletedAt])
  @@map("vendors")
}

model PurchaseOrder {
  id            String    @id @default(cuid())
  tenantId      String
  estimateId    String?                                          // nullable: blank POs allowed
  vendorId      String?                                          // nullable: pick vendor later
  number        String                                           // PO-NNNNNN, per-tenant
  qboPoNumber   String?                                          // pasted manually after QBO entry
  status        POStatus  @default(DRAFT)
  subtotalCents Int       @default(0)                            // cached sum of line costs
  notes         String?
  createdById   String
  deletedAt     DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  tenant      Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  estimate    Estimate?      @relation(fields: [estimateId], references: [id], onDelete: SetNull)
  vendor      Vendor?        @relation(fields: [vendorId], references: [id], onDelete: SetNull)
  createdBy   User           @relation("POCreator", fields: [createdById], references: [id], onDelete: Restrict)
  lines       POLineItem[]
  attachments POAttachment[]
  events      POEvent[]
  @@unique([tenantId, number])
  @@index([tenantId, status, updatedAt])
  @@index([tenantId, estimateId])
  @@index([tenantId, vendorId])
  @@index([tenantId, qboPoNumber])
  @@index([tenantId, deletedAt])
  @@map("purchase_orders")
}

model POLineItem {
  id                String     @id @default(cuid())
  tenantId          String
  purchaseOrderId   String
  sortOrder         Int
  kind              POLineKind                                   // mirrors EstimateLineKind
  description       String
  qtyMilli          Int        @default(1000)
  unitCostCents     Int        @default(0)
  computedCostCents Int        @default(0)
  notes             String?
  createdAt         DateTime   @default(now())
  updatedAt         DateTime   @updatedAt
  tenant        Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  purchaseOrder PurchaseOrder @relation(fields: [purchaseOrderId], references: [id], onDelete: Cascade)
  @@index([tenantId, purchaseOrderId, sortOrder])
  @@index([purchaseOrderId, sortOrder])
  @@map("po_line_items")
}

model POAttachment {
  id               String           @id @default(cuid())
  tenantId         String
  purchaseOrderId  String
  storageKey       String                                        // server-generated random filename
  originalFilename String                                        // sanitized; display only
  mimeType         String                                        // server-detected at upload (magic bytes)
  sizeBytes        Int
  kind             POAttachmentKind @default(OTHER)
  uploadedById     String
  createdAt        DateTime         @default(now())
  tenant        Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  purchaseOrder PurchaseOrder @relation(fields: [purchaseOrderId], references: [id], onDelete: Cascade)
  uploadedBy    User          @relation("POAttachmentUploader", fields: [uploadedById], references: [id], onDelete: Restrict)
  @@index([tenantId, purchaseOrderId, createdAt])
  @@map("po_attachments")
}

model POEvent {
  id              String      @id @default(cuid())
  tenantId        String
  purchaseOrderId String
  kind            POEventKind                                    // see enum above
  message         String
  metadata        Json?
  actorId         String?                                        // null for system events
  sourceEmailId   String?                                        // non-null for VENDOR_REPLY / VENDOR_LOWER_PRICE rows driven by email ingestion
  createdAt       DateTime    @default(now())
  tenant        Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  purchaseOrder PurchaseOrder  @relation(fields: [purchaseOrderId], references: [id], onDelete: Cascade)
  actor         User?          @relation("POEventActor", fields: [actorId], references: [id], onDelete: SetNull)
  sourceEmail   IngestedEmail? @relation(fields: [sourceEmailId], references: [id], onDelete: SetNull)
  @@index([tenantId, purchaseOrderId, createdAt])
  @@index([purchaseOrderId, createdAt])
  @@index([sourceEmailId])
  @@map("po_events")
}

model TenantEmailInbox {
  id                  String    @id @default(cuid())
  tenantId            String    @unique
  host                String
  port                Int
  secure              Boolean   @default(true)
  mailbox             String    @default("INBOX")
  username            String
  passwordCipher      String                                      // base64(iv|tag|ciphertext); see apps/web/lib/email-ingest/crypto.ts
  pollIntervalSeconds Int       @default(60)
  enabled             Boolean   @default(true)
  lastPolledAt        DateTime?
  lastErrorAt         DateTime?
  lastErrorMessage    String?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@map("tenant_email_inboxes")
}

model IngestedEmail {
  id                String           @id @default(cuid())
  tenantId          String
  messageId         String                                          // RFC 5322 Message-ID header
  fromAddress       String
  fromName          String?
  toAddress         String?
  subject           String
  receivedAt        DateTime                                        // envelope `Date:` header
  status            EmailIngestStatus @default(PENDING)
  matchReason       EmailMatchReason  @default(NONE)
  matchedPurchaseOrderId String?
  matchedVendorId   String?
  matchHint         String?
  bodyTextSnippet   String?                                         // first ~2 KB of plain text, sanitized
  hasAttachments    Boolean           @default(false)
  attachmentCount   Int               @default(0)
  errorMessage      String?
  processedAt       DateTime?
  retriedAt         DateTime?
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt
  tenant            Tenant                    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  matchedPurchaseOrder PurchaseOrder?         @relation("MatchedPO", fields: [matchedPurchaseOrderId], references: [id], onDelete: SetNull)
  matchedVendor     Vendor?                   @relation("MatchedVendor", fields: [matchedVendorId], references: [id], onDelete: SetNull)
  attachments       IngestedEmailAttachment[]
  poAttachments     POAttachment[]
  poEvents          POEvent[]
  vendorPriceHistoryRows VendorPriceHistory[]
  vendorPriceNotifications VendorPriceNotification[]
  @@unique([tenantId, messageId])                                   // R-MAIL-01
  @@index([tenantId, status, createdAt])
  @@index([tenantId, matchedPurchaseOrderId])
  @@index([tenantId, fromAddress, createdAt])
  @@map("ingested_emails")
}

model IngestedEmailAttachment {
  id               String   @id @default(cuid())
  tenantId         String
  ingestedEmailId  String
  storageKey       String                                            // server-generated random; bytes live under /opt/bvisible/shared/uploads/<tenantId>/email/<emailId>/<storageKey>
  originalFilename String                                            // sanitized; display only
  mimeType         String                                            // server-detected magic-byte
  sizeBytes        Int
  sha256           String                                            // hex; for dedupe + integrity
  skipped          Boolean  @default(false)                          // true when MIME outside allowlist
  skipReason       String?
  createdAt        DateTime @default(now())
  tenant         Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  ingestedEmail  IngestedEmail @relation(fields: [ingestedEmailId], references: [id], onDelete: Cascade)
  vendorPriceHistoryRows VendorPriceHistory[]
  @@index([tenantId, ingestedEmailId])
  @@index([sha256])
  @@map("ingested_email_attachments")
}

model VendorCatalogItem {
  id               String   @id @default(cuid())
  tenantId         String
  vendorId         String
  nameNormalized   String   @db.VarChar(400)
  createdAt        DateTime @default(now())
  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  vendor Vendor @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  aliases VendorItemAlias[]
  priceHistory VendorPriceHistory[]
  priceNotifications VendorPriceNotification[]
  @@unique([tenantId, vendorId, nameNormalized])
  @@index([tenantId, vendorId])
  @@map("vendor_catalog_items")
}

model VendorItemAlias {
  id                   String   @id @default(cuid())
  tenantId             String
  vendorId             String
  vendorCatalogItemId  String
  aliasNormalized      String   @db.VarChar(400)
  createdAt            DateTime @default(now())
  tenant      Tenant            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  vendor      Vendor            @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  catalogItem VendorCatalogItem @relation(fields: [vendorCatalogItemId], references: [id], onDelete: Cascade)
  @@unique([tenantId, vendorId, aliasNormalized])
  @@index([tenantId, vendorCatalogItemId])
  @@map("vendor_item_aliases")
}

model VendorPriceHistory {
  id                   String                     @id @default(cuid())
  tenantId             String
  vendorId             String
  vendorCatalogItemId  String
  itemNameRaw          String                     @db.VarChar(500)
  itemNameNormalized   String                     @db.VarChar(400)
  priceCents           Int
  unit                 String?                    @db.VarChar(40)
  quantityMilli        Int?
  sourceEmailId        String
  sourceAttachmentId   String?
  confidence           VendorPriceConfidence
  extractionMethod     VendorPriceExtractionMethod
  dedupeKey            String                     @db.VarChar(64)
  createdAt            DateTime                   @default(now())
  tenant           Tenant                 @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  vendor           Vendor                 @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  catalogItem      VendorCatalogItem      @relation(fields: [vendorCatalogItemId], references: [id], onDelete: Cascade)
  sourceEmail      IngestedEmail          @relation(fields: [sourceEmailId], references: [id], onDelete: Cascade)
  sourceAttachment IngestedEmailAttachment? @relation(fields: [sourceAttachmentId], references: [id], onDelete: SetNull)
  @@unique([tenantId, dedupeKey])
  @@index([tenantId, vendorCatalogItemId, createdAt])
  @@index([tenantId, vendorId, createdAt])
  @@index([sourceEmailId])
  @@map("vendor_price_histories")
}

model VendorPriceNotification {
  id                  String    @id @default(cuid())
  tenantId            String
  vendorId            String
  vendorCatalogItemId String
  oldPriceCents       Int
  newPriceCents       Int
  sourceEmailId       String
  dismissedAt         DateTime?
  createdAt           DateTime  @default(now())
  tenant      Tenant            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  vendor      Vendor            @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  catalogItem VendorCatalogItem @relation(fields: [vendorCatalogItemId], references: [id], onDelete: Cascade)
  sourceEmail IngestedEmail     @relation(fields: [sourceEmailId], references: [id], onDelete: Cascade)
  @@index([tenantId, dismissedAt, createdAt])
  @@index([tenantId, vendorId])
  @@map("vendor_price_notifications")
}

model EmailIngestRun {
  id            String    @id @default(cuid())
  tenantId      String
  startedAt     DateTime  @default(now())
  finishedAt    DateTime?
  durationMs    Int?
  scannedCount  Int       @default(0)
  ingestedCount Int       @default(0)
  matchedCount  Int       @default(0)
  errorCount    Int       @default(0)
  errorMessage  String?
  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@index([tenantId, startedAt])
  @@map("email_ingest_runs")
}
```

`POAttachment` gets a nullable `sourceEmailId` (FK SET NULL) so an
ingested attachment can deep-link back to its source email; the
`po_attachments_sourceEmailId_idx` index supports the reverse lookup.

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
| `20260513234614_purchase_orders_and_finalize` | 2026-05-13 | New enums `POStatus`, `POLineKind`, `POAttachmentKind`, `POEventKind`; `EstimateStatus.FINALIZED` enum value; new tables `vendors`, `purchase_orders`, `po_line_items`, `po_attachments`, `po_events`. Tenant-scoped, integer cents, soft delete via `deletedAt`. Unique on `(tenantId, number)` for POs, `(tenantId, name)` for vendors. Foreign keys: `purchase_orders.estimateId → estimates(id) ON DELETE SET NULL`, `purchase_orders.vendorId → vendors(id) ON DELETE SET NULL`. Generated via shadow Postgres. |
| `20260514005509_email_ingestion_foundation` | 2026-05-14 | New enums `EmailIngestStatus`, `EmailMatchReason`; `POAttachmentKind` gains `EMAIL_ATTACHMENT`; `POEventKind` gains `VENDOR_REPLY`. New tables `tenant_email_inboxes` (1:1 per tenant), `ingested_emails` (UNIQUE `(tenantId, messageId)` for R-MAIL-01 idempotency), `ingested_email_attachments`, `email_ingest_runs`. Adds nullable `sourceEmailId` on `po_attachments` and `po_events` (FK SET NULL → `ingested_emails(id)`). Generated via shadow Postgres; `ALTER TYPE ... ADD VALUE` is run by Postgres 16 in the same migration transaction safely. |
| `20260515083000_mobile_upload_foundation` | 2026-05-15 | `POAttachmentKind` gains `VENDOR_INVOICE`, `INSTALL_PHOTO`, `FIELD_DOCUMENT`. New tables `mobile_sessions` (rotating refresh, device metadata) and `mobile_pending_uploads` (two-phase upload → `POAttachment`). |

## Core entities (target schema)

```
Tenant ──< User
       ├──< Client ──< Project ──< Estimate ──< EstimateLineItem
       │                       └──< PurchaseOrder ──< POLineItem
       │                                          └──< POAttachment
       │                                          └──< POReceipt
       │                                          └──< POEvent (timeline)
       ├──< Vendor ──< VendorCatalogItem ──< VendorPriceHistory
       │            └──< VendorItemAlias
       │            └──< VendorPriceNotification
       ├──< Item   ──< ItemAlias    (vendor-specific item names — future master catalog)
       ├──< Machine                  (rates listed in ESTIMATE_ENGINE.md)
       ├──< IngestedEmail            (messageId unique per tenant)
       └──< VendorPriceNotification (manual-dismiss lower-price alerts)
```

## Hard rules per table

- Every table that belongs to a tenant has a non-nullable `tenantId` and a
  composite index `(tenantId, ...)` on every commonly queried column.
- `IngestedEmail` has a unique constraint on `(tenantId, messageId)` to prevent
  duplicate processing — see `EMAIL_INGESTION.md`.
- `PurchaseOrder.qboPoNumber` (QuickBooks PO number) is required before an
  estimate may be marked finalized — see `PO_SYSTEM.md`.
- `VendorPriceHistory.priceCents` is **integer cents** (see `CODING_STANDARDS.md`).
- `VendorPriceHistory` is append-only. Never `UPDATE` or `DELETE` rows in app
  code; insert a new observation with a fresh `dedupeKey` / timestamp.
  Lower-price UX uses `VendorPriceNotification` + `POEventKind.VENDOR_LOWER_PRICE`.

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
