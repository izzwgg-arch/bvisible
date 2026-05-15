/** Deterministic trend / volatility helpers (integer cents). No ML. */

import { observationInstant } from '@/lib/shop-material/pricing-aggregate';

export const DEFAULT_SPIKE_VS_AVG_BPS = 1000; // 10%
export const DEFAULT_SPIKE_VS_PREV_BPS = 1000; // 10% (operator “recent jump” threshold)
export const DEFAULT_HIGH_VOLATILITY_CV_BPS = 1500; // coefficient of variation >= 15%

export type TrendKind =
  | 'unknown'
  | 'stable'
  | 'up_vs_avg'
  | 'down_vs_avg'
  | 'up_vs_prev';

/** Mean cents; null if no samples */
export function meanCents(samples: readonly number[]): number | null {
  if (samples.length === 0) return null;
  let sum = 0;
  for (const p of samples) sum += p;
  return Math.round(sum / samples.length);
}

/** Sample standard deviation (n >= 2); null if insufficient data */
export function sampleStdDevCents(samples: readonly number[]): number | null {
  if (samples.length < 2) return null;
  const m = meanCents(samples);
  if (m === null) return null;
  let acc = 0;
  for (const p of samples) {
    const d = p - m;
    acc += d * d;
  }
  return Math.sqrt(acc / (samples.length - 1));
}

/** Coefficient of variation as ratio (e.g. 0.18); null if undefined */
export function coefficientOfVariationRatio(
  samples: readonly number[],
): number | null {
  const m = meanCents(samples);
  if (m === null || m === 0) return null;
  const sd = sampleStdDevCents(samples);
  if (sd === null) return null;
  return sd / m;
}

/** Compare cents spike vs baseline using basis points (10000 = 100%). */
export function latestAboveBaselineByBps(
  latestCents: number,
  baselineCents: number,
  thresholdBps: number,
): boolean {
  if (baselineCents <= 0) return false;
  return latestCents * 10000 > baselineCents * (10000 + thresholdBps);
}

export function classifyPriceTrend(args: {
  latestCents: number | null;
  previousCents: number | null;
  avg90Cents: number | null;
  spikeVsAvgBps?: number;
  spikeVsPrevBps?: number;
  highVolatilityCvBps?: number;
  windowPrices90dCents: readonly number[];
}): {
  trendKind: TrendKind;
  priceRecentlyIncreasedVsAvg: boolean;
  priceRecentlyIncreasedVsPrev: boolean;
  highVolatility: boolean;
} {
  const spikeVsAvg = args.spikeVsAvgBps ?? DEFAULT_SPIKE_VS_AVG_BPS;
  const spikeVsPrev = args.spikeVsPrevBps ?? DEFAULT_SPIKE_VS_PREV_BPS;
  const cvThr = args.highVolatilityCvBps ?? DEFAULT_HIGH_VOLATILITY_CV_BPS;

  const cvRatio =
    args.windowPrices90dCents.length >= 2
      ? coefficientOfVariationRatio(args.windowPrices90dCents)
      : null;
  const highVolatility =
    cvRatio !== null && cvRatio * 10000 >= cvThr;

  let trendKind: TrendKind = 'unknown';
  let prioritizedUpVsAvg = false;
  const avg = args.avg90Cents;
  const latest = args.latestCents;
  const prev = args.previousCents;

  let priceRecentlyIncreasedVsAvg = false;
  let priceRecentlyIncreasedVsPrev = false;

  if (latest !== null && avg !== null) {
    priceRecentlyIncreasedVsAvg = latestAboveBaselineByBps(
      latest,
      avg,
      spikeVsAvg,
    );
  }

  if (latest !== null && prev !== null) {
    priceRecentlyIncreasedVsPrev = latestAboveBaselineByBps(
      latest,
      prev,
      spikeVsPrev,
    );
  }

  if (latest !== null && avg !== null && latest < avg) {
    trendKind = 'down_vs_avg';
  } else if (latest !== null && avg !== null && priceRecentlyIncreasedVsAvg) {
    trendKind = 'up_vs_avg';
    prioritizedUpVsAvg = true;
  } else if (
    latest !== null &&
    prev !== null &&
    priceRecentlyIncreasedVsPrev &&
    !prioritizedUpVsAvg
  ) {
    trendKind = 'up_vs_prev';
  } else if (
    latest !== null &&
    avg !== null &&
    !priceRecentlyIncreasedVsAvg &&
    !highVolatility
  ) {
    trendKind = 'stable';
  } else if (latest !== null && avg === null && prev === null) {
    trendKind = 'stable';
  }

  return {
    trendKind,
    priceRecentlyIncreasedVsAvg,
    priceRecentlyIncreasedVsPrev,
    highVolatility,
  };
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/** Trend / volatility for one vendor’s own history rows (any catalog links merged). */
export function classifyPriceTrendForVendorHistory(
  rows: ReadonlyArray<{ priceCents: number; createdAt: Date; effectiveAt: Date | null }>,
  args?: { nowMs?: number },
): {
  trendKind: TrendKind;
  priceRecentlyIncreasedVsAvg: boolean;
  priceRecentlyIncreasedVsPrev: boolean;
  highVolatility: boolean;
} {
  if (rows.length === 0) {
    return {
      trendKind: 'unknown',
      priceRecentlyIncreasedVsAvg: false,
      priceRecentlyIncreasedVsPrev: false,
      highVolatility: false,
    };
  }
  const nowMs = args?.nowMs ?? Date.now();
  const since = nowMs - NINETY_DAYS_MS;
  const sorted = [...rows].sort(
    (a, b) => observationInstant(b) - observationInstant(a),
  );
  const latest = sorted[0]!;
  const previous = sorted[1] ?? null;
  const windowPrices = sorted
    .filter((r) => observationInstant(r) >= since)
    .map((r) => r.priceCents);
  const avg90 = meanCents(windowPrices);
  return classifyPriceTrend({
    latestCents: latest.priceCents,
    previousCents: previous?.priceCents ?? null,
    avg90Cents: avg90,
    windowPrices90dCents: windowPrices,
  });
}
