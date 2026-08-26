-- Per-line sales tax opt-out.
--
-- The estimate grid has always shown a "Tax" checkbox on every line, but it
-- only wrote a taxEnabled flag into internalNotes JSON that no server code
-- read — unchecking it moved no total and the cell claimed a hardcoded
-- 8.25% that was never the company rate. This column makes the control real.
--
-- Default true: every existing line stays taxable, so no estimate total moves
-- on deploy. Estimate."taxExempt" still outranks it — an exempt estimate is
-- taxed at 0% regardless of what its lines say.
ALTER TABLE "estimate_line_items" ADD COLUMN "taxable" BOOLEAN NOT NULL DEFAULT true;

-- Carry over the decorative flag for the lines someone did untick. Matched on
-- the raw text rather than a ::jsonb cast: internalNotes also holds plain
-- free-text notes on older lines, and casting those would abort the migration.
UPDATE "estimate_line_items"
SET "taxable" = false
WHERE "internalNotes" ~ '"taxEnabled"[[:space:]]*:[[:space:]]*false';
