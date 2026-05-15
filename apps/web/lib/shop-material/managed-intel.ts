import type { PrismaClient } from '@bvisible/db';
import type { ManagedItemIntel } from '@/lib/vendor-pricing/catalog-intel-types';
import {
  cheapestAmongLatest,
  latestObservationPerVendor,
  type PriceObservationRow,
  suggestedUnitCostCents,
} from '@/lib/shop-material/pricing-aggregate';

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
          preferredVendorId: true,
          preferredVendor: { select: { name: true } },
        },
      });
      matchVia = 'linked_catalog';
    }
  }

  if (!shop) return null;

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
      detailHref: `/items/${shop.id}`,
      matchVia,
      cheapestVendorName: null,
      cheapestPriceCents: null,
      preferredVendorName: shop.preferredVendor?.name ?? null,
      preferredLatestPriceCents: null,
      suggestedUnitCostCents: null,
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
      createdAt: true,
      effectiveAt: true,
      extractionMethod: true,
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
  }));

  const latestByVendor = latestObservationPerVendor(obs);
  const cheapest = cheapestAmongLatest(latestByVendor);
  const pref =
    shop.preferredVendorId != null ? latestByVendor.get(shop.preferredVendorId) : undefined;

  return {
    id: shop.id,
    displayName: shop.name,
    nameNormalized: shop.nameNormalized,
    detailHref: `/items/${shop.id}`,
    matchVia,
    cheapestVendorName: cheapest?.vendorName ?? null,
    cheapestPriceCents: cheapest?.priceCents ?? null,
    preferredVendorName: shop.preferredVendor?.name ?? null,
    preferredLatestPriceCents: pref?.priceCents ?? null,
    suggestedUnitCostCents: suggestedUnitCostCents({
      preferredVendorId: shop.preferredVendorId,
      latestByVendor,
    }),
  };
}
