-- Ordered Materials receiving checklist: dedicated event kind for
-- full/partial receipts, corrections, reversals, mark-all-arrived, undo.
ALTER TYPE "POEventKind" ADD VALUE 'RECEIVING';

-- Idempotency ledger for the shop-order flow: one row per client
-- submission; replays hit the unique key and return the stored result
-- instead of creating duplicate POs / emails / carts.
CREATE TABLE "shop_order_submissions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" VARCHAR(80) NOT NULL,
    "createdById" TEXT NOT NULL,
    "resultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_order_submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shop_order_submissions_tenantId_requestId_key" ON "shop_order_submissions"("tenantId", "requestId");
