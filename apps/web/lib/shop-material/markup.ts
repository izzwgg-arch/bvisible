/**
 * Markup is stored as percent × 1000 (30000 → 30.000%).
 * Sell guidance = cost × (1 + markupPercentMilli / 100000).
 */

export function sellPriceFromCostAndMarkup(costCents: number, markupPercentMilli: number): number {
  if (costCents <= 0) return 0;
  const x = Math.round((costCents * (100000 + markupPercentMilli)) / 100000);
  return Math.max(0, x);
}

export function impliedMarkupPercentMilli(costCents: number, sellCents: number): number | null {
  if (costCents <= 0) return null;
  const raw = Math.round(((sellCents - costCents) / costCents) * 100000);
  return Math.max(0, raw);
}

/** Parse UI percent like "30" or "12.5" → milli (30000, 12500). */
export function parseMarkupPercentToMilli(raw: string): number | null {
  const s = raw.trim();
  if (s === '') return 0;
  const n = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 999999) return null;
  return Math.round(n * 1000);
}
