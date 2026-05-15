import type { PrismaClient } from '@bvisible/db';
import { VendorPriceExtractionMethod } from '@bvisible/db';
import { normalizeVendorItemName } from './normalize';
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

/** Pure merge for tests — deterministic ordering, no fuzzy scoring */
export function mergeOrderedCatalogItemIds(args: {
  queryNormalized: string;
  exactNames: ReadonlyArray<CatalogRow>;
  prefixNames: ReadonlyArray<CatalogRow>;
  exactAliasCatalogIds: ReadonlyArray<string>;
  prefixAliasCatalogIds: ReadonlyArray<string>;
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

  if (args.exactAliasCatalogIds.length > 0) {
    const sorted = [...args.exactAliasCatalogIds].sort((a, b) =>
      a.localeCompare(b),
    );
    for (const id of sorted) {
      if (orderedIds.length >= args.maxItems) break;
      push(id);
    }
    return { orderedIds, matchKind: 'exact_alias' };
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

  const namesSorted = [...args.prefixNames].sort((a, b) =>
    a.nameNormalized.localeCompare(b.nameNormalized),
  );
  for (const r of namesSorted) {
    if (orderedIds.length >= args.maxItems) break;
    push(r.id);
  }

  const aliasesSorted = [...args.prefixAliasCatalogIds].sort((a, b) =>
    a.localeCompare(b),
  );
  for (const id of aliasesSorted) {
    if (orderedIds.length >= args.maxItems) break;
    push(id);
  }

  const matchKind: CatalogLookupMatchKind =
    orderedIds.length > 0 ? 'prefix' : 'none';
  return { orderedIds, matchKind };
}

function emptyResult(matchKind: CatalogLookupMatchKind): VendorCatalogLookupResult {
  return {
    matchKind,
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

  const shopByName = await prisma.shopMaterialItem.findUnique({
    where: {
      tenantId_nameNormalized: { tenantId, nameNormalized: queryNormalized },
    },
    select: { id: true, nameNormalized: true },
  });

  let shopNameExactCatalogRows: CatalogRow[] = [];
  if (shopByName) {
    shopNameExactCatalogRows = await prisma.vendorCatalogItem.findMany({
      where: { tenantId, shopMaterialItemId: shopByName.id },
      select: { id: true, nameNormalized: true },
      orderBy: { nameNormalized: 'asc' },
      take: MAX_MERGED_CATALOG_IDS,
    });
  }

  let shopAliasExactCatalogRows: CatalogRow[] = [];
  let shopAliasParentNormalized: string | null = null;
  if (shopNameExactCatalogRows.length === 0) {
    const aliasHit = await prisma.shopMaterialItemAlias.findUnique({
      where: {
        tenantId_aliasNormalized: { tenantId, aliasNormalized: queryNormalized },
      },
      select: { shopMaterialItemId: true },
    });
    if (aliasHit) {
      shopAliasExactCatalogRows = await prisma.vendorCatalogItem.findMany({
        where: { tenantId, shopMaterialItemId: aliasHit.shopMaterialItemId },
        select: { id: true, nameNormalized: true },
        orderBy: { nameNormalized: 'asc' },
        take: MAX_MERGED_CATALOG_IDS,
      });
      const parent = await prisma.shopMaterialItem.findFirst({
        where: { id: aliasHit.shopMaterialItemId, tenantId },
        select: { nameNormalized: true },
      });
      shopAliasParentNormalized = parent?.nameNormalized ?? null;
    }
  }

  const merged = mergeOrderedCatalogItemIds({
    queryNormalized,
    exactNames,
    prefixNames,
    exactAliasCatalogIds: exactAliasRows.map((r) => r.vendorCatalogItemId),
    prefixAliasCatalogIds: prefixAliases.map((r) => r.vendorCatalogItemId),
    shopNameExactCatalogRows,
    shopAliasExactCatalogRows,
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
  } else if (shopByName) {
    primaryName = shopByName.nameNormalized;
    return {
      orderedIds: [],
      matchKind: 'shop_item_name',
      primaryName,
    };
  } else if (shopAliasParentNormalized) {
    primaryName = shopAliasParentNormalized;
    return {
      orderedIds: [],
      matchKind: 'shop_item_alias',
      primaryName,
    };
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
    rawQuery.length > 0 ? normalizeVendorItemName(rawQuery) : '';

  if (query.length < MIN_NORMALIZED_QUERY_LEN) {
    return emptyResult('none');
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

  if (resolved.orderedIds.length === 0) {
    if (!managedItem) {
      return emptyResult('none');
    }
    return {
      ...emptyResult(resolved.matchKind),
      matchKind: resolved.matchKind,
      matchedCatalogItemIds: [],
      primaryCatalogItemId: null,
      primaryCatalogNameNormalized: managedItem.nameNormalized,
      managedItem,
    };
  }

  if (!primaryCatalogItemId) {
    return emptyResult('none');
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
