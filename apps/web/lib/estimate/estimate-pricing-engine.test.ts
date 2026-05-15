import { describe, expect, it } from 'vitest';
import { computeEstimate, computeLineCostCents } from '@bvisible/pricing';

import { allocateEstimateSellToInvoiceLines } from '@/lib/invoices/allocate-estimate-sell-to-invoice-lines';

/** Default sell multiplier R-EST-01 (3.000×). */
const DEFAULT_MULT = 3000;

function line(
  id: string,
  kind: 'MATERIAL' | 'LABOR' | 'MACHINE' | 'DESIGN' | 'INSTALL' | 'MISC',
  qtyMilli: number,
  unitCostCents: number
) {
  return { id, kind, qtyMilli, unitCostCents };
}

describe('@bvisible/pricing computeLineCostCents', () => {
  it('computes qty × unit cost with milli scaling (material)', () => {
    expect(computeLineCostCents({ qtyMilli: 1000, unitCostCents: 12345 })).toBe(12345);
    expect(computeLineCostCents({ qtyMilli: 2500, unitCostCents: 100 })).toBe(250);
  });
});

describe('@bvisible/pricing computeEstimate', () => {
  it('material-only: buckets + default 3× sell', () => {
    const out = computeEstimate({
      multiplierMilli: DEFAULT_MULT,
      designFlatCents: 0,
      lines: [line('a', 'MATERIAL', 2000, 500)],
    });
    expect(out.breakdown.materialsCents).toBe(1000);
    expect(out.subtotalCostCents).toBe(1000);
    expect(out.finalPriceCents).toBe(3000);
  });

  it('labor-only estimate', () => {
    const out = computeEstimate({
      multiplierMilli: DEFAULT_MULT,
      designFlatCents: 0,
      lines: [line('l', 'LABOR', 3000, 5000)],
    });
    expect(out.breakdown.laborCents).toBe(15000);
    expect(out.finalPriceCents).toBe(45000);
  });

  it('machine-only estimate', () => {
    const out = computeEstimate({
      multiplierMilli: DEFAULT_MULT,
      designFlatCents: 0,
      lines: [line('m', 'MACHINE', 6000, 10000)],
    });
    expect(out.breakdown.machinesCents).toBe(60000);
    expect(out.finalPriceCents).toBe(180000);
  });

  it('INSTALL uses qtyMilli × unitCostCents only (installers not modeled per-line)', () => {
    /** Business doc uses hours × installers × rate; engine stores one composite hourly unit cost in unitCostCents. */
    const out = computeEstimate({
      multiplierMilli: DEFAULT_MULT,
      designFlatCents: 0,
      lines: [line('i', 'INSTALL', 8000, 15000)],
    });
    expect(out.breakdown.installCents).toBe(120000);
    expect(out.finalPriceCents).toBe(360000);
  });

  it('mixed kinds land in correct buckets', () => {
    const out = computeEstimate({
      multiplierMilli: DEFAULT_MULT,
      designFlatCents: 0,
      lines: [
        line('x', 'MATERIAL', 1000, 1000),
        line('y', 'LABOR', 1000, 2000),
        line('z', 'INSTALL', 1000, 3000),
      ],
    });
    expect(out.breakdown.materialsCents).toBe(1000);
    expect(out.breakdown.laborCents).toBe(2000);
    expect(out.breakdown.installCents).toBe(3000);
    expect(out.subtotalCostCents).toBe(6000);
    expect(out.finalPriceCents).toBe(18000);
  });

  it('cached totals are deterministic across repeated computeEstimate calls', () => {
    const input = {
      multiplierMilli: DEFAULT_MULT,
      designFlatCents: 12456,
      lines: [
        line('a', 'MATERIAL', 3333, 701),
        line('b', 'MACHINE', 2500, 9876),
      ],
    };
    expect(computeEstimate(input)).toEqual(computeEstimate(input));
  });

  it('install line + misc line', () => {
    const out = computeEstimate({
      multiplierMilli: DEFAULT_MULT,
      designFlatCents: 0,
      lines: [
        line('i', 'INSTALL', 4000, 12500),
        line('u', 'MISC', 1000, 99),
      ],
    });
    expect(out.breakdown.installCents).toBe(50000);
    expect(out.breakdown.miscCents).toBe(99);
    expect(out.subtotalCostCents).toBe(50099);
  });

  it('design row plus flat fee stacks in design bucket', () => {
    const out = computeEstimate({
      multiplierMilli: DEFAULT_MULT,
      designFlatCents: 15000,
      lines: [line('d', 'DESIGN', 1000, 5000)],
    });
    expect(out.breakdown.designCents).toBe(15000 + 5000);
    expect(out.subtotalCostCents).toBe(20000);
    expect(out.finalPriceCents).toBe(60000);
  });

  it('misc-only manual-style line uses qty × unit cost and misc bucket', () => {
    const out = computeEstimate({
      multiplierMilli: DEFAULT_MULT,
      designFlatCents: 0,
      lines: [line('u', 'MISC', 1000, 12_345)],
    });
    expect(out.breakdown.miscCents).toBe(12345);
    expect(out.finalPriceCents).toBe(37035);
  });

  it('explicit multiplier override changes sell only', () => {
    const out = computeEstimate({
      multiplierMilli: 3500,
      designFlatCents: 0,
      lines: [line('a', 'MATERIAL', 1000, 10000)],
    });
    expect(out.subtotalCostCents).toBe(10000);
    expect(out.finalPriceCents).toBe(35000);
  });

  it('invoice allocation sums to finalPriceCents when line weights match cached costs', () => {
    const lines = [
      line('a', 'MATERIAL', 1000, 3000),
      line('b', 'LABOR', 2000, 2500),
    ];
    const est = computeEstimate({
      multiplierMilli: DEFAULT_MULT,
      designFlatCents: 0,
      lines,
    });
    const weights = lines.map((l) => ({
      computedCostCents: est.lineCosts[l.id] ?? 0,
    }));
    expect(weights.reduce((s, x) => s + x.computedCostCents, 0)).toBe(est.subtotalCostCents);

    const alloc = allocateEstimateSellToInvoiceLines({
      finalPriceCents: est.finalPriceCents,
      lines: weights,
    });
    expect(alloc.reduce((a, b) => a + b, 0)).toBe(est.finalPriceCents);
  });
});
