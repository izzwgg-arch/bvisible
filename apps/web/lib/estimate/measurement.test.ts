import { describe, expect, it } from 'vitest';
import { computeMeasurement, guessMaterialSize } from './measurement';

describe('guessMaterialSize', () => {
  it('parses classic bare sheet sizes in feet', () => {
    expect(guessMaterialSize('ACM Dibond 4x8 White')).toMatchObject({
      fullSqft: 32,
      fullLengthFt: null,
    });
    expect(guessMaterialSize('Coroplast 5x10 4mm')).toMatchObject({ fullSqft: 50 });
  });

  it('parses explicit inch × feet rolls', () => {
    const g = guessMaterialSize(`Vinyl gloss 54" x 150' roll`);
    expect(g.fullSqft).toBe(675);
    expect(g.fullLengthFt).toBe(150);
  });

  it('parses inch × inch sheets', () => {
    const g = guessMaterialSize('Acrylic 48in x 96in 1/4');
    expect(g.fullSqft).toBe(32);
    expect(g.fullLengthFt).toBeNull();
  });

  it('parses yards to feet', () => {
    const g = guessMaterialSize(`Laminate 60" x 50yd`);
    expect(g.fullLengthFt).toBe(150);
    expect(g.fullSqft).toBe(750);
  });

  it('treats bare width×long-length as a roll (inches × feet)', () => {
    const g = guessMaterialSize('Vinyl 54x150');
    expect(g.fullSqft).toBe(675);
    expect(g.fullLengthFt).toBe(150);
  });

  it('returns nulls when nothing parseable', () => {
    expect(guessMaterialSize('Blue painters tape')).toEqual({
      fullSqft: null,
      fullLengthFt: null,
      sizeLabel: null,
    });
  });
});

describe('computeMeasurement', () => {
  const price = 50000; // $500 full roll/sheet

  it('quantity mode is 1:1 with full units', () => {
    const r = computeMeasurement({ mode: 'QTY', value: 2, fullUnitPriceCents: price });
    expect(r.ok).toBe(true);
    expect(r.qtyMilli).toBe(2000);
    expect(r.unitCostCents).toBe(price);
    expect(r.costCents).toBe(100000);
  });

  it('percent mode uses the fraction of one full unit', () => {
    const r = computeMeasurement({ mode: 'PERCENT', value: 25, fullUnitPriceCents: price });
    expect(r.ok).toBe(true);
    expect(r.qtyMilli).toBe(250);
    expect(r.unitCostCents).toBe(price);
    expect(r.costCents).toBe(12500);
    expect(r.usedFraction).toBeCloseTo(0.25);
  });

  it('sq ft mode derives portion + per-sq-ft cost automatically', () => {
    // 2 sq ft of a 675 sq ft roll priced $500 → ~$1.48
    const r = computeMeasurement({
      mode: 'SQFT',
      value: 2,
      fullUnitPriceCents: price,
      fullSqft: 675,
    });
    expect(r.ok).toBe(true);
    expect(r.unitLabel).toBe('sq ft');
    expect(r.unitCostCents).toBe(74); // 50000/675 ≈ 74.07
    expect(r.costCents).toBe(148);
    expect(r.usedFraction).toBeCloseTo(2 / 675);
    expect(r.detail).toContain('% of one full sheet/roll');
  });

  it('linear ft mode divides by the roll length', () => {
    // 10 lin ft of a 150 ft roll priced $500 → $33.33
    const r = computeMeasurement({
      mode: 'LINFT',
      value: 10,
      fullUnitPriceCents: price,
      fullLengthFt: 150,
    });
    expect(r.ok).toBe(true);
    expect(r.unitLabel).toBe('lin ft');
    expect(r.unitCostCents).toBe(333);
    expect(r.costCents).toBe(3330);
  });

  it('sq ft mode requires a known full size', () => {
    const r = computeMeasurement({
      mode: 'SQFT',
      value: 2,
      fullUnitPriceCents: price,
      fullSqft: null,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('full sheet/roll size');
  });

  it('falls back to fraction-of-unit when per-unit cost is sub-cent', () => {
    // $1 roll of 675 sq ft → per-sq-ft rounds to 0¢; fraction keeps a price.
    const r = computeMeasurement({
      mode: 'SQFT',
      value: 300,
      fullUnitPriceCents: 100,
      fullSqft: 675,
    });
    expect(r.ok).toBe(true);
    expect(r.unitLabel).toBe('unit');
    expect(r.unitCostCents).toBe(100);
    expect(r.qtyMilli).toBe(Math.round((300 / 675) * 1000));
    expect(r.costCents).toBeGreaterThan(0);
  });

  it('rejects zero / negative measurements', () => {
    expect(computeMeasurement({ mode: 'QTY', value: 0, fullUnitPriceCents: price }).ok).toBe(false);
    expect(computeMeasurement({ mode: 'SQFT', value: -2, fullUnitPriceCents: price, fullSqft: 32 }).ok).toBe(false);
  });
});
