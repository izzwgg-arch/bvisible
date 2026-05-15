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

/** Higher wins when observation instant + createdAt tie (MANUAL > OCR_APPROVED > regex OCR > …). */
const EXTRACTION_METHOD_RANK: Record<VendorPriceExtractionMethod, number> = {
  LINE_REGEX: 0,
  SUBJECT_REGEX: 1,
  FILENAME_REGEX: 2,
  OCR_TEXT_REGEX: 3,
  OCR_APPROVED: 4,
  MANUAL: 5,
};

export function extractionMethodRank(method: VendorPriceExtractionMethod): number {
  return EXTRACTION_METHOD_RANK[method] ?? 0;
}

/** Stable ordering key for “latest” comparisons — manual economic date wins when set. */
export function observationInstant(row: {
  effectiveAt: Date | null;
  createdAt: Date;
}): number {
  const a = row.effectiveAt?.getTime();
  if (typeof a === 'number' && !Number.isNaN(a)) return a;
  return row.createdAt.getTime();
}

/** True when candidate should replace current as the “latest” observation for this vendor. */
export function latestObservationCompare(candidate: PriceObservationRow, current: PriceObservationRow): boolean {
  const tNew = observationInstant(candidate);
  const tPrev = observationInstant(current);
  if (tNew !== tPrev) return tNew > tPrev;
  const cNew = candidate.createdAt.getTime();
  const cPrev = current.createdAt.getTime();
  if (cNew !== cPrev) return cNew > cPrev;
  const mNew = extractionMethodRank(candidate.extractionMethod);
  const mPrev = extractionMethodRank(current.extractionMethod);
  if (mNew !== mPrev) return mNew > mPrev;
  return candidate.vendorCatalogItemId < current.vendorCatalogItemId;
}

/** Latest row per vendor by observationInstant; ties break on newer createdAt, then extraction source, then catalog id. */
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
    if (latestObservationCompare(r, prev)) {
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
    if (!best) {
      best = r;
      continue;
    }
    if (r.priceCents < best.priceCents) best = r;
    else if (r.priceCents === best.priceCents && r.vendorId < best.vendorId) best = r;
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
