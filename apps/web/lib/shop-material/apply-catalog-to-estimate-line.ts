import { EstimateLineKind } from '@bvisible/db';
import type { ShopCatalogUnit } from '@bvisible/db';

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
  suggestedVendorCostCents: number | null;
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
