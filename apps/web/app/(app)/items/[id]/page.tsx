import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma, Role, VendorPriceExtractionMethod, EstimateLineKind, ShopMaterialItemType } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { formatMoney, formatQty, kindLabel } from '@/lib/estimate/format';
import { sellPriceFromCostAndMarkup } from '@/lib/shop-material/markup';
import { formatCatalogUnitDisplay } from '@/lib/shop-material/catalog-unit-display';
import {
  cheapestAmongLatest,
  latestObservationPerVendor,
  type PriceObservationRow,
} from '@/lib/shop-material/pricing-aggregate';
import { classifyPriceTrendForVendorHistory } from '@/lib/vendor-pricing/trends';
import {
  labelVendorPriceConfidenceProduct,
  labelVendorPriceSourceProduct,
} from '@/lib/vendor-pricing/vendor-price-source-label';
import { CatalogItemEditor } from '../catalog-item-editor';
import type { CatalogVendorDisplayRow } from '../catalog-item-pricing-tools';
import { BundleForm } from '../bundles/bundle-form';
import { bundleInitialFromItem, loadBundleSources } from '../bundles/bundle-data';

export const dynamic = 'force-dynamic';

function categoryLabel(category: string): string {
  return Object.values(EstimateLineKind).includes(category as EstimateLineKind)
    ? kindLabel(category as EstimateLineKind)
    : category;
}

function pricingMethodLabel(method: string): string {
  switch (method) {
    case 'SQUARE_FOOTAGE':
      return 'Square Footage';
    case 'SHEET_GOODS':
      return 'Sheet Goods';
    case 'ROLL_MATERIAL':
      return 'Roll Material';
    case 'BANNER':
      return 'Banner';
    case 'CUSTOM':
      return 'Custom';
    default:
      return method.replace(/_/g, ' ');
  }
}

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireTenantId();
  const { id } = await params;
  const canManage = me.role === Role.ADMIN || me.role === Role.SUPER_ADMIN;

  const item = await prisma.shopMaterialItem.findFirst({
    where: { id, tenantId: me.tenantId },
    select: {
      id: true,
      name: true,
      nameNormalized: true,
      itemCode: true,
      itemType: true,
      kind: true,
      categories: true,
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
      calculatedCostCents: true,
      calculatedSellCents: true,
      pricingNotes: true,
      machineId: true,
      customerDescription: true,
      notes: true,
      isActive: true,
      preferredVendorId: true,
      selectedVendorId: true,
      selectedVendorMode: true,
      preferredVendor: { select: { id: true, name: true } },
      createdAt: true,
      updatedAt: true,
      aliases: {
        orderBy: { aliasNormalized: 'asc' },
        select: { id: true, aliasNormalized: true },
      },
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
          preferredVendorId: true,
          cheapestVendorId: true,
          selectedVendorId: true,
          vendorSnapshotJson: true,
          pricingMethod: true,
          pricingInputsJson: true,
          notes: true,
        },
      },
      vendorCatalogLinks: {
        select: {
          id: true,
          vendorId: true,
          vendorSku: true,
          leadTimeDays: true,
          notes: true,
          vendor: { select: { name: true } },
          priceHistory: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              priceCents: true,
              unit: true,
              createdAt: true,
              effectiveAt: true,
              extractionMethod: true,
              confidence: true,
            },
          },
        },
      },
    },
  });

  if (!item) notFound();

  if (item.itemType === ShopMaterialItemType.BUNDLE) {
    const [sources, savedCategories] = await Promise.all([
      loadBundleSources(me.tenantId),
      prisma.shopItemCategory.findMany({
        where: { tenantId: me.tenantId },
        orderBy: [{ name: 'asc' }],
        select: { name: true },
        take: 200,
      }),
    ]);
    const sellTotal = item.defaultSellPriceCents ?? item.calculatedSellCents ?? 0;
    const marginPct = sellTotal > 0
      ? ((sellTotal - item.internalCostCents) / sellTotal) * 100
      : null;

    return (
      <>
        <PageHeader
          title={item.name}
          subtitle={`Bundle · ${item.categories.length > 0 ? item.categories.map(categoryLabel).join(', ') : kindLabel(item.kind)} · normalized key: ${item.nameNormalized}`}
          actions={
            <Link
              href="/items"
              className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
            >
              All items
            </Link>
          }
        />

        <div className="mb-6 grid gap-4 md:grid-cols-4">
          <BundleMetric label="Internal cost" value={formatMoney(item.internalCostCents)} />
          <BundleMetric label="Bundle sell" value={formatMoney(sellTotal)} />
          <BundleMetric label="Margin" value={marginPct == null ? '—' : `${marginPct.toFixed(1)}%`} />
          <BundleMetric label="Components" value={item.bundleComponents.length.toString()} />
        </div>

        <section className="mb-6 rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
                Internal component breakdown
              </h2>
              <p className="mt-1 text-[12.5px] text-[var(--color-bv-muted)]">
                Customer previews use only the bundle name/description and total sell. Component rows stay internal.
              </p>
            </div>
            <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-700">
              Bundle
            </span>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[900px] text-[12.5px]">
              <thead>
                <tr className="border-b border-[var(--color-bv-border)] text-left text-[10.5px] uppercase tracking-[0.14em] text-[var(--color-bv-muted)]">
                  <th className="py-2 pr-3">Component</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Qty</th>
                  <th className="py-2 pr-3">Unit cost</th>
                  <th className="py-2 pr-3">Total cost</th>
                  <th className="py-2 pr-3">Total sell</th>
                  <th className="py-2 pr-3">Vendors</th>
                </tr>
              </thead>
              <tbody>
                {item.bundleComponents.map((component) => {
                  const vendorRows = Array.isArray(component.vendorSnapshotJson)
                    ? component.vendorSnapshotJson as Array<{ vendorName?: string; latestPriceCents?: number | null; isPreferred?: boolean; isCheapest?: boolean }>
                    : [];
                  return (
                    <tr key={`${component.componentName}-${component.quantityMilli}`} className="border-b border-[var(--color-bv-border)]/70 last:border-0">
                      <td className="py-3 pr-3 font-semibold text-[var(--color-bv-text)]">{component.componentName}</td>
                      <td className="py-3 pr-3">{kindLabel(component.componentType)}</td>
                      <td className="py-3 pr-3 tabular-nums">{formatQty(component.quantityMilli)}</td>
                      <td className="py-3 pr-3 tabular-nums">{formatMoney(component.internalUnitCostCents)}</td>
                      <td className="py-3 pr-3 tabular-nums">{formatMoney(component.totalCostCents)}</td>
                      <td className="py-3 pr-3 tabular-nums font-semibold">{formatMoney(component.totalSellCents)}</td>
                      <td className="py-3 pr-3 text-[11.5px] text-[var(--color-bv-muted)]">
                        {vendorRows.length === 0
                          ? '—'
                          : vendorRows.map((vendor) => `${vendor.vendorName ?? 'Vendor'}${vendor.latestPriceCents != null ? ` ${formatMoney(vendor.latestPriceCents)}` : ''}${vendor.isPreferred ? ' preferred' : vendor.isCheapest ? ' cheapest' : ''}`).join(' · ')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {canManage ? (
          <BundleForm
            mode="edit"
            sources={sources}
            savedCategories={savedCategories.map((category) => category.name)}
            initial={bundleInitialFromItem(item)}
          />
        ) : null}
      </>
    );
  }

  const catalogIds = item.vendorCatalogLinks.map((l) => l.id);

  const history =
    catalogIds.length === 0
      ? []
      : await prisma.vendorPriceHistory.findMany({
          where: { tenantId: me.tenantId, vendorCatalogItemId: { in: catalogIds } },
          orderBy: { createdAt: 'desc' },
          take: 120,
          select: {
            id: true,
            priceCents: true,
            unit: true,
            createdAt: true,
            effectiveAt: true,
            extractionMethod: true,
            confidence: true,
            itemNameRaw: true,
            vendor: { select: { name: true } },
          },
        });

  const recentOcrish =
    catalogIds.length === 0
      ? []
      : await prisma.vendorPriceHistory.findMany({
          where: {
            tenantId: me.tenantId,
            vendorCatalogItemId: { in: catalogIds },
            extractionMethod: {
              in: [
                VendorPriceExtractionMethod.OCR_APPROVED,
                VendorPriceExtractionMethod.OCR_TEXT_REGEX,
              ],
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 15,
          select: {
            id: true,
            priceCents: true,
            createdAt: true,
            extractionMethod: true,
            vendor: { select: { name: true } },
          },
        });

  let intelLatestByVendor = new Map<string, PriceObservationRow>();
  let intelCheapest: PriceObservationRow | null = null;
  let intelHistoriesForTrend: ReadonlyArray<{
    vendorId: string;
    priceCents: number;
    createdAt: Date;
    effectiveAt: Date | null;
  }> = [];

  if (item.kind === EstimateLineKind.MATERIAL && catalogIds.length > 0) {
    const intelRows = await prisma.vendorPriceHistory.findMany({
      where: { tenantId: me.tenantId, vendorCatalogItemId: { in: catalogIds } },
      orderBy: { createdAt: 'desc' },
      take: 1500,
      select: {
        vendorId: true,
        vendorCatalogItemId: true,
        priceCents: true,
        createdAt: true,
        effectiveAt: true,
        extractionMethod: true,
        confidence: true,
        vendor: { select: { name: true } },
      },
    });
    intelHistoriesForTrend = intelRows;
    const obs: PriceObservationRow[] = intelRows.map((h) => ({
      vendorId: h.vendorId,
      vendorName: h.vendor.name,
      vendorCatalogItemId: h.vendorCatalogItemId,
      priceCents: h.priceCents,
      createdAt: h.createdAt,
      effectiveAt: h.effectiveAt,
      extractionMethod: h.extractionMethod,
      confidence: h.confidence,
    }));
    intelLatestByVendor = latestObservationPerVendor(obs);
    intelCheapest = cheapestAmongLatest(intelLatestByVendor, {
      preferredVendorId: item.preferredVendorId,
    });
  }

  const strayCatalogRows =
    item.kind === EstimateLineKind.MATERIAL
      ? await prisma.vendorCatalogItem.findMany({
          where: {
            tenantId: me.tenantId,
            nameNormalized: item.nameNormalized,
            OR: [{ shopMaterialItemId: null }, { shopMaterialItemId: { not: item.id } }],
          },
          select: {
            id: true,
            shopMaterialItemId: true,
            vendor: { select: { name: true } },
          },
          take: 12,
        })
      : [];

  const [vendors, machines, savedCategories] = await Promise.all([
    prisma.vendor.findMany({
      where: { tenantId: me.tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
      take: 400,
    }),
    prisma.machine.findMany({
      where: { tenantId: me.tenantId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, ratePerHourCents: true },
      take: 200,
    }),
    prisma.shopItemCategory.findMany({
      where: { tenantId: me.tenantId },
      orderBy: { name: 'asc' },
      select: { name: true },
      take: 200,
    }),
  ]);

  const prefLatestObservation =
    item.kind === EstimateLineKind.MATERIAL && item.preferredVendorId != null
      ? intelLatestByVendor.get(item.preferredVendorId)
      : undefined;

  const cheapestDisplay =
    intelCheapest != null
      ? {
          vendorId: intelCheapest.vendorId,
          vendor: intelCheapest.vendorName,
          cents: intelCheapest.priceCents,
        }
      : null;

  const vendorAggregatedRows =
    item.kind === EstimateLineKind.MATERIAL
      ? [...intelLatestByVendor.values()].sort(
          (a, b) => a.vendorName.localeCompare(b.vendorName) || a.vendorId.localeCompare(b.vendorId),
        )
      : [];
  const vendorPriceRows: CatalogVendorDisplayRow[] = item.kind === EstimateLineKind.MATERIAL
    ? vendorAggregatedRows.map((row) => {
        const trend = classifyPriceTrendForVendorHistory(
          intelHistoriesForTrend.filter((h) => h.vendorId === row.vendorId),
        );
        const skuLabels = item.vendorCatalogLinks
          .filter((l) => l.vendorId === row.vendorId)
          .map((l) => l.vendorSku)
          .filter((s): s is string => Boolean(s));
        let trendNote = '';
        if (trend.highVolatility) trendNote = 'Price has varied recently';
        else if (trend.priceRecentlyIncreasedVsAvg || trend.priceRecentlyIncreasedVsPrev) trendNote = 'Price increased recently';
        const when = row.effectiveAt ?? row.createdAt;
        return {
          id: row.vendorCatalogItemId,
          vendorId: row.vendorId,
          vendorName: row.vendorName,
          priceCents: row.priceCents,
          vendorSku: skuLabels[0] ?? null,
          unit: item.vendorCatalogLinks.find((l) => l.id === row.vendorCatalogItemId)?.priceHistory[0]?.unit ?? null,
          leadTimeDays: item.vendorCatalogLinks.find((l) => l.id === row.vendorCatalogItemId)?.leadTimeDays ?? null,
          notes: item.vendorCatalogLinks.find((l) => l.id === row.vendorCatalogItemId)?.notes ?? null,
          updatedAt: when.toISOString().slice(0, 10),
          isCheapest: intelCheapest?.vendorId === row.vendorId,
          isPreferred: item.preferredVendorId === row.vendorId,
        };
      })
    : [];

  const costBasisForSellHint =
    item.kind === EstimateLineKind.MATERIAL && prefLatestObservation
      ? prefLatestObservation.priceCents
      : item.kind === EstimateLineKind.MATERIAL && cheapestDisplay
        ? cheapestDisplay.cents
        : item.internalCostCents;
  const sellHint =
    item.defaultSellPriceCents ??
    sellPriceFromCostAndMarkup(costBasisForSellHint, item.markupPercentMilli);

  return canManage ? (
    <CatalogItemEditor
      mode="edit"
      item={item}
      machines={machines}
      savedCategories={savedCategories.map((c) => c.name)}
      vendors={vendors}
      vendorRows={vendorPriceRows}
    />
  ) : (
    <>
      <PageHeader
        title={item.name}
        subtitle={`${item.categories.length > 0 ? item.categories.map(categoryLabel).join(', ') : kindLabel(item.kind)} · read only`}
        actions={
          <Link
            href="/items"
            className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
          >
            All items
          </Link>
        }
      />
      <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
        <dl className="grid gap-3 text-[13px] sm:grid-cols-2">
          <div><dt className="text-[var(--color-bv-muted)]">Category</dt><dd>{item.categories.map(categoryLabel).join(', ') || kindLabel(item.kind)}</dd></div>
          <div><dt className="text-[var(--color-bv-muted)]">Unit</dt><dd>{formatCatalogUnitDisplay(item.catalogUnit, item.customUnitLabel)}</dd></div>
          <div><dt className="text-[var(--color-bv-muted)]">Internal cost</dt><dd>{formatMoney(item.internalCostCents)}</dd></div>
          <div><dt className="text-[var(--color-bv-muted)]">Sell hint</dt><dd>{formatMoney(sellHint)}</dd></div>
        </dl>
      </section>
    </>
  );
}

function BundleMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-white/80 bg-white/90 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className="mt-3 text-[24px] font-semibold tracking-[-0.04em] text-slate-950">{value}</div>
    </div>
  );
}
