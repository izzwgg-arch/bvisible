import { describe, expect, it } from 'vitest';
import {
  bannerPrice,
  computeRollNominalSqft,
  computeSqft,
  computeTotalSqftFromPieces,
  rollEffectiveBillableSqft,
  rollMaterialLineCostCents,
  rollUsedFraction,
  sheetsNeededForCoverage,
  STANDARD_SHEET_SQ_FT,
} from '@bvisible/pricing';

describe('computeSqft + computeTotalSqftFromPieces', () => {
  it('48×96 in = 32 sq ft each', () => {
    expect(computeSqft(48, 96)).toBe(32);
  });

  it('total = each × integer piece count', () => {
    expect(computeTotalSqftFromPieces(32, 3)).toBe(96);
  });

  it('rounds total to 4 decimals', () => {
    const each = computeSqft(10, 10);
    expect(computeTotalSqftFromPieces(each, 7)).toBeCloseTo(each * 7, 4);
  });
});

describe('sheetsNeededForCoverage', () => {
  const s32 = STANDARD_SHEET_SQ_FT.SHEET_4X8;

  it('under 75% of one sheet still bills 1 sheet', () => {
    expect(sheetsNeededForCoverage(23, s32)).toBe(1);
  });

  it('at 75% threshold uses ceil branch (24/32 = 0.75 → not < threshold)', () => {
    expect(sheetsNeededForCoverage(24, s32)).toBe(1);
  });

  it('ceil when above threshold usage', () => {
    expect(sheetsNeededForCoverage(40, s32)).toBe(2);
  });

  it('5×10 nominal sheet', () => {
    expect(sheetsNeededForCoverage(60, STANDARD_SHEET_SQ_FT.SHEET_5X10)).toBe(2);
  });
});

describe('roll material helpers', () => {
  it('54 in × 150 ft = 675 sq ft nominal', () => {
    expect(computeRollNominalSqft(54, 150)).toBe(675);
  });

  it('used fraction', () => {
    expect(rollUsedFraction(337.5, 675)).toBe(0.5);
  });

  it('minimum billable bumps used sq ft', () => {
    expect(rollEffectiveBillableSqft(100, 150)).toBe(150);
  });

  it('line cost = billable sq ft × cents per sq ft', () => {
    expect(rollMaterialLineCostCents(250, 10)).toBe(2500);
  });
});

describe('bannerPrice (R-EST-03)', () => {
  it('applies $45 minimum when material+grommets is low', () => {
    const b = bannerPrice({ sqft: 5, grommets: 0 });
    expect(b.cents).toBe(4500);
    expect(b.appliedMinimum).toBe(true);
  });

  it('uses $3/sq ft above 200 sq ft', () => {
    const b = bannerPrice({ sqft: 250, grommets: 0 });
    const base = 200 * 400;
    const over = 50 * 300;
    expect(b.baseCents + b.overCents).toBe(base + over);
    expect(b.cents).toBe(base + over);
    expect(b.appliedMinimum).toBe(false);
  });

  it('adds grommets at $0.50 each', () => {
    const b = bannerPrice({ sqft: 100, grommets: 4 });
    expect(b.grommetCents).toBe(200);
  });
});
