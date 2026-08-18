-- Amazon Business cXML PunchOut + approval-gated ordering.
--
-- PunchOut borrows Amazon's catalog: the employee shops a real Amazon cart and
-- Amazon posts it BACK to us, where it becomes a DRAFT purchase order carrying
-- real ASINs, real prices, and real product URLs. Nothing is purchased at that
-- point. Placing the order is a separate, explicitly approved step, recorded
-- in amazon_order_submissions.

CREATE TYPE "AmazonPunchoutStatus" AS ENUM ('STARTED', 'RETURNED', 'EXPIRED');
CREATE TYPE "AmazonOrderStatus" AS ENUM ('PLACED', 'FAILED');

ALTER TYPE "POEventKind" ADD VALUE 'AMAZON_PUNCHOUT_RETURNED';
ALTER TYPE "POEventKind" ADD VALUE 'AMAZON_ORDER_PLACED';
ALTER TYPE "POEventKind" ADD VALUE 'AMAZON_ORDER_FAILED';

-- One shopping session. buyerCookie is a SECRET, not just a correlation id:
-- Amazon returns the cart as a cross-site browser POST with no session cookie,
-- so this value is the only proof the cart belongs to this tenant and user.
-- UNIQUE enforces the single-use property that stops a captured POST from
-- being replayed into a second order.
CREATE TABLE "amazon_punchout_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "buyerCookie" TEXT NOT NULL,
    "status" "AmazonPunchoutStatus" NOT NULL DEFAULT 'STARTED',
    "startPageUrl" TEXT,
    "purchaseOrderId" TEXT,
    "returnedAt" TIMESTAMP(3),
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "amazon_punchout_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "amazon_punchout_sessions_buyerCookie_key" ON "amazon_punchout_sessions"("buyerCookie");
CREATE INDEX "amazon_punchout_sessions_tenantId_status_createdAt_idx" ON "amazon_punchout_sessions"("tenantId", "status", "createdAt");
CREATE INDEX "amazon_punchout_sessions_tenantId_purchaseOrderId_idx" ON "amazon_punchout_sessions"("tenantId", "purchaseOrderId");

-- One row per ATTEMPT to place the order. A PO with an existing PLACED row is
-- never submitted again — Amazon would ship it twice.
CREATE TABLE "amazon_order_submissions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    -- Correlation key echoed back by Amazon; unique per attempt.
    "payloadId" TEXT NOT NULL,
    "status" "AmazonOrderStatus" NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "responseCode" INTEGER,
    -- Amazon's protocol status line, for admin diagnosis. The shared secret is
    -- stripped before anything is stored or logged.
    "responseText" VARCHAR(500),
    -- Short safe label only ('rejected', 'send_failed', ...) — never a
    -- provider message or credential, since this is rendered to the user.
    "failureCategory" VARCHAR(60),
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "placedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "amazon_order_submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "amazon_order_submissions_payloadId_key" ON "amazon_order_submissions"("payloadId");
CREATE INDEX "amazon_order_submissions_tenantId_purchaseOrderId_createdAt_idx" ON "amazon_order_submissions"("tenantId", "purchaseOrderId", "createdAt");

ALTER TABLE "amazon_punchout_sessions" ADD CONSTRAINT "amazon_punchout_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "amazon_punchout_sessions" ADD CONSTRAINT "amazon_punchout_sessions_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "amazon_punchout_sessions" ADD CONSTRAINT "amazon_punchout_sessions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "amazon_order_submissions" ADD CONSTRAINT "amazon_order_submissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "amazon_order_submissions" ADD CONSTRAINT "amazon_order_submissions_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "amazon_order_submissions" ADD CONSTRAINT "amazon_order_submissions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
