import type { PrismaClient } from '@bvisible/db';
import { VendorPriceExtractionMethod } from '@bvisible/db';
import {
  canonicalMaterialKey,
  normalizeVendorItemName,
  normalizeVendorSku,
  stripTrailingUnitSuffix,
} from './normalize';
import { buildMaterialMatchIntel } from './material-match';
import { classifyPriceTrend, meanCents } from './trends';
import type {
  CatalogLookupMatchKind,
  VendorCatalogLookupResult,
} from './catalog-intel-types';
import { resolveManagedItemIntel } from '@/lib/shop-material/managed-intel';
import {
  cheapestAmongLatest,
  latestObservationPerVendor,
  observationInstant,
  type PriceObservationRow,
} from '@/lib/shop-material/pricing-aggregate';

export type {
  VendorCatalogLookupResult,
  CatalogLookupMatchKind,
  ManagedItemIntel,
} from './catalog-intel-types';
export const MAX_PREFIX_NAME_ROWS = 15;
export const MAX_PREFIX_ALIAS_ROWS = 12;
export const MAX_MERGED_CATALOG_IDS = 20;
export const WINDOW_DAYS = 90;
export const WINDOW_PRICE_ROWS_CAP = 400;
export const MAIN_HISTORY_ROW_CAP = 500;
export const MIN_NORMALIZED_QUERY_LEN = 2;

export type CatalogLookupInput = {
  tenantId: string;
  /** Already normalized via `normalizeVendorItemName` */
  normalizedQuery: string;
  machineId?: string | null;
  /** Optional extra normalized token (e.g. repeated normalize pass); combined if primary misses */
  dimensionsNormalized?: string | null;
};

type CatalogRow = { id: string; nameNormalized: string };

/** Pure merge for tests — deterministic priority ladder, no fuzzy scoring */
export function mergeOrderedCatalogItemIds(args: {
  queryNormalized: string;
  shopItemHit: boolean;
  shopAliasHit: boolean;
  exactNames: ReadonlyArray<CatalogRow>;
  prefixNames: ReadonlyArray<CatalogRow>;
  exactAliasCatalogIds: ReadonlyArray<string>;
  prefixAliasCatalogIds: ReadonlyArray<string>;
  skuCatalogRows: ReadonlyArray<CatalogRow>;
  shopNameExactCatalogRows: ReadonlyArray<CatalogRow>;
  shopAliasExactCatalogRows: ReadonlyArray<CatalogRow>;
  maxItems: number;
}): { orderedIds: string[]; matchKind: CatalogLookupMatchKind } {
  const seen = new Set<string>();
  const orderedIds: string[] = [];

  function push(id: string) {
    if (seen.has(id)) return;
    seen.add(id);
    orderedIds.push(id);
  }

  if (args.shopItemHit) {
    return { orderedIds: [], matchKind: 'shop_item_name' };
  }

  if (args.shopAliasHit) {
    return { orderedIds: [], matchKind: 'shop_item_alias' };
  }

  if (args.exactAliasCatalogIds.length > 0) {
    const sorted = [...args.exactAliasCatalogIds].sort((a, b) => a.localeCompare(b));
    for (const id of sorted) {
      if (orderedIds.length >= args.maxItems) break;
      push(id);
    }
    return { orderedIds, matchKind: 'exact_alias' };
  }

  if (args.exactNames.length > 0) {
    const sorted = [...args.exactNames].sort((a, b) =>
      a.nameNormalized.localeCompare(b.nameNormalized),
    );
    for (const r of sorted) {
      if (orderedIds.length >= args.maxItems) break;
      push(r.id);
    }
    return { orderedIds, matchKind: 'exact_name' };
  }

  if (args.skuCatalogRows.length > 0) {
    const sorted = [...args.skuCatalogRows].sort((a, b) =>
      a.nameNormalized.localeCompare(b.nameNormalized) || a.id.localeCompare(b.id),
    );
    for (const r of sorted) {
      if (orderedIds.length >= args.maxItems) break;
      push(r.id);
    }
    return { orderedIds, matchKind: 'vendor_sku' };
  }

  if (args.shopNameExactCatalogRows.length > 0) {
    const sorted = [...args.shopNameExactCatalogRows].sort((a, b) =>
      a.nameNormalized.localeCompare(b.nameNormalized) || a.id.localeCompare(b.id),
    );
    for (const r of sorted) {
      if (orderedIds.length >= args.maxItems) break;
      push(r.id);
    }
    return { orderedIds, matchKind: 'shop_item_name' };
  }

  if (args.shopAliasExactCatalogRows.length > 0) {
    const sorted = [...args.shopAliasExactCatalogRows].sort((a, b) =>
      a.nameNormalized.localeCompare(b.nameNormalized) || a.id.localeCompare(b.id),
    );
    for (const r of sorted) {
      if (orderedIds.length >= args.maxItems) break;
      push(r.id);
    }
    return { orderedIds, matchKind: 'shop_item_alias' };
  }

  const aliasesSorted = [...args.prefixAliasCatalogIds].sort((a, b) =>
    a.localeCompare(b),
  );
  for (const id of aliasesSorted) {
    if (orderedIds.length >= args.maxItems) break;
    push(id);
  }
  if (orderedIds.length > 0) {
    return { orderedIds, matchKind: 'prefix_alias' };
  }

  const namesSorted = [...args.prefixNames].sort((a, b) =>
    a.nameNormalized.localeCompare(b.nameNormalized),
  );
  for (const r of namesSorted) {
    if (orderedIds.length >= args.maxItems) break;
    push(r.id);
  }

  return {
    orderedIds,
    matchKind: orderedIds.length > 0 ? 'prefix_name' : 'none',
  };
}

function emptyResult(
  matchKind: CatalogLookupMatchKind,
  normalizedLabel: string,
  canonicalKey: string,
): VendorCatalogLookupResult {
  return {
    matchKind,
    materialMatch: buildMaterialMatchIntel({
      matchKind,
      normalizedLabel,
      canonicalKey,
    }),
    matchedCatalogItemIds: [],
    primaryCatalogItemId: null,
    primaryCatalogNameNormalized: null,
    latestPriceCents: null,
    latestObservationAt: null,
    previousPriceCents: null,
    cheapestVendorName: null,
    cheapestPriceCents: null,
    avg90PriceCents: null,
    observationCount90d: 0,
    vendorCount90d: 0,
    lastPoAt: null,
    lastPurchasedVendorName: null,
    lastOcrReceiptAt: null,
    trendKind: 'unknown',
    priceRecentlyIncreasedVsAvg: false,
    priceRecentlyIncreasedVsPrev: false,
    highVolatility: false,
    managedItem: null,
  };
}

async function resolvePrimaryCatalogItem(
  prisma: PrismaClient,
  tenantId: string,
  queryNormalized: string,
): Promise<{
  orderedIds: string[];
  matchKind: CatalogLookupMatchKind;
  primaryName: string | null;
}> {
  const shopByName = await prisma.shopMaterialItem.findUnique({
    where: {
      tenantId_nameNormalized: { tenantId, nameNormalized: queryNormalized },
    },
    select: { id: true, nameNormalized: true },
  });

  const shopAliasOnly = !shopByName
    ? await prisma.shopMaterialItemAlias.findUnique({
        where: {
          tenantId_aliasNormalized: { tenantId, aliasNormalized: queryNormalized },
        },
        select: { shopMaterialItemId: true },
      })
    : null;

  if (shopByName) {
    const linked = await prisma.vendorCatalogItem.findMany({
      where: { tenantId, shopMaterialItemId: shopByName.id },
      select: { id: true, nameNormalized: true },
      orderBy: { nameNormalized: 'asc' },
      take: MAX_MERGED_CATALOG_IDS,
    });
    return {
      orderedIds: linked.map((r) => r.id),
      matchKind: 'shop_item_name',
      primaryName: shopByName.nameNormalized,
    };
  }

  if (shopAliasOnly) {
    const shop = await prisma.shopMaterialItem.findFirst({
      where: { id: shopAliasOnly.shopMaterialItemId, tenantId },
      select: { id: true, nameNormalized: true },
    });
    if (shop) {
      const linked = await prisma.vendorCatalogItem.findMany({
        where: { tenantId, shopMaterialItemId: shop.id },
        select: { id: true, nameNormalized: true },
        orderBy: { nameNormalized: 'asc' },
        take: MAX_MERGED_CATALOG_IDS,
      });
      return {
        orderedIds: linked.map((r) => r.id),
        matchKind: 'shop_item_alias',
        primaryName: shop.nameNormalized,
      };
    }
  }

  const exactNames = await prisma.vendorCatalogItem.findMany({
    where: { tenantId, nameNormalized: queryNormalized },
    select: { id: true, nameNormalized: true },
    orderBy: { nameNormalized: 'asc' },
    take: MAX_MERGED_CATALOG_IDS,
  });

  const exactAliasRows = await prisma.vendorItemAlias.findMany({
    where: { tenantId, aliasNormalized: queryNormalized },
    select: { vendorCatalogItemId: true },
    take: MAX_MERGED_CATALOG_IDS,
  });

  const prefixNames = await prisma.vendorCatalogItem.findMany({
    where: {
      tenantId,
      nameNormalized: { startsWith: queryNormalized },
    },
    select: { id: true, nameNormalized: true },
    orderBy: { nameNormalized: 'asc' },
    take: MAX_PREFIX_NAME_ROWS,
  });

  const prefixAliases = await prisma.vendorItemAlias.findMany({
    where: {
      tenantId,
      aliasNormalized: { startsWith: queryNormalized },
    },
    select: { vendorCatalogItemId: true },
    orderBy: { aliasNormalized: 'asc' },
    take: MAX_PREFIX_ALIAS_ROWS,
  });

  const skuNorm = normalizeVendorSku(queryNormalized);
  const skuCatalogRows =
    skuNorm.length >= 3
      ? await prisma.vendorCatalogItem.findMany({
          where: { tenantId, vendorSku: skuNorm },
          select: { id: true, nameNormalized: true },
          orderBy: { nameNormalized: 'asc' },
          take: MAX_MERGED_CATALOG_IDS,
        })
      : [];

  const merged = mergeOrderedCatalogItemIds({
    queryNormalized,
    shopItemHit: false,
    shopAliasHit: false,
    exactNames,
    prefixNames,
    exactAliasCatalogIds: exactAliasRows.map((r) => r.vendorCatalogItemId),
    prefixAliasCatalogIds: prefixAliases.map((r) => r.vendorCatalogItemId),
    skuCatalogRows,
    shopNameExactCatalogRows: [],
    shopAliasExactCatalogRows: [],
    maxItems: MAX_MERGED_CATALOG_IDS,
  });

  let primaryName: string | null = null;
  if (merged.orderedIds.length > 0) {
    const firstId = merged.orderedIds[0]!;
    const row = await prisma.vendorCatalogItem.findFirst({
      where: { tenantId, id: firstId },
      select: { nameNormalized: true },
    });
    primaryName = row?.nameNormalized ?? null;
  }

  return {
    orderedIds: merged.orderedIds,
    matchKind: merged.matchKind,
    primaryName,
  };
}

/**
 * OCR_APPROVED observations only (operator-confirmed receipt path).
 * Indexed lookups + capped reads — suitable for debounced editor calls.
 */
export async function lookupVendorCatalogIntelligence(
  prisma: PrismaClient,
  input: CatalogLookupInput,
): Promise<VendorCatalogLookupResult> {
  void input.machineId;

  const rawQuery = input.normalizedQuery.trim();
  const query =
    rawQuery.length > 0
      ? stripTrailingUnitSuffix(normalizeVendorItemName(rawQuery))
      : '';
  const canonicalKey = canonicalMaterialKey(rawQuery);

  if (query.length < MIN_NORMALIZED_QUERY_LEN) {
    return emptyResult('none', query, canonicalKey);
  }

  let resolved = await resolvePrimaryCatalogItem(
    prisma,
    input.tenantId,
    query,
  );

  if (
    resolved.orderedIds.length === 0 &&
    input.dimensionsNormalized &&
    input.dimensionsNormalized.trim().length > 0
  ) {
    const combo = normalizeVendorItemName(
      `${query} ${input.dimensionsNormalized.trim()}`,
    );
    if (combo.length >= MIN_NORMALIZED_QUERY_LEN && combo !== query) {
      resolved = await resolvePrimaryCatalogItem(prisma, input.tenantId, combo);
    }
  }

  const primaryCatalogItemId = resolved.orderedIds[0] ?? null;

  const managedItem = await resolveManagedItemIntel(prisma, {
    tenantId: input.tenantId,
    queryNormalized: query,
    primaryVendorCatalogItemId: primaryCatalogItemId,
  });

  const materialMatch = buildMaterialMatchIntel({
    matchKind: resolved.matchKind,
    normalizedLabel: query,
    canonicalKey,
  });

  if (resolved.orderedIds.length === 0) {
    if (!managedItem) {
      return emptyResult('none', query, canonicalKey);
    }
    return {
      ...emptyResult(resolved.matchKind, query, canonicalKey),
      matchKind: resolved.matchKind,
      materialMatch,
      matchedCatalogItemIds: [],
      primaryCatalogItemId: null,
      primaryCatalogNameNormalized: managedItem.nameNormalized,
      managedItem,
    };
  }

  if (!primaryCatalogItemId) {
    return emptyResult('none', query, canonicalKey);
  }

  const histDesc = await prisma.vendorPriceHistory.findMany({
    where: {
      tenantId: input.tenantId,
      vendorCatalogItemId: primaryCatalogItemId,
      extractionMethod: VendorPriceExtractionMethod.OCR_APPROVED,
    },
    orderBy: { createdAt: 'desc' },
    take: MAIN_HISTORY_ROW_CAP,
    select: {
      priceCents: true,
      createdAt: true,
      effectiveAt: true,
      vendorId: true,
      sourcePoAttachmentId: true,
      vendor: { select: { name: true } },
    },
  });

  const latestGlobal = histDesc[0] ?? null;
  const previousGlobal = histDesc[1] ?? null;

  const sinceMs = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const windowRows = histDesc
    .filter(
      (r) =>
        observationInstant({ effectiveAt: r.effectiveAt, createdAt: r.createdAt }) >= sinceMs,
    )
    .slice(0, WINDOW_PRICE_ROWS_CAP);

  const windowPrices = windowRows.map((r) => r.priceCents);
  const avg90 = meanCents(windowPrices);

  const obsRows: PriceObservationRow[] = histDesc.map((r) => ({
    vendorId: r.vendorId,
    vendorName: r.vendor.name,
    vendorCatalogItemId: primaryCatalogItemId,
    priceCents: r.priceCents,
    createdAt: r.createdAt,
    effectiveAt: r.effectiveAt,
    extractionMethod: VendorPriceExtractionMethod.OCR_APPROVED,
  }));
  const latestByVendorOcr = latestObservationPerVendor(obsRows);
  const cheapestRow = cheapestAmongLatest(latestByVendorOcr, {
    preferredVendorId: managedItem?.preferredVendorId ?? null,
  });

  const lastPoRow =
    histDesc.find((r) => r.sourcePoAttachmentId !== null) ?? null;

  const vendorCount90d = new Set(windowRows.map((r) => r.vendorId)).size;

  const trendRecalc = classifyPriceTrend({
    latestCents: latestGlobal?.priceCents ?? null,
    previousCents: previousGlobal?.priceCents ?? null,
    avg90Cents: avg90,
    windowPrices90dCents: windowPrices,
  });

  return {
    matchKind: resolved.matchKind,
    materialMatch,
    matchedCatalogItemIds: resolved.orderedIds,
    primaryCatalogItemId,
    primaryCatalogNameNormalized: resolved.primaryName,
    latestPriceCents: latestGlobal?.priceCents ?? null,
    latestObservationAt:
      latestGlobal != null
        ? (latestGlobal.effectiveAt ?? latestGlobal.createdAt).toISOString()
        : null,
    previousPriceCents: previousGlobal?.priceCents ?? null,
    cheapestVendorName: cheapestRow?.vendorName ?? null,
    cheapestPriceCents: cheapestRow?.priceCents ?? null,
    avg90PriceCents: avg90,
    observationCount90d: windowRows.length,
    vendorCount90d,
    lastPoAt: lastPoRow?.createdAt.toISOString() ?? null,
    lastPurchasedVendorName: lastPoRow?.vendor.name ?? null,
    lastOcrReceiptAt: latestGlobal?.createdAt.toISOString() ?? null,
    trendKind: trendRecalc.trendKind,
    priceRecentlyIncreasedVsAvg: trendRecalc.priceRecentlyIncreasedVsAvg,
    priceRecentlyIncreasedVsPrev: trendRecalc.priceRecentlyIncreasedVsPrev,
    highVolatility: trendRecalc.highVolatility,
    managedItem,
  };
}
