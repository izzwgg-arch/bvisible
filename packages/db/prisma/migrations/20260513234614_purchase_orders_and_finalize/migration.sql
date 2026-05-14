-- CreateEnum
CREATE TYPE "POStatus" AS ENUM ('DRAFT', 'SENT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELED');

-- CreateEnum
CREATE TYPE "POLineKind" AS ENUM ('MATERIAL', 'MACHINE', 'LABOR', 'DESIGN', 'INSTALL', 'MISC');

-- CreateEnum
CREATE TYPE "POAttachmentKind" AS ENUM ('RECEIPT', 'INVOICE', 'VENDOR_DOC', 'DRAWING', 'OTHER');

-- CreateEnum
CREATE TYPE "POEventKind" AS ENUM ('CREATED', 'CREATED_FROM_ESTIMATE', 'LINES_SAVED', 'STATUS_CHANGED', 'QBO_NUMBER_ASSIGNED', 'VENDOR_ASSIGNED', 'ATTACHMENT_ADDED', 'ATTACHMENT_DELETED', 'NOTE_ADDED', 'CANCELED');

-- AlterEnum
ALTER TYPE "EstimateStatus" ADD VALUE 'FINALIZED';

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "estimateId" TEXT,
    "vendorId" TEXT,
    "number" TEXT NOT NULL,
    "qboPoNumber" TEXT,
    "status" "POStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "po_line_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "kind" "POLineKind" NOT NULL,
    "description" TEXT NOT NULL,
    "qtyMilli" INTEGER NOT NULL DEFAULT 1000,
    "unitCostCents" INTEGER NOT NULL DEFAULT 0,
    "computedCostCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "po_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "po_attachments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "kind" "POAttachmentKind" NOT NULL DEFAULT 'OTHER',
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "po_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "po_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "kind" "POEventKind" NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "po_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendors_tenantId_deletedAt_idx" ON "vendors"("tenantId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_tenantId_name_key" ON "vendors"("tenantId", "name");

-- CreateIndex
CREATE INDEX "purchase_orders_tenantId_status_updatedAt_idx" ON "purchase_orders"("tenantId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "purchase_orders_tenantId_estimateId_idx" ON "purchase_orders"("tenantId", "estimateId");

-- CreateIndex
CREATE INDEX "purchase_orders_tenantId_vendorId_idx" ON "purchase_orders"("tenantId", "vendorId");

-- CreateIndex
CREATE INDEX "purchase_orders_tenantId_qboPoNumber_idx" ON "purchase_orders"("tenantId", "qboPoNumber");

-- CreateIndex
CREATE INDEX "purchase_orders_tenantId_deletedAt_idx" ON "purchase_orders"("tenantId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenantId_number_key" ON "purchase_orders"("tenantId", "number");

-- CreateIndex
CREATE INDEX "po_line_items_tenantId_purchaseOrderId_sortOrder_idx" ON "po_line_items"("tenantId", "purchaseOrderId", "sortOrder");

-- CreateIndex
CREATE INDEX "po_line_items_purchaseOrderId_sortOrder_idx" ON "po_line_items"("purchaseOrderId", "sortOrder");

-- CreateIndex
CREATE INDEX "po_attachments_tenantId_purchaseOrderId_createdAt_idx" ON "po_attachments"("tenantId", "purchaseOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "po_events_tenantId_purchaseOrderId_createdAt_idx" ON "po_events"("tenantId", "purchaseOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "po_events_purchaseOrderId_createdAt_idx" ON "po_events"("purchaseOrderId", "createdAt");

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "estimates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_line_items" ADD CONSTRAINT "po_line_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_line_items" ADD CONSTRAINT "po_line_items_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_attachments" ADD CONSTRAINT "po_attachments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_attachments" ADD CONSTRAINT "po_attachments_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_attachments" ADD CONSTRAINT "po_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_events" ADD CONSTRAINT "po_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_events" ADD CONSTRAINT "po_events_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_events" ADD CONSTRAINT "po_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
