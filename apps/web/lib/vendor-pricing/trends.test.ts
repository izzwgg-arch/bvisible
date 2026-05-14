import { describe, expect, it } from 'vitest';
import {
  classifyPriceTrend,
  coefficientOfVariationRatio,
  DEFAULT_HIGH_VOLATILITY_CV_BPS,
  DEFAULT_SPIKE_VS_AVG_BPS,
  latestAboveBaselineByBps,
  meanCents,
} from './trends';

describe('meanCents', () => {
  it('rounds to nearest cent', () => {
    expect(meanCents([100, 101, 102])).toBe(101);
  });
});

describe('coefficientOfVariationRatio', () => {
  it('returns null for fewer than two samples', () => {
    expect(coefficientOfVariationRatio([100])).toBeNull();
  });

  it('detects high spread deterministically', () => {
    const cv = coefficientOfVariationRatio([80, 100, 120]);
    expect(cv).not.toBeNull();
    expect(cv! * 10000).toBeGreaterThanOrEqual(DEFAULT_HIGH_VOLATILITY_CV_BPS);
  });
});

describe('latestAboveBaselineByBps', () => {
  it('flags strictly more than +10% vs baseline at threshold edge', () => {
    expect(latestAboveBaselineByBps(1101, 1000, DEFAULT_SPIKE_VS_AVG_BPS)).toBe(
      true,
    );
    expect(latestAboveBaselineByBps(1100, 1000, DEFAULT_SPIKE_VS_AVG_BPS)).toBe(
      false,
    );
  });
});

describe('classifyPriceTrend', () => {
  it('labels spike vs 90d average', () => {
    const r = classifyPriceTrend({
      latestCents: 120,
      previousCents: 118,
      avg90Cents: 100,
      windowPrices90dCents: [100, 105, 98, 110],
    });
    expect(r.priceRecentlyIncreasedVsAvg).toBe(true);
    expect(r.trendKind).toBe('up_vs_avg');
  });

  it('labels stable when latest near average', () => {
    const r = classifyPriceTrend({
      latestCents: 101,
      previousCents: 100,
      avg90Cents: 100,
      windowPrices90dCents: [99, 100, 101],
    });
    expect(r.priceRecentlyIncreasedVsAvg).toBe(false);
    expect(r.trendKind).toBe('stable');
  });

  it('marks volatility when CV breaches threshold', () => {
    const prices = [100, 100, 100, 400];
    const r = classifyPriceTrend({
      latestCents: 400,
      previousCents: 100,
      avg90Cents: meanCents(prices),
      windowPrices90dCents: prices,
    });
    expect(r.highVolatility).toBe(true);
  });
});
