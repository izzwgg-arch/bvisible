// Money helpers. Money is stored as integer cents everywhere; only
// display strings round-trip through dollars.

export function roundCents(n: number): number {
  // Use Math.round, not Math.trunc — banker's rounding bias would
  // accumulate in long line-item sums.
  return Math.round(n);
}

// "$1,234.56" — never localized; the editor is desktop-only and
// estimators expect a stable USD format.
export function formatMoney(cents: number): string {
  const negative = cents < 0;
  const absCents = Math.abs(Math.trunc(cents));
  const dollars = Math.trunc(absCents / 100);
  const remainder = absCents % 100;
  const dollarsStr = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const centsStr = remainder.toString().padStart(2, '0');
  return `${negative ? '-' : ''}$${dollarsStr}.${centsStr}`;
}

// Parses "12", "12.5", "$12.50", "1,234.56" → cents (integer).
// Returns null on garbage. Intentionally permissive: leading $ and
// commas are stripped because that's what users actually type.
export function parseMoney(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return 0;
  const cleaned = trimmed.replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d{1,4})?$/.test(cleaned)) return null;
  const asNumber = Number(cleaned);
  if (!Number.isFinite(asNumber)) return null;
  return roundCents(asNumber * 100);
}
