-- Mobile API foundation: POAttachmentKind additions + mobile_sessions + mobile_pending_uploads

ALTER TYPE "POAttachmentKind" ADD VALUE 'VENDOR_INVOICE';
ALTER TYPE "POAttachmentKind" ADD VALUE 'INSTALL_PHOTO';
ALTER TYPE "POAttachmentKind" ADD VALUE 'FIELD_DOCUMENT';

CREATE TABLE "mobile_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "deviceLabel" VARCHAR(120),
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mobile_sessions_refreshTokenHash_key" ON "mobile_sessions"("refreshTokenHash");
CREATE INDEX "mobile_sessions_tenantId_userId_idx" ON "mobile_sessions"("tenantId", "userId");
CREATE INDEX "mobile_sessions_userId_revokedAt_idx" ON "mobile_sessions"("userId", "revokedAt");

ALTER TABLE "mobile_sessions" ADD CONSTRAINT "mobile_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mobile_sessions" ADD CONSTRAINT "mobile_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "mobile_pending_uploads" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "storageKey" VARCHAR(120) NOT NULL,
    "kind" "POAttachmentKind" NOT NULL,
    "originalFilename" VARCHAR(200) NOT NULL,
    "declaredSizeBytes" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_pending_uploads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mobile_pending_uploads_tenantId_userId_idx" ON "mobile_pending_uploads"("tenantId", "userId");
CREATE INDEX "mobile_pending_uploads_tenantId_purchaseOrderId_idx" ON "mobile_pending_uploads"("tenantId", "purchaseOrderId");

ALTER TABLE "mobile_pending_uploads" ADD CONSTRAINT "mobile_pending_uploads_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mobile_pending_uploads" ADD CONSTRAINT "mobile_pending_uploads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mobile_pending_uploads" ADD CONSTRAINT "mobile_pending_uploads_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
