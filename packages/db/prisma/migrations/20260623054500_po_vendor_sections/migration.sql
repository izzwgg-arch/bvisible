-- Add vendor-section state and source metadata for multi-vendor purchase orders.

ALTER TYPE "POEventKind" ADD VALUE IF NOT EXISTS 'VENDOR_PO_SENT';
ALTER TYPE "POEventKind" ADD VALUE IF NOT EXISTS 'VENDOR_PO_SEND_FAILED';

CREATE TYPE "POVendorSendStatus" AS ENUM ('DRAFT', 'SENT', 'FAILED');

ALTER TABLE "po_line_items"
  ADD COLUMN "estimateLineId" TEXT,
  ADD COLUMN "catalogItemId" TEXT,
  ADD COLUMN "bundleComponentId" TEXT,
  ADD COLUMN "vendorId" TEXT,
  ADD COLUMN "selectedVendorMode" "VendorCostSourceMode",
  ADD COLUMN "vendorSku" TEXT,
  ADD COLUMN "unit" "ShopCatalogUnit" NOT NULL DEFAULT 'EACH',
  ADD COLUMN "receivedQtyMilli" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "purchase_order_vendors" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "status" "POVendorSendStatus" NOT NULL DEFAULT 'DRAFT',
  "sentAt" TIMESTAMP(3),
  "messageId" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "purchase_order_vendors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_order_vendors_purchaseOrderId_vendorId_key"
  ON "purchase_order_vendors"("purchaseOrderId", "vendorId");
CREATE INDEX "purchase_order_vendors_tenantId_purchaseOrderId_idx"
  ON "purchase_order_vendors"("tenantId", "purchaseOrderId");
CREATE INDEX "purchase_order_vendors_tenantId_vendorId_idx"
  ON "purchase_order_vendors"("tenantId", "vendorId");

CREATE INDEX "po_line_items_tenantId_vendorId_idx"
  ON "po_line_items"("tenantId", "vendorId");
CREATE INDEX "po_line_items_tenantId_estimateLineId_idx"
  ON "po_line_items"("tenantId", "estimateLineId");
CREATE INDEX "po_line_items_tenantId_catalogItemId_idx"
  ON "po_line_items"("tenantId", "catalogItemId");
CREATE INDEX "po_line_items_tenantId_bundleComponentId_idx"
  ON "po_line_items"("tenantId", "bundleComponentId");

ALTER TABLE "po_line_items"
  ADD CONSTRAINT "po_line_items_estimateLineId_fkey"
    FOREIGN KEY ("estimateLineId") REFERENCES "estimate_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "po_line_items_catalogItemId_fkey"
    FOREIGN KEY ("catalogItemId") REFERENCES "shop_material_items"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "po_line_items_bundleComponentId_fkey"
    FOREIGN KEY ("bundleComponentId") REFERENCES "bundle_components"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "po_line_items_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_order_vendors"
  ADD CONSTRAINT "purchase_order_vendors_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_order_vendors_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_order_vendors_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
