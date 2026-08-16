-- Admin-managed CC list for purchase-order emails.
--
-- Until now the CC list lived in code (apps/web/lib/emails/outbound-cc.ts:
-- cg@, lt@, sales@ — copied on every estimate AND purchase order). Editing it
-- meant a deploy. This table moves the PURCHASE ORDER list into the database
-- so an admin can change it from the site; estimates keep the code constant
-- until someone asks for that to be configurable too, which is why the list is
-- keyed by document type rather than being one global list.
--
-- Two states are deliberately distinct:
--   row present with emails = '{}'  -> blank on purpose, vendor only, no CC
--   no row at all                   -> nothing configured, also no CC
-- The seed below gives every EXISTING company the previous hard-coded
-- addresses, so nothing changes about who is copied until someone edits the
-- list. Companies created after this migration start with no row, i.e. no CC —
-- a new company should not inherit another company's office addresses.
CREATE TYPE "OutboundDocumentType" AS ENUM ('PURCHASE_ORDER');

CREATE TABLE "outbound_cc_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentType" "OutboundDocumentType" NOT NULL,
    -- Empty array is a real, meaningful value: "send to the vendor only".
    "emails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbound_cc_settings_pkey" PRIMARY KEY ("id")
);

-- One list per company per document type; the send path looks the row up by
-- this pair, and a duplicate would make "which list wins" ambiguous.
CREATE UNIQUE INDEX "outbound_cc_settings_tenantId_documentType_key"
    ON "outbound_cc_settings"("tenantId", "documentType");

ALTER TABLE "outbound_cc_settings"
    ADD CONSTRAINT "outbound_cc_settings_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: carry the previously hard-coded list over for every existing company
-- so this migration changes WHERE the list is stored, not WHO gets copied.
INSERT INTO "outbound_cc_settings" ("id", "tenantId", "documentType", "emails", "createdAt", "updatedAt")
SELECT
    'occ_po_' || "t"."id",
    "t"."id",
    'PURCHASE_ORDER'::"OutboundDocumentType",
    ARRAY['cg@bvisible.us', 'lt@bvisible.us', 'sales@bvisible.us']::TEXT[],
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "tenants" AS "t";
