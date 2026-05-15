import { describe, expect, it } from 'vitest';
import { allocateLineSellCents } from '@/lib/estimate/customer-quote';

describe('allocateLineSellCents', () => {
  it('allocates proportional weights and preserves total', () => {
    const lines = [
      { id: 'a', computedCostCents: 100_00 },
      { id: 'b', computedCostCents: 50_00 },
    ];
    const sub = 150_00;
    const final = 450_00;
    const m = allocateLineSellCents(lines, sub, final);
    expect(m.get('a')! + m.get('b')!).toBe(final);
    expect(m.get('a')).toBeGreaterThan(m.get('b')!);
  });

  it('handles zero subtotal by splitting final evenly', () => {
    const lines = [{ id: 'x', computedCostCents: 0 }];
    const m = allocateLineSellCents(lines, 0, 99);
    expect(m.get('x')).toBe(99);
  });
});
