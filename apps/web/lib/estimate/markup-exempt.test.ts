// R-EST-05: markup-exempt lines (Sheet sq-ft rates, vehicle wraps) carry
// already-marked-up prices and must NEVER be multiplied by the estimate
// multiplier. Verified against the owner's handoff rule in
// source/lib/pricing.ts ("Never apply the general 200% markup a second
// time to a square-foot line").

import { describe, expect, it } from 'vitest';
import { computeEstimate } from '@bvisible/pricing';

describe('computeEstimate markup exemption (R-EST-05)', () => {
  it('applies the multiplier only to non-exempt lines', () => {
    const out = computeEstimate({
      multiplierMilli: 3000, // 200% markup = ×3.00
      designFlatCents: 0,
      lines: [
        // Custom cost-up line: $1,259.70 cost → ×3.
        { id: 'custom', kind: 'MATERIAL', qtyMilli: 1000, unitCostCents: 125970 },
        // Vehicle wrap at Sheet price $3,055 — already includes markup.
        {
          id: 'wrap',
          kind: 'MATERIAL',
          qtyMilli: 1000,
          unitCostCents: 305500,
          markupExempt: true,
        },
      ],
    });

    expect(out.subtotalCostCents).toBe(125970 + 305500);
    expect(out.markupExemptCents).toBe(305500);
    // 125970 × 3 + 305500 = 377910 + 305500 = 683410 → $6,834.10
    expect(out.finalPriceCents).toBe(683410);
  });

  it('never doubles a square-foot line even at high multipliers', () => {
    const sqftSellCents = 64000; // 32 sq ft × $20/sq ft, final price
    const out = computeEstimate({
      multiplierMilli: 5000,
      designFlatCents: 0,
      lines: [
        {
          id: 'sqft',
          kind: 'MATERIAL',
          qtyMilli: 32000,
          unitCostCents: 2000,
          markupExempt: true,
        },
      ],
    });
    expect(out.finalPriceCents).toBe(sqftSellCents);
    expect(out.markupExemptCents).toBe(sqftSellCents);
  });

  it('keeps legacy behavior when no line is exempt', () => {
    const out = computeEstimate({
      multiplierMilli: 3000,
      designFlatCents: 15000,
      lines: [{ id: 'a', kind: 'MATERIAL', qtyMilli: 1000, unitCostCents: 8700 }],
    });
    expect(out.markupExemptCents).toBe(0);
    expect(out.finalPriceCents).toBe((8700 + 15000) * 3);
  });

  it('design flat fee stays in the marked-up base', () => {
    const out = computeEstimate({
      multiplierMilli: 2000,
      designFlatCents: 10000,
      lines: [
        { id: 'x', kind: 'LABOR', qtyMilli: 2000, unitCostCents: 5000 },
        { id: 'y', kind: 'MISC', qtyMilli: 1000, unitCostCents: 300, markupExempt: true },
      ],
    });
    // (10000 labor + 10000 design flat) × 2 + 300 exempt
    expect(out.finalPriceCents).toBe(40000 + 300);
  });
});
