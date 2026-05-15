import { describe, expect, it } from 'vitest';

import { allocateEstimateSellToInvoiceLines } from '@/lib/invoices/allocate-estimate-sell-to-invoice-lines';

describe('allocateEstimateSellToInvoiceLines', () => {
  it('returns empty array when there are no lines', () => {
    expect(allocateEstimateSellToInvoiceLines({ finalPriceCents: 10_000, lines: [] })).toEqual([]);
  });

  it('sums allocated cents to finalPriceCents for proportional weights', () => {
    const totals = allocateEstimateSellToInvoiceLines({
      finalPriceCents: 10_000,
      lines: [{ computedCostCents: 100 }, { computedCostCents: 300 }],
    });
    expect(totals.reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(totals).toHaveLength(2);
  });

  it('splits evenly when every line weight is zero', () => {
    const totals = allocateEstimateSellToInvoiceLines({
      finalPriceCents: 100,
      lines: [{ computedCostCents: 0 }, { computedCostCents: 0 }],
    });
    expect(totals.reduce((a, b) => a + b, 0)).toBe(100);
    expect(totals).toEqual([50, 50]);
  });
});
