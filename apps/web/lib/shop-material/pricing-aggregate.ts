import type { VendorPriceExtractionMethod } from '@bvisible/db';

export type PriceObservationRow = {
  vendorId: string;
  vendorName: string;
  vendorCatalogItemId: string;
  priceCents: number;
  createdAt: Date;
  effectiveAt: Date | null;
  extractionMethod: VendorPriceExtractionMethod;
};

/** Stable ordering key for “latest” comparisons — manual economic date wins when set. */
export function observationInstant(row: {
  effectiveAt: Date | null;
  createdAt: Date;
}): number {
  const a = row.effectiveAt?.getTime();
  if (typeof a === 'number' && !Number.isNaN(a)) return a;
  return row.createdAt.getTime();
}

/** Latest row per vendor by observationInstant (tie-break newer createdAt). */
export function latestObservationPerVendor(
  rows: ReadonlyArray<PriceObservationRow>,
): Map<string, PriceObservationRow> {
  const byVendor = new Map<string, PriceObservationRow>();
  for (const r of rows) {
    const prev = byVendor.get(r.vendorId);
    if (!prev) {
      byVendor.set(r.vendorId, r);
      continue;
    }
    const tNew = observationInstant(r);
    const tPrev = observationInstant(prev);
    if (tNew > tPrev || (tNew === tPrev && r.createdAt.getTime() > prev.createdAt.getTime())) {
      byVendor.set(r.vendorId, r);
    }
  }
  return byVendor;
}

export function cheapestAmongLatest(
  latestByVendor: Map<string, PriceObservationRow>,
): PriceObservationRow | null {
  let best: PriceObservationRow | null = null;
  for (const r of latestByVendor.values()) {
    if (!best || r.priceCents < best.priceCents) best = r;
  }
  return best;
}

export function preferredVendorLatest(
  preferredVendorId: string | null | undefined,
  latestByVendor: Map<string, PriceObservationRow>,
): PriceObservationRow | null {
  if (!preferredVendorId) return null;
  return latestByVendor.get(preferredVendorId) ?? null;
}

/** Pick operator-facing suggested unit cost: preferred vendor latest when present, else global cheapest among latest. */
export function suggestedUnitCostCents(args: {
  preferredVendorId: string | null | undefined;
  latestByVendor: Map<string, PriceObservationRow>;
}): number | null {
  const pref = preferredVendorLatest(args.preferredVendorId, args.latestByVendor);
  if (pref) return pref.priceCents;
  const cheap = cheapestAmongLatest(args.latestByVendor);
  return cheap?.priceCents ?? null;
}
