-- CreateEnum
CREATE TYPE "EstimateStatus" AS ENUM ('DRAFT', 'SENT', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EstimateLineKind" AS ENUM ('MATERIAL', 'MACHINE', 'LABOR', 'DESIGN', 'INSTALL', 'MISC');

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ratePerHourCents" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "EstimateStatus" NOT NULL DEFAULT 'DRAFT',
    "multiplierMilli" INTEGER NOT NULL DEFAULT 3000,
    "designFlatCents" INTEGER NOT NULL DEFAULT 15000,
    "notes" TEXT,
    "subtotalCostCents" INTEGER NOT NULL DEFAULT 0,
    "finalPriceCents" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estimates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimate_line_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "kind" "EstimateLineKind" NOT NULL,
    "description" TEXT NOT NULL,
    "qtyMilli" INTEGER NOT NULL DEFAULT 1000,
    "unitCostCents" INTEGER NOT NULL DEFAULT 0,
    "computedCostCents" INTEGER NOT NULL DEFAULT 0,
    "machineId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estimate_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clients_tenantId_companyName_idx" ON "clients"("tenantId", "companyName");

-- CreateIndex
CREATE INDEX "clients_tenantId_deletedAt_idx" ON "clients"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "machines_tenantId_isActive_idx" ON "machines"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "machines_tenantId_name_key" ON "machines"("tenantId", "name");

-- CreateIndex
CREATE INDEX "estimates_tenantId_status_updatedAt_idx" ON "estimates"("tenantId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "estimates_tenantId_clientId_idx" ON "estimates"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "estimates_tenantId_deletedAt_idx" ON "estimates"("tenantId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "estimates_tenantId_number_key" ON "estimates"("tenantId", "number");

-- CreateIndex
CREATE INDEX "estimate_line_items_tenantId_estimateId_sortOrder_idx" ON "estimate_line_items"("tenantId", "estimateId", "sortOrder");

-- CreateIndex
CREATE INDEX "estimate_line_items_estimateId_sortOrder_idx" ON "estimate_line_items"("estimateId", "sortOrder");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machines" ADD CONSTRAINT "machines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_line_items" ADD CONSTRAINT "estimate_line_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_line_items" ADD CONSTRAINT "estimate_line_items_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "estimates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_line_items" ADD CONSTRAINT "estimate_line_items_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
