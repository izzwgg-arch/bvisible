-- Office reminder for retail (Amazon / Home Depot / …) purchase orders.
--
-- One row per SEND ATTEMPT, not one per PO: the newest row is the current
-- state and the older rows are the resend history, so "record every attempt"
-- needs no separate audit table.
--
-- Order creation and reminder delivery are deliberately separate states — a
-- failed reminder leaves the PO, its lines, and its Amazon links untouched,
-- and retrying re-sends the email only.
CREATE TYPE "POReminderStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- Retail product page captured at order time, so "View on Amazon" on the
-- order-ready page survives later Sheet edits. Nullable: existing lines and
-- non-retail lines have none, and the UI hides the button rather than
-- fabricating a link.
ALTER TABLE "po_line_items" ADD COLUMN "productUrl" VARCHAR(1000);

CREATE TABLE "po_office_reminders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    -- 320 = max practical RFC 5321 address length.
    "recipient" VARCHAR(320) NOT NULL,
    "status" "POReminderStatus" NOT NULL DEFAULT 'PENDING',
    -- 1 = automatic send at order creation; 2+ = manual resends.
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "messageId" TEXT,
    -- Short safe label only ('smtp_not_configured', 'invalid_recipient',
    -- 'send_failed') — never a provider message or credential, since this
    -- value is rendered to the user.
    "failureCategory" VARCHAR(60),
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "po_office_reminders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "po_office_reminders_tenantId_purchaseOrderId_createdAt_idx"
    ON "po_office_reminders"("tenantId", "purchaseOrderId", "createdAt");

ALTER TABLE "po_office_reminders"
    ADD CONSTRAINT "po_office_reminders_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "po_office_reminders"
    ADD CONSTRAINT "po_office_reminders_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "po_office_reminders"
    ADD CONSTRAINT "po_office_reminders_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
