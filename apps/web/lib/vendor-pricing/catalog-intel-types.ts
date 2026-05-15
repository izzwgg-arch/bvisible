import type { TrendKind } from './trends';

export type CatalogLookupMatchKind =
  | 'none'
  | 'exact_name'
  | 'exact_alias'
  | 'prefix'
  | 'shop_item_name'
  | 'shop_item_alias';

export type ManagedVendorLatestRow = {
  vendorId: string;
  vendorName: string;
  priceCents: number;
  updatedAtIso: string;
  sourceLabel: string;
  confidenceLabel: string | null;
};

export type ManagedPriceTrendFlags = {
  priceRecentlyIncreasedVsAvg: boolean;
  priceRecentlyIncreasedVsPrev: boolean;
  highVolatility: boolean;
};

/** Serializable payload for estimate UI (server action → client). */
export type ManagedItemIntel = {
  id: string;
  displayName: string;
  nameNormalized: string;
  detailHref: string;
  matchVia: 'shop_name' | 'shop_alias' | 'linked_catalog';
  preferredVendorId: string | null;
  cheapestVendorId: string | null;
  cheapestVendorName: string | null;
  cheapestPriceCents: number | null;
  preferredVendorName: string | null;
  preferredLatestPriceCents: number | null;
  /** When preferred latest is higher than deterministic cheapest latest. */
  preferredPremiumVsCheapestCents: number | null;
  suggestedUnitCostCents: number | null;
  vendorLatestRows: readonly ManagedVendorLatestRow[];
  cheapestPriceTrend: ManagedPriceTrendFlags | null;
  preferredPriceTrend: ManagedPriceTrendFlags | null;
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
