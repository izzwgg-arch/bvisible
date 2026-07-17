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
  /// Cheapest entered vendor price, dollars as cents.
  priceCents: number;
  vendor: string;
  /// Every entered vendor price (for purchasing / vendor pick).
  vendorPrices: Array<{ vendor: string; priceCents: number }>;
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
  priceCents: number;
  /// Preferred vendor if entered; otherwise a retail vendor detected from
  /// the price-source/notes text (e.g. "Amazon reference: …").
  vendor: string;
  unitAreaSqFt: number;
  unitLinearFt: number;
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

export function sheetItemKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}
