// Roll substrate helpers (width in inches × roll length in feet → sq ft coverage).

/**
 * Roll coverage in sq ft: widthIn × lengthFt ÷ 12.
 * Example: 54" × 150' → 675 sq ft.
 */
export function computeRollSqft(widthInches: number, lengthFeet: number): number {
  if (!Number.isFinite(widthInches) || !Number.isFinite(lengthFeet)) return 0;
  if (widthInches <= 0 || lengthFeet <= 0) return 0;
  const raw = (widthInches * lengthFeet) / 12;
  return Math.round(raw * 10000) / 10000;
}

/** Portion of one roll consumed by `usedSqft` (0–1). */
export function rollUsedFraction(usedSqft: number, rollSqft: number): number {
  if (rollSqft <= 0) return 0;
  const u = Math.max(0, Number.isFinite(usedSqft) ? usedSqft : 0);
  return Math.min(1, u / rollSqft);
}

/**
 * Minimum billable sq ft when shops charge at least a fraction of a roll.
 * `minimumBillFraction` in 0–1 (e.g. 0.25 → bill max(used, 25% of roll)).
 */
export function billableSqftRollMinimum(args: {
  usedSqft: number;
  rollSqft: number;
  minimumBillFraction: number;
}): number {
  const roll = Math.max(0, Number.isFinite(args.rollSqft) ? args.rollSqft : 0);
  const used = Math.max(0, Number.isFinite(args.usedSqft) ? args.usedSqft : 0);
  const f = Math.min(1, Math.max(0, Number.isFinite(args.minimumBillFraction) ? args.minimumBillFraction : 0));
  const floor = roll * f;
  return Math.max(used, floor);
}
