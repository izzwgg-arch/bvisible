import { EstimateLineKind } from '@bvisible/db';
import type { ShopCatalogUnit } from '@bvisible/db';
import { normalizeVendorCostSourceMode, type PricingEngine, type VendorCostSourceMode } from '@/lib/shop-material/pricing-engine';
import { sellPriceFromCostAndMarkup } from '@/lib/shop-material/markup';

/** Serialized estimate picker row (server → client JSON). */
export type EstimateCatalogPickerRow = {
  id: string;
  name: string;
  nameNormalized: string;
  itemType: 'SINGLE' | 'BUNDLE';
  kind: EstimateLineKind;
  catalogUnit: ShopCatalogUnit;
  customUnitLabel: string | null;
  internalCostCents: number;
  markupPercentMilli: number;
  defaultSellPriceCents: number | null;
  defaultQtyMilli: number;
  pricingMethod: string | null;
  pricingEngine: PricingEngine | null;
  pricingInputsJson: unknown;
  pricingOutputJson: unknown;
  formulaVersion: string | null;
  customerDescription: string | null;
  componentCount: number;
  machineId: string | null;
  preferredVendorId: string | null;
  selectedVendorId: string | null;
  selectedVendorMode: VendorCostSourceMode | null;
  selectedVendorCostCents: number | null;
  /** Unit cost suggested for Apply (preferred latest when linked, else cheapest latest among vendors). */
  suggestedVendorCostCents: number | null;
  /** MATERIAL + vendor history: preferred vendor’s latest linked observation (display-only). */
  catalogPreferredVendorCostCents: number | null;
  catalogPreferredVendorName: string | null;
  /** MATERIAL + vendor history: lowest latest unit cost among vendors (display-only). */
  catalogCheapestVendorCostCents: number | null;
  catalogCheapestVendorId: string | null;
  catalogCheapestVendorName: string | null;
  /** Every vendor price the pricing Sheet lists for this material (unit
   *  cents) — shown in the Selected-vendor dropdown so the operator can
   *  compare all vendors carrying the item, not just the cheapest. */
  sheetVendorPrices?: Array<{ vendor: string; priceCents: number }>;
  bundleComponents?: EstimateCatalogBundleComponent[];
};

export type EstimateCatalogBundleComponent = {
  componentCatalogItemId: string | null;
  componentName: string;
  componentType: EstimateLineKind;
  categories: string[];
  quantityMilli: number;
  unit: ShopCatalogUnit;
  customUnitLabel: string | null;
  internalUnitCostCents: number;
  markupPercentMilli: number;
  defaultSellCents: number | null;
  totalCostCents: number;
  totalSellCents: number;
  selectedVendorName: string | null;
  preferredVendorName: string | null;
  cheapestVendorName: string | null;
  vendorSnapshot: Array<{
    vendorName?: string;
    latestPriceCents?: number | null;
    isPreferred?: boolean;
    isCheapest?: boolean;
  }>;
};

export type MachineRateLookup = ReadonlyMap<string, { ratePerHourCents: number }>;

/** Unit cost written to the estimate grid (always internal/vendor cost, never sell). */
export function resolveCatalogUnitCostCents(args: {
  row: EstimateCatalogPickerRow;
  machinesById: MachineRateLookup;
}): number {
  const { row, machinesById } = args;

  if (row.kind === EstimateLineKind.MACHINE && row.machineId) {
    const m = machinesById.get(row.machineId);
    if (m) return Math.max(0, m.ratePerHourCents);
  }

  if (row.kind === EstimateLineKind.MATERIAL) {
    const mode = row.selectedVendorMode == null ? null : normalizeVendorCostSourceMode(row.selectedVendorMode);
    const selectedByMode =
      mode === 'CHEAPEST'
        ? row.catalogCheapestVendorCostCents
        : mode === 'PREFERRED'
          ? row.catalogPreferredVendorCostCents
          : mode === 'MANUAL'
            ? row.selectedVendorCostCents
            : null;
    if (selectedByMode !== null && selectedByMode !== undefined) return Math.max(0, selectedByMode);
    if (mode !== 'INTERNAL') {
      const v = row.suggestedVendorCostCents;
      if (v !== null && v !== undefined) return Math.max(0, v);
    }
    return Math.max(0, row.internalCostCents);
  }

  return Math.max(0, row.internalCostCents);
}

/** Basis used for the picker “Sell hint” column (matches unit cost Apply uses, before item sell override). */
export function catalogPickerCostBasisCents(args: {
  row: EstimateCatalogPickerRow;
  machinesById: MachineRateLookup;
}): number {
  return resolveCatalogUnitCostCents(args);
}

/** Sell guidance in the catalog picker: explicit catalog override wins, else cost × (1 + markup%). */
export function catalogPickerSellHintCents(args: {
  row: EstimateCatalogPickerRow;
  machinesById: MachineRateLookup;
}): number {
  const { row } = args;
  if (row.defaultSellPriceCents !== null && row.defaultSellPriceCents !== undefined) {
    return Math.max(0, row.defaultSellPriceCents);
  }
  const basis = catalogPickerCostBasisCents(args);
  return sellPriceFromCostAndMarkup(basis, row.markupPercentMilli);
}

/** Patch applied only when the user explicitly picks a catalog row (no typing hooks). */
export function buildLinePatchFromCatalogSelection(args: {
  row: EstimateCatalogPickerRow;
  machinesById: MachineRateLookup;
}): {
  description: string;
  kind: EstimateLineKind;
  qtyMilli: number;
  unitCostCents: number;
  machineId: string | null;
  catalogItemId: string;
  pricingMethod: string | null;
  pricingEngine: PricingEngine | null;
  pricingInputsSnapshotJson: unknown;
  pricingOutputSnapshotJson: unknown;
  formulaVersion: string | null;
  selectedVendorId: string | null;
  selectedVendorMode: VendorCostSourceMode | null;
  customerDescription: string | null;
} {
  const { row, machinesById } = args;
  const unitCostCents = resolveCatalogUnitCostCents({ row, machinesById });
  const machineId =
    row.kind === EstimateLineKind.MACHINE ? row.machineId ?? null : null;

  return {
    description: row.name,
    kind: row.kind,
    qtyMilli: Math.max(0, row.defaultQtyMilli),
    unitCostCents,
    machineId,
    catalogItemId: row.id,
    pricingMethod: row.pricingMethod,
    pricingEngine: row.pricingEngine,
    pricingInputsSnapshotJson: row.pricingInputsJson,
    pricingOutputSnapshotJson: row.pricingOutputJson,
    formulaVersion: row.formulaVersion,
    selectedVendorId:
      normalizeVendorCostSourceMode(row.selectedVendorMode) === 'CHEAPEST'
        ? row.catalogCheapestVendorId
        : normalizeVendorCostSourceMode(row.selectedVendorMode) === 'PREFERRED'
          ? row.preferredVendorId
          : row.selectedVendorId,
    selectedVendorMode: row.selectedVendorMode,
    customerDescription: row.itemType === 'BUNDLE' ? row.customerDescription ?? row.name : null,
  };
}

/** Maps catalog kind → estimate line kind (identity today; kept for tests + docs). */
export function catalogKindToEstimateLineKind(kind: EstimateLineKind): EstimateLineKind {
  return kind;
}
