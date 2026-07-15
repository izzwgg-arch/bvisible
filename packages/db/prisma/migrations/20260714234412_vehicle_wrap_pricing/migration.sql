-- CreateTable
CREATE TABLE "vehicle_wrap_pricing" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "trimId" TEXT,
    "productName" VARCHAR(200),
    "variant" VARCHAR(220),
    "wheelbase" VARCHAR(120),
    "height" VARCHAR(120),
    "roofWrapOption" VARCHAR(80),
    "extraVersion1" VARCHAR(120),
    "extraOption1" VARCHAR(120),
    "extraOption2" VARCHAR(120),
    "charge" DECIMAL(10,2),
    "sku" VARCHAR(80),
    "squareFootage" INTEGER,
    "ratePerSf" DECIMAL(10,2),
    "pricingRule" VARCHAR(400),
    "exportNote" VARCHAR(200),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_wrap_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_wrap_pricing_tenantId_modelId_sortOrder_idx" ON "vehicle_wrap_pricing"("tenantId", "modelId", "sortOrder");

-- CreateIndex
CREATE INDEX "vehicle_wrap_pricing_tenantId_trimId_idx" ON "vehicle_wrap_pricing"("tenantId", "trimId");

-- CreateIndex
CREATE INDEX "vehicle_wrap_pricing_tenantId_sku_idx" ON "vehicle_wrap_pricing"("tenantId", "sku");

-- AddForeignKey
ALTER TABLE "vehicle_wrap_pricing" ADD CONSTRAINT "vehicle_wrap_pricing_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_wrap_pricing" ADD CONSTRAINT "vehicle_wrap_pricing_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "vehicle_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_wrap_pricing" ADD CONSTRAINT "vehicle_wrap_pricing_trimId_fkey" FOREIGN KEY ("trimId") REFERENCES "vehicle_trims"("id") ON DELETE SET NULL ON UPDATE CASCADE;
