-- Persistent per-tenant lessons for the business assistant (learning).
CREATE TABLE "assistant_memories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "content" VARCHAR(600) NOT NULL,
    "category" VARCHAR(60),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_memories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "assistant_memories_tenantId_createdAt_idx" ON "assistant_memories"("tenantId", "createdAt");

ALTER TABLE "assistant_memories" ADD CONSTRAINT "assistant_memories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
