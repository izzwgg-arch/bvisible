-- New assistant_settings rows (tenants that haven't saved a model yet) now
-- default to GPT-5.6 Sol, OpenAI's flagship/most capable model as of July
-- 2026 (previously gpt-5-mini). Existing rows are left untouched — tenants
-- with an explicit model already saved keep using it.
ALTER TABLE "assistant_settings" ALTER COLUMN "model" SET DEFAULT 'gpt-5.6-sol';
