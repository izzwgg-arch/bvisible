-- Sales representative on estimates (nullable, SetNull on user delete).

-- AlterTable
ALTER TABLE "estimates" ADD COLUMN "salesRepId" TEXT;

-- CreateIndex
CREATE INDEX "estimates_tenantId_salesRepId_idx" ON "estimates"("tenantId", "salesRepId");

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_salesRepId_fkey" FOREIGN KEY ("salesRepId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
