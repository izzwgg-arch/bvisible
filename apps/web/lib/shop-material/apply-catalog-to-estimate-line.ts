import { EstimateLineKind } from '@bvisible/db';
import type { ShopCatalogUnit } from '@bvisible/db';
import { sellPriceFromCostAndMarkup } from '@/lib/shop-material/markup';

/** Serialized estimate picker row (server → client JSON). */
export type EstimateCatalogPickerRow = {
  id: string;
  name: string;
  nameNormalized: string;
  kind: EstimateLineKind;
  catalogUnit: ShopCatalogUnit;
  customUnitLabel: string | null;
  internalCostCents: number;
  markupPercentMilli: number;
  defaultSellPriceCents: number | null;
  defaultQtyMilli: number;
  machineId: string | null;
  preferredVendorId: string | null;
  /** Unit cost suggested for Apply (preferred latest when linked, else cheapest latest among vendors). */
  suggestedVendorCostCents: number | null;
  /** MATERIAL + vendor history: preferred vendor’s latest linked observation (display-only). */
  catalogPreferredVendorCostCents: number | null;
  catalogPreferredVendorName: string | null;
  /** MATERIAL + vendor history: lowest latest unit cost among vendors (display-only). */
  catalogCheapestVendorCostCents: number | null;
  catalogCheapestVendorName: string | null;
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
    const v = row.suggestedVendorCostCents;
    if (v !== null && v !== undefined) return Math.max(0, v);
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
  };
}

/** Maps catalog kind → estimate line kind (identity today; kept for tests + docs). */
export function catalogKindToEstimateLineKind(kind: EstimateLineKind): EstimateLineKind {
  return kind;
}
