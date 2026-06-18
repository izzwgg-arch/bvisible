CREATE TYPE "VehicleDimensionConfidenceLevel" AS ENUM ('MANUAL', 'IMPORTED', 'ESTIMATED', 'VERIFIED');
CREATE TYPE "VehiclePhotoType" AS ENUM ('FRONT', 'SIDE', 'REAR', 'INTERIOR', 'HERO', 'PLACEHOLDER');
CREATE TYPE "VehicleTemplateFileType" AS ENUM ('SVG', 'PDF', 'AI', 'EPS', 'PNG', 'JPG', 'OTHER');

CREATE TABLE "vehicle_makes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "country" VARCHAR(120),
    "logoUrl" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_makes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vehicle_models" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "makeId" TEXT NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "bodyClass" VARCHAR(120),
    "vehicleType" VARCHAR(120),
    "firstYear" INTEGER,
    "lastYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_models_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vehicle_trims" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "trimName" VARCHAR(180),
    "generation" VARCHAR(120),
    "bodyStyle" VARCHAR(120),
    "doors" INTEGER,
    "drivetrain" VARCHAR(80),
    "fuelType" VARCHAR(80),
    "engine" VARCHAR(160),
    "transmission" VARCHAR(120),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_trims_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vehicle_dimension_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "trimId" TEXT NOT NULL,
    "sourceName" VARCHAR(180),
    "sourceUrl" VARCHAR(1000),
    "confidenceLevel" "VehicleDimensionConfidenceLevel" NOT NULL DEFAULT 'IMPORTED',
    "lengthIn" DOUBLE PRECISION,
    "widthIn" DOUBLE PRECISION,
    "heightIn" DOUBLE PRECISION,
    "wheelbaseIn" DOUBLE PRECISION,
    "curbWeightLb" DOUBLE PRECISION,
    "grossWeightLb" DOUBLE PRECISION,
    "cargoLengthIn" DOUBLE PRECISION,
    "cargoWidthIn" DOUBLE PRECISION,
    "cargoHeightIn" DOUBLE PRECISION,
    "bedLengthIn" DOUBLE PRECISION,
    "roofLengthIn" DOUBLE PRECISION,
    "roofWidthIn" DOUBLE PRECISION,
    "hoodLengthIn" DOUBLE PRECISION,
    "hoodWidthIn" DOUBLE PRECISION,
    "sideApproxSqFt" DOUBLE PRECISION,
    "roofApproxSqFt" DOUBLE PRECISION,
    "hoodApproxSqFt" DOUBLE PRECISION,
    "rearApproxSqFt" DOUBLE PRECISION,
    "frontApproxSqFt" DOUBLE PRECISION,
    "totalApproxWrapSqFt" DOUBLE PRECISION,
    "notes" VARCHAR(4000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_dimension_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vehicle_photos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "trimId" TEXT,
    "modelId" TEXT,
    "makeId" TEXT,
    "url" VARCHAR(1000) NOT NULL,
    "storageKey" VARCHAR(200),
    "altText" VARCHAR(240),
    "photoType" "VehiclePhotoType" NOT NULL DEFAULT 'HERO',
    "sourceName" VARCHAR(180),
    "sourceUrl" VARCHAR(1000),
    "licenseNote" VARCHAR(1000),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_photos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vehicle_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "trimId" TEXT NOT NULL,
    "templateName" VARCHAR(180) NOT NULL,
    "fileUrl" VARCHAR(1000) NOT NULL,
    "fileType" "VehicleTemplateFileType" NOT NULL DEFAULT 'OTHER',
    "sourceName" VARCHAR(180),
    "sourceUrl" VARCHAR(1000),
    "licenseNote" VARCHAR(1000),
    "driverSideUrl" VARCHAR(1000),
    "passengerSideUrl" VARCHAR(1000),
    "frontUrl" VARCHAR(1000),
    "rearUrl" VARCHAR(1000),
    "roofUrl" VARCHAR(1000),
    "notes" VARCHAR(4000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "estimate_vehicles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "trimId" TEXT,
    "year" INTEGER,
    "make" VARCHAR(160),
    "model" VARCHAR(180),
    "trim" VARCHAR(180),
    "vin" VARCHAR(80),
    "licensePlate" VARCHAR(40),
    "color" VARCHAR(80),
    "wrapType" VARCHAR(120),
    "coverageType" VARCHAR(120),
    "notes" VARCHAR(4000),
    "photoUrl" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estimate_vehicles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vehicle_makes_tenantId_slug_key" ON "vehicle_makes"("tenantId", "slug");
CREATE INDEX "vehicle_makes_tenantId_name_idx" ON "vehicle_makes"("tenantId", "name");

CREATE UNIQUE INDEX "vehicle_models_tenantId_makeId_slug_key" ON "vehicle_models"("tenantId", "makeId", "slug");
CREATE INDEX "vehicle_models_tenantId_makeId_slug_idx" ON "vehicle_models"("tenantId", "makeId", "slug");
CREATE INDEX "vehicle_models_tenantId_name_idx" ON "vehicle_models"("tenantId", "name");

CREATE INDEX "vehicle_trims_tenantId_modelId_year_idx" ON "vehicle_trims"("tenantId", "modelId", "year");
CREATE INDEX "vehicle_trims_tenantId_year_idx" ON "vehicle_trims"("tenantId", "year");
CREATE INDEX "vehicle_trims_tenantId_deletedAt_idx" ON "vehicle_trims"("tenantId", "deletedAt");

CREATE INDEX "vehicle_dimension_profiles_tenantId_trimId_idx" ON "vehicle_dimension_profiles"("tenantId", "trimId");
CREATE INDEX "vehicle_dimension_profiles_tenantId_confidenceLevel_idx" ON "vehicle_dimension_profiles"("tenantId", "confidenceLevel");

CREATE INDEX "vehicle_photos_tenantId_trimId_isPrimary_idx" ON "vehicle_photos"("tenantId", "trimId", "isPrimary");
CREATE INDEX "vehicle_photos_tenantId_modelId_idx" ON "vehicle_photos"("tenantId", "modelId");
CREATE INDEX "vehicle_photos_tenantId_makeId_idx" ON "vehicle_photos"("tenantId", "makeId");

CREATE INDEX "vehicle_templates_tenantId_trimId_idx" ON "vehicle_templates"("tenantId", "trimId");

CREATE UNIQUE INDEX "estimate_vehicles_tenantId_estimateId_key" ON "estimate_vehicles"("tenantId", "estimateId");
CREATE UNIQUE INDEX "estimate_vehicles_estimateId_key" ON "estimate_vehicles"("estimateId");
CREATE INDEX "estimate_vehicles_tenantId_estimateId_idx" ON "estimate_vehicles"("tenantId", "estimateId");
CREATE INDEX "estimate_vehicles_tenantId_year_make_model_idx" ON "estimate_vehicles"("tenantId", "year", "make", "model");

ALTER TABLE "vehicle_makes" ADD CONSTRAINT "vehicle_makes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vehicle_models" ADD CONSTRAINT "vehicle_models_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vehicle_models" ADD CONSTRAINT "vehicle_models_makeId_fkey" FOREIGN KEY ("makeId") REFERENCES "vehicle_makes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vehicle_trims" ADD CONSTRAINT "vehicle_trims_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vehicle_trims" ADD CONSTRAINT "vehicle_trims_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "vehicle_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vehicle_dimension_profiles" ADD CONSTRAINT "vehicle_dimension_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vehicle_dimension_profiles" ADD CONSTRAINT "vehicle_dimension_profiles_trimId_fkey" FOREIGN KEY ("trimId") REFERENCES "vehicle_trims"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vehicle_photos" ADD CONSTRAINT "vehicle_photos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vehicle_photos" ADD CONSTRAINT "vehicle_photos_trimId_fkey" FOREIGN KEY ("trimId") REFERENCES "vehicle_trims"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vehicle_photos" ADD CONSTRAINT "vehicle_photos_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "vehicle_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vehicle_photos" ADD CONSTRAINT "vehicle_photos_makeId_fkey" FOREIGN KEY ("makeId") REFERENCES "vehicle_makes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vehicle_templates" ADD CONSTRAINT "vehicle_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vehicle_templates" ADD CONSTRAINT "vehicle_templates_trimId_fkey" FOREIGN KEY ("trimId") REFERENCES "vehicle_trims"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "estimate_vehicles" ADD CONSTRAINT "estimate_vehicles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "estimate_vehicles" ADD CONSTRAINT "estimate_vehicles_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "estimates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "estimate_vehicles" ADD CONSTRAINT "estimate_vehicles_trimId_fkey" FOREIGN KEY ("trimId") REFERENCES "vehicle_trims"("id") ON DELETE SET NULL ON UPDATE CASCADE;
