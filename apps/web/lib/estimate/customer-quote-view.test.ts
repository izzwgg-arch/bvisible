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

  it('shows one bundle line while hidden internal component lines stay private', () => {
    const rows = buildCustomerQuoteLines(
      [
        {
          id: 'bundle-line',
          description: 'Internal bundle name',
          customerDescription: 'Customer bundle package',
          qtyMilli: 1000,
          kind: EstimateLineKind.MATERIAL,
          computedCostCents: 500,
        },
        {
          id: 'internal-component',
          description: 'Do not show component',
          hiddenFromCustomer: true,
          qtyMilli: 1000,
          kind: EstimateLineKind.MATERIAL,
          computedCostCents: 100,
        },
      ],
      600,
      1800,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.description).toBe('Customer bundle package');
    expect(JSON.stringify(rows)).not.toContain('Do not show component');
  });
});
