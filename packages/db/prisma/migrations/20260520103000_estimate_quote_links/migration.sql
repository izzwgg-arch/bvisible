-- Public estimate quote share tokens (hash-only storage).

CREATE TABLE "estimate_quote_links" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estimate_quote_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "estimate_quote_links_tokenHash_key" ON "estimate_quote_links"("tokenHash");

CREATE INDEX "estimate_quote_links_tenantId_estimateId_idx" ON "estimate_quote_links"("tenantId", "estimateId");

ALTER TABLE "estimate_quote_links" ADD CONSTRAINT "estimate_quote_links_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "estimate_quote_links" ADD CONSTRAINT "estimate_quote_links_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "estimates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "estimate_quote_links" ADD CONSTRAINT "estimate_quote_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
