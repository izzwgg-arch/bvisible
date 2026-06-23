import { EstimateLineKind, ShopMaterialItemType, prisma } from '@bvisible/db';
import type { BundleInitial, BundleSourceRow } from './bundle-form';

export async function loadBundleSources(tenantId: string): Promise<BundleSourceRow[]> {
  const items = await prisma.shopMaterialItem.findMany({
    where: { tenantId, isActive: true, itemType: ShopMaterialItemType.SINGLE },
    orderBy: [{ name: 'asc' }],
    take: 500,
    select: {
      id: true,
      name: true,
      nameNormalized: true,
      kind: true,
      categories: true,
      catalogUnit: true,
      customUnitLabel: true,
      internalCostCents: true,
      markupPercentMilli: true,
      defaultSellPriceCents: true,
      defaultQtyMilli: true,
      preferredVendorId: true,
      pricingMethod: true,
      pricingInputsJson: true,
      vendorCatalogLinks: {
        select: {
          vendorId: true,
          vendorSku: true,
          vendor: { select: { name: true } },
          priceHistory: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              priceCents: true,
              unit: true,
              effectiveAt: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });

  return items.map((item) => {
    const latestRows = item.vendorCatalogLinks
      .map((link) => ({ link, latest: link.priceHistory[0] ?? null }))
      .filter((row) => row.latest !== null);
    const cheapest = latestRows.reduce<(typeof latestRows)[number] | null>((best, row) => {
      if (!row.latest) return best;
      if (!best?.latest || row.latest.priceCents < best.latest.priceCents) return row;
      return best;
    }, null);
    const preferred = latestRows.find((row) => row.link.vendorId === item.preferredVendorId) ?? null;

    return {
      id: item.id,
      name: item.name,
      nameNormalized: item.nameNormalized,
      kind: item.kind,
      categories: item.categories.length > 0 ? item.categories : [item.kind],
      catalogUnit: item.catalogUnit,
      customUnitLabel: item.customUnitLabel,
      internalCostCents: item.internalCostCents,
      markupPercentMilli: item.markupPercentMilli,
      defaultSellPriceCents: item.defaultSellPriceCents,
      defaultQtyMilli: item.defaultQtyMilli,
      preferredVendorId: item.preferredVendorId,
      cheapestVendorId: cheapest?.link.vendorId ?? null,
      selectedVendorId: preferred?.link.vendorId ?? cheapest?.link.vendorId ?? null,
      pricingMethod: item.pricingMethod,
      pricingInputsJson: item.pricingInputsJson,
      vendorSnapshot:
        item.kind === EstimateLineKind.MATERIAL
          ? item.vendorCatalogLinks.map((link) => {
              const latest = link.priceHistory[0] ?? null;
              return {
                vendorId: link.vendorId,
                vendorName: link.vendor.name,
                vendorSku: link.vendorSku,
                latestPriceCents: latest?.priceCents ?? null,
                latestUnit: latest?.unit ?? null,
                effectiveAt: latest?.effectiveAt?.toISOString() ?? null,
                createdAt: latest?.createdAt?.toISOString() ?? null,
                isPreferred: link.vendorId === item.preferredVendorId,
                isCheapest: link.vendorId === cheapest?.link.vendorId,
              };
            })
          : [],
    };
  });
}

export function bundleInitialFromItem(item: {
  id: string;
  name: string;
  categories: string[];
  catalogUnit: BundleInitial['catalogUnit'];
  defaultQtyMilli: number;
  markupPercentMilli: number;
  defaultSellPriceCents: number | null;
  customerDescription: string | null;
  notes: string | null;
  isActive: boolean;
  bundleComponents: ReadonlyArray<{
    componentCatalogItemId: string | null;
    componentName: string;
    componentType: BundleInitial['components'][number]['componentType'];
    categories: string[];
    quantityMilli: number;
    unit: BundleInitial['components'][number]['unit'];
    customUnitLabel: string | null;
    internalUnitCostCents: number;
    markupPercentMilli: number;
    defaultSellCents: number | null;
    preferredVendorId: string | null;
    cheapestVendorId: string | null;
    selectedVendorId: string | null;
    vendorSnapshotJson: unknown;
    pricingMethod: string | null;
    pricingInputsJson: unknown;
    notes: string | null;
  }>;
}): BundleInitial {
  return {
    id: item.id,
    name: item.name,
    categories: item.categories,
    catalogUnit: item.catalogUnit,
    defaultQty: (item.defaultQtyMilli / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 }),
    markupPercent: (item.markupPercentMilli / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 }),
    defaultSellUsd: item.defaultSellPriceCents == null ? '' : (item.defaultSellPriceCents / 100).toFixed(2),
    customerDescription: item.customerDescription ?? '',
    notes: item.notes ?? '',
    isActive: item.isActive,
    components: item.bundleComponents.map((component) => ({
      componentCatalogItemId: component.componentCatalogItemId,
      componentName: component.componentName,
      componentType: component.componentType,
      categories: component.categories,
      quantity: (component.quantityMilli / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 }),
      unit: component.unit,
      customUnitLabel: component.customUnitLabel,
      internalUnitCostCents: component.internalUnitCostCents,
      markupPercentMilli: component.markupPercentMilli,
      defaultSellCents: component.defaultSellCents,
      preferredVendorId: component.preferredVendorId,
      cheapestVendorId: component.cheapestVendorId,
      selectedVendorId: component.selectedVendorId,
      vendorSnapshot: Array.isArray(component.vendorSnapshotJson)
        ? component.vendorSnapshotJson
        : [],
      pricingMethod: component.pricingMethod,
      pricingInputsJson: component.pricingInputsJson,
      notes: component.notes,
    })),
  };
}
