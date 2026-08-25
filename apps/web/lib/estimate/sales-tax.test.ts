import { describe, expect, it } from 'vitest';
import { computeSalesTax, formatTaxPercent } from './sales-tax';

// Exemption is applied by passing a 0 rate to computeSalesTax — the rule the
// customer PDF (estimate-pdf.ts) and the Bid Estimator Step 7 totals
// (bid/workflow.ts) both use. These cases pin that behaviour down.
describe('computeSalesTax', () => {
  it('charges the company rate on a normal estimate', () => {
    // The LIDO Condominiums case: $15,800 at the default 8.125%.
    const result = computeSalesTax(1_580_000, 8125);
    expect(result.taxCents).toBe(128_375);
    expect(result.totalCents).toBe(1_708_375);
    expect(result.label).toBe('8.125%');
    expect(result.applied).toBe(true);
  });

  it('charges nothing when the estimate is exempt', () => {
    const subtotal = 1_580_000;
    const exempt = computeSalesTax(subtotal, 0);
    expect(exempt.taxCents).toBe(0);
    // The exempt total is the subtotal — no silent rounding creeping in.
    expect(exempt.totalCents).toBe(subtotal);
    expect(exempt.applied).toBe(false);
    expect(exempt.label).toBe('');
  });

  it('exempting one estimate does not change the rate for another', () => {
    const subtotal = 1_580_000;
    const rate = 8125;
    computeSalesTax(subtotal, 0);
    expect(computeSalesTax(subtotal, rate).taxCents).toBe(128_375);
  });

  it('treats a negative or fractional rate as no tax rather than a credit', () => {
    expect(computeSalesTax(1_580_000, -500).taxCents).toBe(0);
    expect(computeSalesTax(-1_000, 8125).taxCents).toBe(0);
  });

  it('rounds tax to the nearest cent', () => {
    // $10.01 × 8.125% = $0.813... → 81 cents.
    expect(computeSalesTax(1001, 8125).taxCents).toBe(81);
  });
});

describe('formatTaxPercent', () => {
  it('drops trailing zeros so whole rates read cleanly', () => {
    expect(formatTaxPercent(8125)).toBe('8.125%');
    expect(formatTaxPercent(7000)).toBe('7%');
    expect(formatTaxPercent(8250)).toBe('8.25%');
  });
});
