// Parsed snapshot of the live Google pricing Sheet ("B Visible Formula").
// The Sheet is the catalog source of truth (owner keeps editing prices
// there); the app caches a parsed snapshot per tenant in sheet_sync_state
// and layers app-side overrides on top (Pricing backend).
//
// Tab names are the Sheet's EXACT names — including the intentional
// spellings "Meterial price" and "Machinary Price". Never "fix" them.

export interface SheetMaterial {
  /// Normalized key = lowercased trimmed name (stable upsert identity).
  key: string;
  name: string;
  category: string;
  /// Cheapest entered vendor price, dollars as cents. 0 when unpriced.
  priceCents: number;
  vendor: string;
  /// Every entered vendor price (for purchasing / vendor pick).
  vendorPrices: Array<{ vendor: string; priceCents: number }>;
  /// Retail product page and SKU/ASIN, from this tab's cols M and N. This is
  /// where the owner records Amazon links, so these are the values the
  /// shop-order flow needs to build a prefilled cart. Empty when absent.
  productUrl: string;
  vendorSku: string;
  /// True when the Sheet row carries no price yet. These rows used to be
  /// dropped on import, which made items added ahead of their price simply
  /// invisible. They are now carried through so they show up in the Catalog
  /// as "Price not set", but every surface that produces money — the estimate
  /// material picker, the shop-order cart — must exclude them so nothing can
  /// be quoted or ordered at $0.00 by accident.
  unpriced: boolean;
}

export interface SheetMachine {
  key: string;
  name: string;
  ratePerHourCents: number;
}

export interface SheetSqftRate {
  id: string;
  name: string;
  category: string;
  unit: string;
  materialKeyword: string;
  /// FINAL price per sq ft — already includes markup (R-EST-05).
  pricePerSqFtCents: number;
  wastePercent: number;
  defaultMachine: string;
  shopMinutesPerSqFt: number;
  notes: string;
}

export interface SheetVehicleWrap {
  id: string;
  name: string;
  coverage: string;
  billableAreaSqFt: number;
  /// FINAL wrap price — already includes markup (R-EST-05).
  priceCents: number;
  notes: string;
}

export interface SheetBundle {
  id: string;
  name: string;
  signType: string;
  shopHours: number;
  designUnits: number;
  installHours: number;
  travelHours: number;
  installers: number;
  notes: string;
}

export interface SheetBundleComponent {
  packageId: string;
  componentType: 'Material' | 'Machine' | 'Square Foot';
  itemName: string;
  quantity: number;
  optional: boolean;
  notes: string;
}

export interface SheetRecommendation {
  signType: string;
  materialKeyword: string;
  preferredItem: string;
  reason: string;
  priority: 'Required' | 'Check';
}

export interface SheetVendorCatalogItem {
  id: string;
  category: string;
  subcategory: string;
  name: string;
  spec: string;
  size: string;
  /// Cheapest entered vendor price in cents.
  priceCents: number;
  vendor: string;
  vendorPrices: Array<{ vendor: string; priceCents: number }>;
  vendorSku: string;
  productUrl: string;
}

/// "Internal Materials" — shop-supply catalog (tapes, adhesives, primers,
/// retail items from Amazon / Home Depot / Walmart…). Purchasing-side:
/// merged into the shop-order catalog so every supply is orderable.
export interface SheetInternalMaterial {
  /// Catalog ID from the Sheet (stable identity), e.g. "blue-tape-roll".
  id: string;
  category: string;
  subcategory: string;
  name: string;
  spec: string;
  /// Unit label, e.g. "Roll", "Each", "8 oz".
  size: string;
  /// 0 when the Sheet row has no price yet — see `unpriced`.
  priceCents: number;
  /// Preferred vendor if entered; otherwise a retail vendor detected from
  /// the price-source/notes text (e.g. "Amazon reference: …").
  vendor: string;
  /// The Sheet's explicit preferred-vendor entry (col 7) only — '' when the
  /// row has none and `vendor` came from a retail hint. Optional because
  /// snapshots cached before this field existed won't carry it.
  preferredVendor?: string;
  unitAreaSqFt: number;
  unitLinearFt: number;
  /// Product page URL for retail items ("www.amazon.com/dp/B0…"). Empty when
  /// the Sheet row has none. Without this (or an ASIN in `vendorSku`) the
  /// shop-order flow cannot build an Amazon cart and falls back to per-item
  /// store searches.
  productUrl: string;
  /// Vendor SKU / Amazon ASIN. Empty when the Sheet row has none.
  vendorSku: string;
  /// True when the Sheet row carries no price yet. Kept out of the
  /// shop-order cart so nothing is ordered at $0.00.
  unpriced: boolean;
}

export interface SheetVendorDirectoryEntry {
  vendor: string;
  email: string;
  contactName: string;
  phone: string;
  notes: string;
}

export interface SheetAlias {
  alias: string;
  canonical: string;
}

export interface SheetData {
  materials: SheetMaterial[];
  machines: SheetMachine[];
  sqftRates: SheetSqftRate[];
  vehicleWraps: SheetVehicleWrap[];
  bundles: SheetBundle[];
  bundleComponents: SheetBundleComponent[];
  recommendations: SheetRecommendation[];
  vendorCatalog: SheetVendorCatalogItem[];
  /// May be absent in snapshots cached before this tab was added — always
  /// read with `?? []`.
  internalMaterials?: SheetInternalMaterial[];
  vendorDirectory: SheetVendorDirectoryEntry[];
  aliases: SheetAlias[];
  fetchedAt: string;
}

export interface SheetSyncSnapshot {
  sheetId: string;
  data: SheetData;
  status: 'OK' | 'ERROR';
  lastError: string | null;
  syncedAt: Date | null;
}

/// The "Internal Materials" tab's retail columns — the only place a shop
/// supply's Amazon ASIN or product page can be recorded. Kept here so the
/// parser and the header-seeding script cannot drift apart: if these move,
/// both follow.
///
/// The tab shipped with 13 columns (A–M, ending in "Active"); N and O were
/// appended afterwards and are optional — rows without them read as ''.
export const INTERNAL_MATERIALS_TAB = 'Internal Materials';
export const INTERNAL_MATERIALS_PRODUCT_URL_COL = 13; // N
export const INTERNAL_MATERIALS_SKU_COL = 14; // O
export const INTERNAL_MATERIALS_RETAIL_HEADER = ['Product URL', 'SKU / ASIN'] as const;

export function sheetItemKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}
