import type { PrismaClient } from '@bvisible/db';
import { EstimateLineKind } from '@bvisible/db';
import type { ManagedItemIntel, ManagedVendorLatestRow } from '@/lib/vendor-pricing/catalog-intel-types';
import {
  cheapestAmongLatest,
  latestObservationPerVendor,
  type PriceObservationRow,
  suggestedUnitCostCents,
} from '@/lib/shop-material/pricing-aggregate';
import { classifyPriceTrendForVendorHistory } from '@/lib/vendor-pricing/trends';
import {
  labelVendorPriceConfidenceProduct,
  labelVendorPriceSourceProduct,
} from '@/lib/vendor-pricing/vendor-price-source-label';
import { formatCatalogUnitDisplay } from '@/lib/shop-material/catalog-unit-display';
import {
  parseVendorUnitToken,
  proposeUnitConversion,
} from '@/lib/vendor-pricing/unit-conversion';

function emptyManagedExtensions(shop: {
  preferredVendorId: string | null;
}): Pick<
  ManagedItemIntel,
  | 'preferredVendorId'
  | 'cheapestVendorId'
  | 'vendorLatestRows'
  | 'preferredPremiumVsCheapestCents'
  | 'cheapestPriceTrend'
  | 'preferredPriceTrend'
> {
  return {
    preferredVendorId: shop.preferredVendorId,
    cheapestVendorId: null,
    vendorLatestRows: [],
    preferredPremiumVsCheapestCents: null,
    cheapestPriceTrend: null,
    preferredPriceTrend: null,
  };
}

function vendorTrendFromHistories(
  histories: ReadonlyArray<{
    vendorId: string;
    priceCents: number;
    createdAt: Date;
    effectiveAt: Date | null;
  }>,
  vendorId: string,
): ManagedItemIntel['cheapestPriceTrend'] {
  const slice = histories.filter((h) => h.vendorId === vendorId);
  if (slice.length === 0) return null;
  return classifyPriceTrendForVendorHistory(slice);
}

export async function resolveManagedItemIntel(
  prisma: PrismaClient,
  args: {
    tenantId: string;
    queryNormalized: string;
    primaryVendorCatalogItemId: string | null;
  },
): Promise<ManagedItemIntel | null> {
  let shop = await prisma.shopMaterialItem.findUnique({
    where: {
      tenantId_nameNormalized: {
        tenantId: args.tenantId,
        nameNormalized: args.queryNormalized,
      },
    },
    select: {
      id: true,
      name: true,
      nameNormalized: true,
      kind: true,
      catalogUnit: true,
      customUnitLabel: true,
      internalCostCents: true,
      preferredVendorId: true,
      preferredVendor: { select: { name: true } },
    },
  });
  let matchVia: ManagedItemIntel['matchVia'] = 'shop_name';

  if (!shop) {
    const aliasHit = await prisma.shopMaterialItemAlias.findUnique({
      where: {
        tenantId_aliasNormalized: {
          tenantId: args.tenantId,
          aliasNormalized: args.queryNormalized,
        },
      },
      select: { shopMaterialItemId: true },
    });
    if (aliasHit) {
      shop = await prisma.shopMaterialItem.findFirst({
        where: { id: aliasHit.shopMaterialItemId, tenantId: args.tenantId },
        select: {
          id: true,
          name: true,
          nameNormalized: true,
          kind: true,
          catalogUnit: true,
          customUnitLabel: true,
          internalCostCents: true,
          preferredVendorId: true,
          preferredVendor: { select: { name: true } },
        },
      });
      matchVia = 'shop_alias';
    }
  }

  if (!shop && args.primaryVendorCatalogItemId) {
    const link = await prisma.vendorCatalogItem.findFirst({
      where: { id: args.primaryVendorCatalogItemId, tenantId: args.tenantId },
      select: { shopMaterialItemId: true },
    });
    if (link?.shopMaterialItemId) {
      shop = await prisma.shopMaterialItem.findFirst({
        where: { id: link.shopMaterialItemId, tenantId: args.tenantId },
        select: {
          id: true,
          name: true,
          nameNormalized: true,
          kind: true,
          catalogUnit: true,
          customUnitLabel: true,
          internalCostCents: true,
          preferredVendorId: true,
          preferredVendor: { select: { name: true } },
        },
      });
      matchVia = 'linked_catalog';
    }
  }

  if (!shop) return null;

  const catalogUnitLabel = formatCatalogUnitDisplay(
    shop.catalogUnit,
    shop.customUnitLabel,
  );

  if (shop.kind !== EstimateLineKind.MATERIAL) {
    return {
      id: shop.id,
      displayName: shop.name,
      nameNormalized: shop.nameNormalized,
      catalogUnit: catalogUnitLabel,
      detailHref: `/items/${shop.id}`,
      matchVia,
      cheapestVendorName: null,
      cheapestPriceCents: null,
      preferredVendorName: shop.preferredVendor?.name ?? null,
      preferredLatestPriceCents: null,
      suggestedUnitCostCents:
        shop.internalCostCents > 0 ? shop.internalCostCents : null,
      unitConversionHint: null,
      ...emptyManagedExtensions(shop),
    };
  }

  const links = await prisma.vendorCatalogItem.findMany({
    where: { tenantId: args.tenantId, shopMaterialItemId: shop.id },
    select: { id: true },
  });
  const catalogIds = links.map((l) => l.id);
  if (catalogIds.length === 0) {
    return {
      id: shop.id,
      displayName: shop.name,
      nameNormalized: shop.nameNormalized,
      catalogUnit: catalogUnitLabel,
      detailHref: `/items/${shop.id}`,
      matchVia,
      cheapestVendorName: null,
      cheapestPriceCents: null,
      preferredVendorName: shop.preferredVendor?.name ?? null,
      preferredLatestPriceCents: null,
      suggestedUnitCostCents: null,
      unitConversionHint: null,
      ...emptyManagedExtensions(shop),
    };
  }

  const histories = await prisma.vendorPriceHistory.findMany({
    where: { tenantId: args.tenantId, vendorCatalogItemId: { in: catalogIds } },
    orderBy: { createdAt: 'desc' },
    take: 1500,
    select: {
      vendorId: true,
      vendorCatalogItemId: true,
      priceCents: true,
      unit: true,
      createdAt: true,
      effectiveAt: true,
      extractionMethod: true,
      confidence: true,
      vendor: { select: { name: true } },
    },
  });

  const obs: PriceObservationRow[] = histories.map((h) => ({
    vendorId: h.vendorId,
    vendorName: h.vendor.name,
    vendorCatalogItemId: h.vendorCatalogItemId,
    priceCents: h.priceCents,
    createdAt: h.createdAt,
    effectiveAt: h.effectiveAt,
    extractionMethod: h.extractionMethod,
    confidence: h.confidence,
  }));

  const latestByVendor = latestObservationPerVendor(obs);
  const cheapest = cheapestAmongLatest(latestByVendor, {
    preferredVendorId: shop.preferredVendorId,
  });
  const pref =
    shop.preferredVendorId != null ? latestByVendor.get(shop.preferredVendorId) : undefined;

  const suggested = suggestedUnitCostCents({
    preferredVendorId: shop.preferredVendorId,
    latestByVendor,
  });

  let preferredPremiumVsCheapestCents: number | null = null;
  if (pref && cheapest && pref.priceCents > cheapest.priceCents) {
    preferredPremiumVsCheapestCents = pref.priceCents - cheapest.priceCents;
  }

  const vendorLatestRows: ManagedVendorLatestRow[] = [...latestByVendor.values()]
    .sort((a, b) => a.vendorName.localeCompare(b.vendorName) || a.vendorId.localeCompare(b.vendorId))
    .map((r) => {
      const when = r.effectiveAt ?? r.createdAt;
      return {
        vendorId: r.vendorId,
        vendorName: r.vendorName,
        priceCents: r.priceCents,
        updatedAtIso: when.toISOString(),
        sourceLabel: labelVendorPriceSourceProduct(r.extractionMethod),
        confidenceLabel: labelVendorPriceConfidenceProduct(r.confidence ?? null),
      };
    });

  const cheapestPriceTrend = cheapest
    ? vendorTrendFromHistories(histories, cheapest.vendorId)
    : null;
  const preferredPriceTrend =
    shop.preferredVendorId != null
      ? vendorTrendFromHistories(histories, shop.preferredVendorId)
      : null;

  const cheapestHist = cheapest
    ? histories.find((h) => h.vendorId === cheapest.vendorId)
    : null;
  const unitConversionHint =
    cheapestHist && cheapest
      ? proposeUnitConversion({
          vendorUnit: parseVendorUnitToken(cheapestHist.unit),
          estimateCatalogUnit: shop.catalogUnit,
          priceCents: cheapest.priceCents,
          materialLabelNormalized: shop.nameNormalized,
        })
      : null;

  return {
    id: shop.id,
    displayName: shop.name,
    nameNormalized: shop.nameNormalized,
    catalogUnit: catalogUnitLabel,
    detailHref: `/items/${shop.id}`,
    matchVia,
    preferredVendorId: shop.preferredVendorId,
    cheapestVendorId: cheapest?.vendorId ?? null,
    cheapestVendorName: cheapest?.vendorName ?? null,
    cheapestPriceCents: cheapest?.priceCents ?? null,
    preferredVendorName: shop.preferredVendor?.name ?? null,
    preferredLatestPriceCents: pref?.priceCents ?? null,
    preferredPremiumVsCheapestCents,
    suggestedUnitCostCents: suggested,
    vendorLatestRows,
    cheapestPriceTrend,
    preferredPriceTrend,
    unitConversionHint,
  };
}
