import type { EstimateLineKind, ShopCatalogUnit } from '@bvisible/db';
import { parseQty } from '@bvisible/pricing';
import { sellPriceFromCostAndMarkup } from '@/lib/shop-material/markup';

export type BundleVendorSnapshotRow = {
  vendorId: string;
  vendorName: string;
  vendorSku: string | null;
  latestPriceCents: number | null;
  latestUnit: string | null;
  effectiveAt: string | null;
  createdAt: string | null;
  isPreferred: boolean;
  isCheapest: boolean;
};

export type BundleComponentInput = {
  componentCatalogItemId: string | null;
  componentName: string;
  componentType: EstimateLineKind;
  categories: string[];
  quantity: string;
  unit: ShopCatalogUnit;
  customUnitLabel: string | null;
  internalUnitCostCents: number;
  markupPercentMilli: number;
  defaultSellCents: number | null;
  preferredVendorId: string | null;
  cheapestVendorId: string | null;
  selectedVendorId: string | null;
  vendorSnapshot: BundleVendorSnapshotRow[];
  pricingMethod: string | null;
  pricingInputsJson: unknown;
  notes: string | null;
};

export type NormalizedBundleComponent = Omit<
  BundleComponentInput,
  'quantity' | 'vendorSnapshot' | 'pricingInputsJson'
> & {
  quantityMilli: number;
  totalCostCents: number;
  totalSellCents: number;
  vendorSnapshotJson: BundleVendorSnapshotRow[];
  pricingInputsJson: unknown;
};

export function calculateComponentTotals(input: {
  quantityMilli: number;
  internalUnitCostCents: number;
  markupPercentMilli: number;
  defaultSellCents: number | null;
}): { totalCostCents: number; totalSellCents: number; unitSellCents: number } {
  const quantityMilli = Number.isFinite(input.quantityMilli) ? Math.max(0, Math.trunc(input.quantityMilli)) : 0;
  const unitCost = Number.isFinite(input.internalUnitCostCents)
    ? Math.max(0, Math.trunc(input.internalUnitCostCents))
    : 0;
  const unitSell =
    input.defaultSellCents !== null && input.defaultSellCents !== undefined
      ? Math.max(0, Math.trunc(input.defaultSellCents))
      : sellPriceFromCostAndMarkup(unitCost, input.markupPercentMilli);

  return {
    totalCostCents: Math.round((quantityMilli * unitCost) / 1000),
    totalSellCents: Math.round((quantityMilli * unitSell) / 1000),
    unitSellCents: unitSell,
  };
}

export function normalizeBundleComponent(
  component: BundleComponentInput,
): NormalizedBundleComponent | { error: string } {
  const componentName = component.componentName.trim().replace(/\s+/g, ' ');
  if (componentName.length < 2) return { error: 'Each component needs a name.' };

  const quantityMilli = parseQty(component.quantity.trim() || '1');
  if (quantityMilli === null || quantityMilli <= 0) {
    return { error: `Enter a positive quantity for ${componentName}.` };
  }

  const totals = calculateComponentTotals({
    quantityMilli,
    internalUnitCostCents: component.internalUnitCostCents,
    markupPercentMilli: component.markupPercentMilli,
    defaultSellCents: component.defaultSellCents,
  });

  return {
    componentCatalogItemId: component.componentCatalogItemId,
    componentName: componentName.slice(0, 400),
    componentType: component.componentType,
    categories: component.categories.length > 0 ? component.categories : [component.componentType],
    quantityMilli,
    unit: component.unit,
    customUnitLabel: component.customUnitLabel?.slice(0, 40) ?? null,
    internalUnitCostCents: Math.max(0, Math.trunc(component.internalUnitCostCents)),
    markupPercentMilli: Math.max(0, Math.trunc(component.markupPercentMilli)),
    defaultSellCents:
      component.defaultSellCents === null ? null : Math.max(0, Math.trunc(component.defaultSellCents)),
    totalCostCents: totals.totalCostCents,
    totalSellCents: totals.totalSellCents,
    preferredVendorId: component.preferredVendorId,
    cheapestVendorId: component.cheapestVendorId,
    selectedVendorId: component.selectedVendorId,
    vendorSnapshotJson: component.vendorSnapshot,
    pricingMethod: component.pricingMethod?.slice(0, 40) ?? null,
    pricingInputsJson: component.pricingInputsJson ?? null,
    notes: component.notes?.slice(0, 2000) ?? null,
  };
}

export function calculateBundleTotals(args: {
  components: ReadonlyArray<{ totalCostCents: number; totalSellCents: number }>;
  overallMarkupPercentMilli: number;
  defaultSellOverrideCents: number | null;
}): {
  totalCostCents: number;
  totalSellCents: number;
  derivedSellCents: number;
} {
  const totalCostCents = args.components.reduce((sum, component) => sum + component.totalCostCents, 0);
  const componentSellSum = args.components.reduce((sum, component) => sum + component.totalSellCents, 0);
  const markedUpSell = sellPriceFromCostAndMarkup(totalCostCents, args.overallMarkupPercentMilli);
  const derivedSellCents = Math.max(componentSellSum, markedUpSell);
  return {
    totalCostCents,
    totalSellCents: args.defaultSellOverrideCents ?? derivedSellCents,
    derivedSellCents,
  };
}
