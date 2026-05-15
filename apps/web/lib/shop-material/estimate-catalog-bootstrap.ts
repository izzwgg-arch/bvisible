import type { PrismaClient } from '@bvisible/db';
import { EstimateLineKind } from '@bvisible/db';
import {
  cheapestAmongLatest,
  latestObservationPerVendor,
  preferredVendorLatest,
  suggestedUnitCostCents,
  type PriceObservationRow,
} from '@/lib/shop-material/pricing-aggregate';
import type { EstimateCatalogPickerRow } from '@/lib/shop-material/apply-catalog-to-estimate-line';

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
      kind: true,
      catalogUnit: true,
      customUnitLabel: true,
      internalCostCents: true,
      markupPercentMilli: true,
      defaultSellPriceCents: true,
      defaultQtyMilli: true,
      machineId: true,
      preferredVendorId: true,
      preferredVendor: { select: { name: true } },
      vendorCatalogLinks: { select: { id: true } },
    },
  });

  const catalogIds = [...new Set(items.flatMap((it) => it.vendorCatalogLinks.map((l) => l.id)))];
  if (catalogIds.length === 0) {
    return items.map((it) => ({
      id: it.id,
      name: it.name,
      nameNormalized: it.nameNormalized,
      kind: it.kind,
      catalogUnit: it.catalogUnit,
      customUnitLabel: it.customUnitLabel,
      internalCostCents: it.internalCostCents,
      markupPercentMilli: it.markupPercentMilli,
      defaultSellPriceCents: it.defaultSellPriceCents,
      defaultQtyMilli: it.defaultQtyMilli,
      machineId: it.machineId,
      preferredVendorId: it.preferredVendorId,
      suggestedVendorCostCents: null,
      catalogPreferredVendorCostCents: null,
      catalogPreferredVendorName: it.preferredVendor?.name ?? null,
      catalogCheapestVendorCostCents: null,
      catalogCheapestVendorName: null,
    }));
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
    let catalogCheapestVendorName: string | null = null;

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
      const cheap = cheapestAmongLatest(latestByVendor);
      catalogCheapestVendorCostCents = cheap?.priceCents ?? null;
      catalogCheapestVendorName = cheap?.vendorName ?? null;
    }

    return {
      id: it.id,
      name: it.name,
      nameNormalized: it.nameNormalized,
      kind: it.kind,
      catalogUnit: it.catalogUnit,
      customUnitLabel: it.customUnitLabel,
      internalCostCents: it.internalCostCents,
      markupPercentMilli: it.markupPercentMilli,
      defaultSellPriceCents: it.defaultSellPriceCents,
      defaultQtyMilli: it.defaultQtyMilli,
      machineId: it.machineId,
      preferredVendorId: it.preferredVendorId,
      suggestedVendorCostCents,
      catalogPreferredVendorCostCents,
      catalogPreferredVendorName: it.preferredVendor?.name ?? null,
      catalogCheapestVendorCostCents,
      catalogCheapestVendorName,
    };
  });
}
