// Quantity helpers. Internally qty is stored as integer "milli" units
// (qty * 1000). 1 = 1000, 1.5 = 1500, 0.25 = 250. This keeps line-cost
// math (qty * unit_cost / 1000) integer end-to-end.

export function qtyToMilli(qty: number): number {
  return Math.round(qty * 1000);
}

export function qtyFromMilli(milli: number): number {
  return milli / 1000;
}

// Display formatter. Strips trailing zeros so "1.000" → "1", "1.500"
// → "1.5", "1.530" → "1.53". Cap at 3 decimals (the precision the
// milli storage actually carries).
export function formatQty(milli: number): string {
  const negative = milli < 0;
  const absMilli = Math.abs(milli);
  const whole = Math.trunc(absMilli / 1000);
  const frac = absMilli % 1000;
  if (frac === 0) {
    return `${negative ? '-' : ''}${whole}`;
  }
  const fracStr = frac.toString().padStart(3, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}.${fracStr}`;
}

// Parses "1", "1.5", "0.25" → milli (integer). Returns null on garbage.
// "" → 0 (empty cell defaults to zero quantity, not an error).
export function parseQty(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return 0;
  const cleaned = trimmed.replace(/[\s,]/g, '');
  if (!/^-?\d+(\.\d{1,3})?$/.test(cleaned)) return null;
  const asNumber = Number(cleaned);
  if (!Number.isFinite(asNumber)) return null;
  return qtyToMilli(asNumber);
}
