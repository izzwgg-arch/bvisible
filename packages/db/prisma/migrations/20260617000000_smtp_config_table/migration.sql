-- AddTable smtp_config
-- Global outbound SMTP credentials (SUPER_ADMIN-managed via UI).
-- Password encrypted at rest with AES-256-GCM; falls back to env vars
-- when no row is present.

CREATE TABLE "smtp_config" (
    "id" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "secure" BOOLEAN NOT NULL DEFAULT false,
    "user" TEXT NOT NULL,
    "passwordCipher" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "replyTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "smtp_config_pkey" PRIMARY KEY ("id")
);
