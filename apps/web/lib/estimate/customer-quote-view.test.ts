import { describe, expect, it } from 'vitest';
import { EstimateLineKind } from '@bvisible/db';
import { buildCustomerQuoteLines } from '@/lib/estimate/customer-quote-view';

describe('buildCustomerQuoteLines', () => {
  it('never exposes unit cost fields on customer rows', () => {
    const rows = buildCustomerQuoteLines(
      [
        {
          id: '1',
          description: 'Thing',
          qtyMilli: 1000,
          kind: EstimateLineKind.MATERIAL,
          computedCostCents: 100,
        },
      ],
      100,
      300
    );
    expect(rows).toHaveLength(1);
    const json = JSON.stringify(rows[0]);
    expect(json).not.toMatch(/unitCost/i);
    expect(json).not.toMatch(/computedCost/i);
    expect(json).not.toMatch(/subtotal/i);
    expect(json).not.toMatch(/vendor/i);
    expect(json).not.toMatch(/preferredVendor/i);
    expect(json).not.toMatch(/internalCost/i);
    expect(rows[0]!.lineSellCents).toBe(300);
  });

  it('sums line sells to final total', () => {
    const rows = buildCustomerQuoteLines(
      [
        {
          id: 'a',
          description: 'A',
          qtyMilli: 1000,
          kind: EstimateLineKind.LABOR,
          computedCostCents: 60,
        },
        {
          id: 'b',
          description: 'B',
          qtyMilli: 1000,
          kind: EstimateLineKind.MATERIAL,
          computedCostCents: 40,
        },
      ],
      100,
      300
    );
    const sum = rows.reduce((s, r) => s + r.lineSellCents, 0);
    expect(sum).toBe(300);
  });
});
