// Sheet-good yardage rules for estimating standard substrate sizes.

/** Nominal sheet areas used by sign shops (square feet). */
export const STANDARD_SHEET_SQ_FT = {
  SHEET_4X8: 32,
  SHEET_5X10: 50,
} as const;

/**
 * Sheets needed for a job consuming `totalSqft` on a fixed nominal sheet size:
 * - If usage is below 75% of one sheet → bill exactly **one** sheet.
 * - Otherwise → ceil(totalSqft / sheetSqft).
 */
export function sheetsNeededForCoverage(totalSqft: number, sheetSqft: number): number {
  const t = Math.max(0, Number.isFinite(totalSqft) ? totalSqft : 0);
  const s = Math.max(0, Number.isFinite(sheetSqft) ? sheetSqft : 0);
  if (s <= 0 || t <= 0) return 0;
  const threshold = 0.75 * s;
  if (t < threshold) return 1;
  return Math.ceil(t / s);
}
