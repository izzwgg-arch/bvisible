import type { VendorPriceConfidence, VendorPriceExtractionMethod } from '@bvisible/db';

export type PriceObservationRow = {
  vendorId: string;
  vendorName: string;
  vendorCatalogItemId: string;
  priceCents: number;
  createdAt: Date;
  effectiveAt: Date | null;
  extractionMethod: VendorPriceExtractionMethod;
  confidence?: VendorPriceConfidence | null;
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

export type CheapestAmongLatestOptions = {
  /** When multiple vendors share the minimum latest price, prefer this vendor id if it is among the ties. */
  preferredVendorId?: string | null;
};

/**
 * Cheapest vendor = MIN(latest price per vendor). Tie-break (deterministic):
 * 1) preferred vendor when it is tied at the minimum
 * 2) most recent observation instant (effectiveAt else createdAt)
 * 3) vendor name (localeCompare)
 */
export function cheapestAmongLatest(
  latestByVendor: Map<string, PriceObservationRow>,
  opts?: CheapestAmongLatestOptions,
): PriceObservationRow | null {
  if (latestByVendor.size === 0) return null;
  let minPrice = Infinity;
  for (const r of latestByVendor.values()) {
    if (r.priceCents < minPrice) minPrice = r.priceCents;
  }
  if (!Number.isFinite(minPrice)) return null;

  const atMin: PriceObservationRow[] = [];
  for (const r of latestByVendor.values()) {
    if (r.priceCents === minPrice) atMin.push(r);
  }
  if (atMin.length === 1) return atMin[0]!;

  const preferredId = opts?.preferredVendorId;
  if (preferredId) {
    const prefHit = atMin.find((r) => r.vendorId === preferredId);
    if (prefHit) return prefHit;
  }

  atMin.sort((a, b) => {
    const ta = observationInstant(a);
    const tb = observationInstant(b);
    if (tb !== ta) return tb - ta;
    const ca = a.createdAt.getTime();
    const cb = b.createdAt.getTime();
    if (cb !== ca) return cb - ca;
    const nameCmp = a.vendorName.localeCompare(b.vendorName);
    if (nameCmp !== 0) return nameCmp;
    return a.vendorId.localeCompare(b.vendorId);
  });
  return atMin[0] ?? null;
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
  const cheap = cheapestAmongLatest(args.latestByVendor, {
    preferredVendorId: args.preferredVendorId,
  });
  return cheap?.priceCents ?? null;
}
