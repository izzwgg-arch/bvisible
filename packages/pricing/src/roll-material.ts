// Roll / wide-format nominal area: width (inches) × length (feet) → sq ft.
// Example: 54" × 150' → (54/12) × 150 = 675 sq ft.

import { roundCents } from './money';

/** Nominal roll area in square feet (4 decimal places like computeSqft). */
export function computeRollNominalSqft(widthInches: number, lengthFeet: number): number {
  const w = Math.max(0, Number.isFinite(widthInches) ? widthInches : 0);
  const lf = Math.max(0, Number.isFinite(lengthFeet) ? lengthFeet : 0);
  if (w <= 0 || lf <= 0) return 0;
  const widthFt = w / 12;
  const raw = widthFt * lf;
  return Math.round(raw * 10000) / 10000;
}

/** Portion of one roll used, clamped to [0, 1]. */
export function rollUsedFraction(usedSqft: number, rollNominalSqft: number): number {
  const u = Math.max(0, Number.isFinite(usedSqft) ? usedSqft : 0);
  const r = Math.max(0, Number.isFinite(rollNominalSqft) ? rollNominalSqft : 0);
  if (r <= 0) return 0;
  return Math.min(1, u / r);
}

/**
 * Effective billable sq ft for a roll job: at least `usedSqft`, bumped to
 * `minimumBillableSqft` when that minimum is set and higher (shop minimum charge hook).
 */
export function rollEffectiveBillableSqft(
  usedSqft: number,
  minimumBillableSqft: number | null | undefined,
): number {
  const u = Math.max(0, Number.isFinite(usedSqft) ? usedSqft : 0);
  const m =
    minimumBillableSqft === null || minimumBillableSqft === undefined
      ? 0
      : Math.max(0, Number.isFinite(minimumBillableSqft) ? minimumBillableSqft : 0);
  const raw = Math.max(u, m);
  return Math.round(raw * 10000) / 10000;
}

/** Line raw cost cents when selling by $/sqft on the roll usage (integer cents). */
export function rollMaterialLineCostCents(unitCostPerSqftCents: number, billableSqft: number): number {
  const c = Math.max(0, Math.trunc(Number.isFinite(unitCostPerSqftCents) ? unitCostPerSqftCents : 0));
  const sq = Math.max(0, Number.isFinite(billableSqft) ? billableSqft : 0);
  return roundCents((sq * c) / 1);
}
