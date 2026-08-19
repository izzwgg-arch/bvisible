// Sales tax on customer estimates. The rate is a company setting
// (tenant_operating_rates.salesTaxPercentMilli = percent × 1000, edited on
// Pricing backend). Nothing here invents a rate: 0 means "no tax line —
// shown pre-tax".

export interface SalesTaxResult {
  /** Percent × 1000 (8125 = 8.125 %). */
  percentMilli: number;
  taxCents: number;
  totalCents: number;
  /** "8.125%" — for the totals row label. Empty when percentMilli = 0. */
  label: string;
  applied: boolean;
}

export function formatTaxPercent(percentMilli: number): string {
  const pct = percentMilli / 1000;
  return `${pct.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

export function computeSalesTax(taxableSubtotalCents: number, percentMilli: number): SalesTaxResult {
  const safe = Math.max(0, Math.trunc(percentMilli));
  const sub = Math.max(0, Math.trunc(taxableSubtotalCents));
  if (safe === 0) {
    return { percentMilli: 0, taxCents: 0, totalCents: sub, label: '', applied: false };
  }
  // percent × 1000 → fraction: milli / 100_000
  const taxCents = Math.round((sub * safe) / 100_000);
  return { percentMilli: safe, taxCents, totalCents: sub + taxCents, label: formatTaxPercent(safe), applied: true };
}
