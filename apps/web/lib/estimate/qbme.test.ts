import { describe, expect, it } from 'vitest';
import { buildQbmeExport } from './qbme';

describe('buildQbmeExport', () => {
  it('allocates buckets, keeps AMOUNT empty, and ends lines with a pipe', () => {
    const out = buildQbmeExport({
      title: 'Storefront sign',
      multiplierMilli: 3000,
      designFlatCents: 0,
      finalPriceCents: 629_10 + 305_500, // custom ×3 + wrap face value
      lines: [
        {
          kind: 'MATERIAL',
          description: 'Black Acrylic Sheet',
          computedCostCents: 8700,
          markupExempt: false,
          sourceKind: 'CUSTOM',
        },
        {
          kind: 'MACHINE',
          description: 'Colex CNC',
          computedCostCents: 2270,
          markupExempt: false,
          sourceKind: 'CUSTOM',
        },
        {
          kind: 'LABOR',
          description: 'Shop labor',
          computedCostCents: 10000,
          markupExempt: false,
          sourceKind: 'CUSTOM',
        },
        {
          kind: 'MATERIAL',
          description: 'Vehicle wrap — Chevrolet City Express (Full)',
          computedCostCents: 305500,
          markupExempt: true,
          sourceKind: 'VEHICLE_WRAP',
        },
      ],
    });

    // Sales = (87 + 22.70 + 100) × 3 = 629.10; Wrapping = 3055.00 (never ×3).
    const sales = out.lines.find((l) => l.item === 'Sales');
    const wrap = out.lines.find((l) => l.item === 'Wrapping');
    expect(sales?.rateCents).toBe(62910);
    expect(wrap?.rateCents).toBe(305500);
    expect(out.totalCents).toBe(62910 + 305500);

    expect(out.block.startsWith('QB_ESTIMATE_START\n')).toBe(true);
    expect(out.block.endsWith('\nQB_ESTIMATE_END')).toBe(true);
    for (const line of out.block.split('\n').slice(1, -1)) {
      expect(line.startsWith('Line=')).toBe(true);
      expect(line.endsWith('|')).toBe(true); // AMOUNT empty → trailing pipe
      const fields = line.slice('Line='.length).split('|');
      expect(fields).toHaveLength(5); // ITEM|DESC|QTY|RATE|<empty>
      expect(fields[4]).toBe('');
      expect(Number.isFinite(Number(fields[2]))).toBe(true);
      expect(Number.isFinite(Number(fields[3]))).toBe(true);
    }
  });

  it('routes design/install/shipping/3D lettering and absorbs rounding drift', () => {
    const out = buildQbmeExport({
      title: 'Channel letters — Main St',
      multiplierMilli: 3000,
      designFlatCents: 15000,
      finalPriceCents: 1, // force drift absorption
      lines: [
        { kind: 'DESIGN', description: 'Design work', computedCostCents: 5000, markupExempt: false, sourceKind: null },
        { kind: 'INSTALL', description: 'Install crew', computedCostCents: 20000, markupExempt: false, sourceKind: null },
        { kind: 'MISC', description: 'Shipping to site', computedCostCents: 3000, markupExempt: false, sourceKind: null },
        { kind: 'MATERIAL', description: 'Channel letter faces', computedCostCents: 40000, markupExempt: false, sourceKind: 'CUSTOM' },
      ],
    });
    const items = out.lines.map((l) => l.item);
    expect(items).toContain('Design');
    expect(items).toContain('Installation');
    expect(items).toContain('Shipping');
    expect(items).toContain('3D Lettering');
    expect(out.totalCents).toBe(1); // drift landed in the largest bucket
    for (const l of out.lines) expect(l.description).not.toContain('|');
  });

  it('only ever emits allowed item names', () => {
    const out = buildQbmeExport({
      title: 'Job',
      multiplierMilli: 2000,
      designFlatCents: 0,
      finalPriceCents: 2000,
      lines: [
        { kind: 'MISC', description: 'Misc parts', computedCostCents: 1000, markupExempt: false, sourceKind: null },
      ],
    });
    const allowed = new Set(['Wrapping', 'Sales', '3D Lettering', 'Design', 'Shipping', 'Installation']);
    for (const l of out.lines) expect(allowed.has(l.item)).toBe(true);
  });
});
