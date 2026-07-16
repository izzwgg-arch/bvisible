-- AI assistant settings (encrypted OpenAI key per tenant).
CREATE TABLE "assistant_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "apiKeyCipher" VARCHAR(2000),
    "model" VARCHAR(80) NOT NULL DEFAULT 'gpt-5-mini',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "assistant_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "assistant_settings_tenantId_key" ON "assistant_settings"("tenantId");
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
