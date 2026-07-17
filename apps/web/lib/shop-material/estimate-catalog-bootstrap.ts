import type { PrismaClient } from '@bvisible/db';
import { EstimateLineKind } from '@bvisible/db';
import {
  cheapestAmongLatest,
  latestObservationPerVendor,
  preferredVendorLatest,
  suggestedUnitCostCents,
  type PriceObservationRow,
} from '@/lib/shop-material/pricing-aggregate';
import type {
  EstimateCatalogBundleComponent,
  EstimateCatalogPickerRow,
} from '@/lib/shop-material/apply-catalog-to-estimate-line';
import { getSheetSnapshot } from '@/lib/sheet-sync/sync';

const MAX_ITEMS = 420;
const MAX_HISTORIES = 14_000;

export async function loadEstimateCatalogPickerRows(
  prisma: PrismaClient,
  tenantId: string,
): Promise<EstimateCatalogPickerRow[]> {
  const items = await prisma.shopMaterialItem.findMany({
    where: { tenantId, isActive: true },
    orderBy: [{ name: 'asc' }],
    take: MAX_ITEMS,
    select: {
      id: true,
      name: true,
      nameNormalized: true,
      itemType: true,
      kind: true,
      catalogUnit: true,
      customUnitLabel: true,
      internalCostCents: true,
      markupPercentMilli: true,
      defaultSellPriceCents: true,
      defaultQtyMilli: true,
      pricingMethod: true,
      pricingEngine: true,
      pricingInputsJson: true,
      pricingOutputJson: true,
      formulaVersion: true,
      customerDescription: true,
      machineId: true,
      preferredVendorId: true,
      selectedVendorId: true,
      selectedVendorMode: true,
      preferredVendor: { select: { name: true } },
      _count: { select: { bundleComponents: true } },
      bundleComponents: {
        orderBy: [{ sortOrder: 'asc' }],
        select: {
          componentCatalogItemId: true,
          componentName: true,
          componentType: true,
          categories: true,
          quantityMilli: true,
          unit: true,
          customUnitLabel: true,
          internalUnitCostCents: true,
          markupPercentMilli: true,
          defaultSellCents: true,
          totalCostCents: true,
          totalSellCents: true,
          selectedVendor: { select: { name: true } },
          preferredVendor: { select: { name: true } },
          cheapestVendor: { select: { name: true } },
          vendorSnapshotJson: true,
        },
      },
      sheetKey: true,
      vendorCatalogLinks: { select: { id: true } },
    },
  });

  // Sheet fallback for vendor intel: items synced from the pricing Sheet
  // carry per-vendor prices on the "Meterial price" tab but have no
  // vendor_catalog_items links or price observations. When the
  // observation system has nothing for a material, fall back to the
  // Sheet's vendor prices so the estimate page shows the cheapest vendor
  // instead of "No vendor prices".
  const sheetByKey = new Map<
    string,
    { vendor: string; priceCents: number; vendorPrices: Array<{ vendor: string; priceCents: number }> }
  >();
  try {
    const snapshot = await getSheetSnapshot(tenantId);
    for (const m of snapshot.data.materials) {
      sheetByKey.set(m.key, { vendor: m.vendor, priceCents: m.priceCents, vendorPrices: m.vendorPrices });
    }
  } catch {
    /* Sheet unavailable — vendor intel simply stays empty */
  }
  const applySheetVendorFallback = (
    row: EstimateCatalogPickerRow,
    sheetKey: string | null,
  ): EstimateCatalogPickerRow => {
    if (row.kind !== EstimateLineKind.MATERIAL || row.catalogCheapestVendorName != null) return row;
    const sheet = sheetKey ? sheetByKey.get(sheetKey) : undefined;
    if (!sheet) return row;
    const sorted = [...sheet.vendorPrices].sort((a, b) => a.priceCents - b.priceCents);
    const cheapest =
      sorted[0] ?? (sheet.vendor ? { vendor: sheet.vendor, priceCents: sheet.priceCents } : null);
    if (!cheapest || !cheapest.vendor) return row;
    return {
      ...row,
      catalogCheapestVendorCostCents: cheapest.priceCents,
      catalogCheapestVendorName: cheapest.vendor,
    };
  };

  const catalogIds = [...new Set(items.flatMap((it) => it.vendorCatalogLinks.map((l) => l.id)))];
  if (catalogIds.length === 0) {
    return items.map((it) => applySheetVendorFallback({
      id: it.id,
      name: it.name,
      nameNormalized: it.nameNormalized,
      itemType: it.itemType,
      kind: it.kind,
      catalogUnit: it.catalogUnit,
      customUnitLabel: it.customUnitLabel,
      internalCostCents: it.internalCostCents,
      markupPercentMilli: it.markupPercentMilli,
      defaultSellPriceCents: it.defaultSellPriceCents,
      defaultQtyMilli: it.defaultQtyMilli,
      customerDescription: it.customerDescription,
      componentCount: it._count.bundleComponents,
      machineId: it.machineId,
      preferredVendorId: it.preferredVendorId,
      selectedVendorId: it.selectedVendorId,
      selectedVendorMode: it.selectedVendorMode,
      selectedVendorCostCents: null,
      pricingMethod: it.pricingMethod,
      pricingEngine: it.pricingEngine,
      pricingInputsJson: it.pricingInputsJson,
      pricingOutputJson: it.pricingOutputJson,
      formulaVersion: it.formulaVersion,
      suggestedVendorCostCents: null,
      catalogPreferredVendorCostCents: null,
      catalogPreferredVendorName: it.preferredVendor?.name ?? null,
      catalogCheapestVendorCostCents: null,
      catalogCheapestVendorId: null,
      catalogCheapestVendorName: null,
      bundleComponents: mapBundleComponents(it.bundleComponents),
    }, it.sheetKey));
  }

  const histories = await prisma.vendorPriceHistory.findMany({
    where: { tenantId, vendorCatalogItemId: { in: catalogIds } },
    orderBy: { createdAt: 'desc' },
    take: MAX_HISTORIES,
    select: {
      vendorCatalogItemId: true,
      vendorId: true,
      priceCents: true,
      createdAt: true,
      effectiveAt: true,
      extractionMethod: true,
      vendor: { select: { name: true } },
    },
  });

  const byCatalog = new Map<string, PriceObservationRow[]>();
  for (const h of histories) {
    const obs: PriceObservationRow = {
      vendorId: h.vendorId,
      vendorName: h.vendor.name,
      vendorCatalogItemId: h.vendorCatalogItemId,
      priceCents: h.priceCents,
      createdAt: h.createdAt,
      effectiveAt: h.effectiveAt,
      extractionMethod: h.extractionMethod,
    };
    const arr = byCatalog.get(h.vendorCatalogItemId);
    if (arr) arr.push(obs);
    else byCatalog.set(h.vendorCatalogItemId, [obs]);
  }

  return items.map((it) => {
    let suggestedVendorCostCents: number | null = null;
    let catalogPreferredVendorCostCents: number | null = null;
    let catalogCheapestVendorCostCents: number | null = null;
    let catalogCheapestVendorId: string | null = null;
    let catalogCheapestVendorName: string | null = null;
    let selectedVendorCostCents: number | null = null;

    if (it.kind === EstimateLineKind.MATERIAL && it.vendorCatalogLinks.length > 0) {
      const flat: PriceObservationRow[] = [];
      for (const link of it.vendorCatalogLinks) {
        const chunk = byCatalog.get(link.id);
        if (chunk) flat.push(...chunk);
      }
      const latestByVendor = latestObservationPerVendor(flat);
      suggestedVendorCostCents = suggestedUnitCostCents({
        preferredVendorId: it.preferredVendorId,
        latestByVendor,
      });
      const prefObs = preferredVendorLatest(it.preferredVendorId, latestByVendor);
      catalogPreferredVendorCostCents = prefObs?.priceCents ?? null;
      selectedVendorCostCents = it.selectedVendorId
        ? latestByVendor.get(it.selectedVendorId)?.priceCents ?? null
        : null;
      const cheap = cheapestAmongLatest(latestByVendor, {
        preferredVendorId: it.preferredVendorId,
      });
      catalogCheapestVendorCostCents = cheap?.priceCents ?? null;
      catalogCheapestVendorId = cheap?.vendorId ?? null;
      catalogCheapestVendorName = cheap?.vendorName ?? null;
    }

    return applySheetVendorFallback({
      id: it.id,
      name: it.name,
      nameNormalized: it.nameNormalized,
      itemType: it.itemType,
      kind: it.kind,
      catalogUnit: it.catalogUnit,
      customUnitLabel: it.customUnitLabel,
      internalCostCents: it.internalCostCents,
      markupPercentMilli: it.markupPercentMilli,
      defaultSellPriceCents: it.defaultSellPriceCents,
      defaultQtyMilli: it.defaultQtyMilli,
      pricingMethod: it.pricingMethod,
      pricingEngine: it.pricingEngine,
      pricingInputsJson: it.pricingInputsJson,
      pricingOutputJson: it.pricingOutputJson,
      formulaVersion: it.formulaVersion,
      customerDescription: it.customerDescription,
      componentCount: it._count.bundleComponents,
      machineId: it.machineId,
      preferredVendorId: it.preferredVendorId,
      selectedVendorId: it.selectedVendorId,
      selectedVendorMode: it.selectedVendorMode,
      selectedVendorCostCents,
      suggestedVendorCostCents,
      catalogPreferredVendorCostCents,
      catalogPreferredVendorName: it.preferredVendor?.name ?? null,
      catalogCheapestVendorCostCents,
      catalogCheapestVendorId,
      catalogCheapestVendorName,
      bundleComponents: mapBundleComponents(it.bundleComponents),
    }, it.sheetKey);
  });
}

function mapBundleComponents(
  components: ReadonlyArray<{
    componentCatalogItemId: string | null;
    componentName: string;
    componentType: EstimateLineKind;
    categories: string[];
    quantityMilli: number;
    unit: EstimateCatalogBundleComponent['unit'];
    customUnitLabel: string | null;
    internalUnitCostCents: number;
    markupPercentMilli: number;
    defaultSellCents: number | null;
    totalCostCents: number;
    totalSellCents: number;
    selectedVendor: { name: string } | null;
    preferredVendor: { name: string } | null;
    cheapestVendor: { name: string } | null;
    vendorSnapshotJson: unknown;
  }>,
): EstimateCatalogPickerRow['bundleComponents'] {
  return components.map((component) => ({
    componentCatalogItemId: component.componentCatalogItemId,
    componentName: component.componentName,
    componentType: component.componentType,
    categories: component.categories,
    quantityMilli: component.quantityMilli,
    unit: component.unit,
    customUnitLabel: component.customUnitLabel,
    internalUnitCostCents: component.internalUnitCostCents,
    markupPercentMilli: component.markupPercentMilli,
    defaultSellCents: component.defaultSellCents,
    totalCostCents: component.totalCostCents,
    totalSellCents: component.totalSellCents,
    selectedVendorName: component.selectedVendor?.name ?? null,
    preferredVendorName: component.preferredVendor?.name ?? null,
    cheapestVendorName: component.cheapestVendor?.name ?? null,
    vendorSnapshot: isVendorSnapshot(component.vendorSnapshotJson)
      ? component.vendorSnapshotJson
      : [],
  }));
}

function isVendorSnapshot(
  value: unknown,
): value is EstimateCatalogBundleComponent['vendorSnapshot'] {
  return Array.isArray(value);
}
