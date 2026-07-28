-- Yiddish Labs API key (encrypted) for assistant voice transcription +
-- translation. One key covers both Yiddish Labs APIs.
ALTER TABLE "assistant_settings" ADD COLUMN "ylApiKeyCipher" VARCHAR(2000);
