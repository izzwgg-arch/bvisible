import type { TrendKind } from './trends';

export type CatalogLookupMatchKind =
  | 'none'
  | 'exact_name'
  | 'exact_alias'
  | 'prefix';

/** Serializable payload for estimate UI (server action → client). */
export type VendorCatalogLookupResult = {
  matchKind: CatalogLookupMatchKind;
  matchedCatalogItemIds: readonly string[];
  primaryCatalogItemId: string | null;
  primaryCatalogNameNormalized: string | null;
  latestPriceCents: number | null;
  latestObservationAt: string | null;
  previousPriceCents: number | null;
  cheapestVendorName: string | null;
  cheapestPriceCents: number | null;
  avg90PriceCents: number | null;
  observationCount90d: number;
  vendorCount90d: number;
  lastPoAt: string | null;
  lastPurchasedVendorName: string | null;
  lastOcrReceiptAt: string | null;
  trendKind: TrendKind;
  priceRecentlyIncreasedVsAvg: boolean;
  priceRecentlyIncreasedVsPrev: boolean;
  highVolatility: boolean;
};
