-- Invoice foundation (estimate → invoice conversion, explicit operator actions only).

CREATE TYPE "InvoiceStatus" AS ENUM ('UNPAID', 'PAID', 'VOIDED');

ALTER TYPE "EstimateTimelineKind" ADD VALUE 'INVOICE_CREATED_FROM_ESTIMATE';

CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "estimateId" TEXT,
    "clientId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UNPAID',
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "invoice_line_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "kind" "EstimateLineKind" NOT NULL,
    "description" TEXT NOT NULL,
    "qtyMilli" INTEGER NOT NULL DEFAULT 1000,
    "lineTotalCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoices_tenantId_number_key" ON "invoices"("tenantId", "number");

CREATE UNIQUE INDEX "invoices_tenantId_estimateId_key" ON "invoices"("tenantId", "estimateId");

CREATE INDEX "invoices_tenantId_status_updatedAt_idx" ON "invoices"("tenantId", "status", "updatedAt");

CREATE INDEX "invoices_tenantId_estimateId_idx" ON "invoices"("tenantId", "estimateId");

CREATE INDEX "invoices_tenantId_deletedAt_idx" ON "invoices"("tenantId", "deletedAt");

CREATE INDEX "invoice_line_items_tenantId_invoiceId_sortOrder_idx" ON "invoice_line_items"("tenantId", "invoiceId", "sortOrder");

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "estimates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
