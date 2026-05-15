import type { TrendKind } from './trends';

export type CatalogLookupMatchKind =
  | 'none'
  | 'exact_name'
  | 'exact_alias'
  | 'prefix'
  | 'shop_item_name'
  | 'shop_item_alias';

/** Serializable payload for estimate UI (server action → client). */
export type ManagedItemIntel = {
  id: string;
  displayName: string;
  nameNormalized: string;
  detailHref: string;
  matchVia: 'shop_name' | 'shop_alias' | 'linked_catalog';
  cheapestVendorName: string | null;
  cheapestPriceCents: number | null;
  preferredVendorName: string | null;
  preferredLatestPriceCents: number | null;
  suggestedUnitCostCents: number | null;
};

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
  managedItem: ManagedItemIntel | null;
};
