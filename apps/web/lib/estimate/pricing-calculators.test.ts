import { describe, expect, it } from 'vitest';
import {
  bannerPrice,
  billableSqftRollMinimum,
  computePieceAndTotalSqftFromInches,
  computeRollSqft,
  computeSqft,
  computeTotalSqft,
  rollUsedFraction,
  sheetsNeededForCoverage,
  STANDARD_SHEET_SQ_FT,
} from '@bvisible/pricing';

describe('square footage', () => {
  it('computes sq ft from inches (48×96 → 32)', () => {
    expect(computeSqft(48, 96)).toBe(32);
  });

  it('totals identical pieces', () => {
    expect(computeTotalSqft(32, 2)).toBe(64);
  });

  it('returns piece and total from inches × qty', () => {
    const r = computePieceAndTotalSqftFromInches(24, 36, 4);
    expect(r.pieceSqft).toBe(6);
    expect(r.totalSqft).toBe(24);
  });
});

describe('sheet goods', () => {
  const sheet32 = STANDARD_SHEET_SQ_FT.SHEET_4X8;

  it('charges one sheet when usage is under 75% of a sheet', () => {
    expect(sheetsNeededForCoverage(10, sheet32)).toBe(1);
    expect(sheetsNeededForCoverage(23.9, sheet32)).toBe(1);
  });

  it('rounds up when at or above 75% threshold', () => {
    expect(sheetsNeededForCoverage(40, sheet32)).toBe(2);
    const threshold = 0.75 * sheet32;
    expect(sheetsNeededForCoverage(threshold, sheet32)).toBe(1);
  });
});

describe('roll material', () => {
  it('54 × 150 ft → 675 sq ft', () => {
    expect(computeRollSqft(54, 150)).toBe(675);
  });

  it('used fraction', () => {
    expect(rollUsedFraction(100, 675)).toBeCloseTo(100 / 675, 5);
    expect(rollUsedFraction(900, 675)).toBe(1);
  });

  it('minimum bill fraction lifts billable sq ft', () => {
    expect(
      billableSqftRollMinimum({
        usedSqft: 10,
        rollSqft: 100,
        minimumBillFraction: 0.25,
      }),
    ).toBe(25);
  });
});

describe('banner pricing (R-EST-03)', () => {
  it('applies $45 minimum to print area only, then adds grommets', () => {
    const tiny = bannerPrice({ sqft: 1, grommets: 0 });
    expect(tiny.appliedMinimum).toBe(true);
    expect(tiny.cents).toBe(4500);

    const tinyPlusGrom = bannerPrice({ sqft: 1, grommets: 10 });
    expect(tinyPlusGrom.cents).toBe(4500 + 500);
  });

  it('tiers rate above 200 sq ft', () => {
    const out = bannerPrice({ sqft: 250, grommets: 0 });
    const base = 200 * 400;
    const over = 50 * 300;
    expect(base + over).toBe(95000);
    expect(out.cents).toBe(95000);
    expect(out.appliedMinimum).toBe(false);
  });

  it('adds grommets after tiered material (minimum may lift small banners)', () => {
    const out = bannerPrice({ sqft: 10, grommets: 4 });
    expect(out.grommetCents).toBe(200);
    // 10 sf × $4 = $40 print → raised to $45 minimum → + $2 grommets
    expect(out.cents).toBe(4500 + 200);
    expect(out.appliedMinimum).toBe(true);
  });

  it('material above minimum tiers cleanly plus grommets', () => {
    const out = bannerPrice({ sqft: 100, grommets: 2 });
    expect(out.appliedMinimum).toBe(false);
    expect(out.cents).toBe(100 * 400 + 100);
  });
});
