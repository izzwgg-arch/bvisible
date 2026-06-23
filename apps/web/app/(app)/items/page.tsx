import Link from 'next/link';
import type { ReactNode } from 'react';
import { prisma, Role, EstimateLineKind, type VendorPriceExtractionMethod } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { ItemCsvButtons } from './csv-buttons';
import { PageHeader } from '@/components/app-shell';
import { AutoSubmitInput } from '@/components/app/auto-submit-controls';
import { EmptyState } from '@/components/app/empty-state';
import { BulkDeleteForm } from '@/components/app/bulk-delete-form';
import { DEFAULT_PAGE_SIZE, PaginationControls, pageSkip, parsePageParam } from '@/components/app/pagination-controls';
import { formatMoney, kindLabel } from '@/lib/estimate/format';
import { normalizeVendorItemName } from '@/lib/vendor-pricing/normalize';
import { labelVendorPriceExtractionMethod } from '@/lib/ui/status-labels';
import { sellPriceFromCostAndMarkup } from '@/lib/shop-material/markup';
import { CreateCatalogItemModal } from './create-catalog-item-modal';
import { bulkDeleteShopMaterialItemsAction } from './actions';

export const metadata = { title: 'Catalog' };
export const dynamic = 'force-dynamic';

function categoryLabel(category: string): string {
  return Object.values(EstimateLineKind).includes(category as EstimateLineKind)
    ? kindLabel(category as EstimateLineKind)
    : category;
}

type RowLink = {
  vendorId: string;
  vendor: { name: string };
  priceHistory: ReadonlyArray<{
    priceCents: number;
    createdAt: Date;
    effectiveAt: Date | null;
    extractionMethod: VendorPriceExtractionMethod;
  }>;
};

function summarizeLinks(links: ReadonlyArray<RowLink>): {
  latestPriceCents: number | null;
  latestAtLabel: string | null;
  latestSource: string | null;
  cheapestVendor: string | null;
  cheapestCents: number | null;
} {
  let latestMs = 0;
  let latestPriceCents: number | null = null;
  let latestAtLabel: string | null = null;
  let latestSource: string | null = null;

  let cheapestCents: number | null = null;
  let cheapestVendor: string | null = null;

  for (const link of links) {
    const h = link.priceHistory[0];
    if (h) {
      const obsMs = (h.effectiveAt ?? h.createdAt).getTime();
      if (obsMs >= latestMs) {
        latestMs = obsMs;
        latestPriceCents = h.priceCents;
        latestAtLabel = (h.effectiveAt ?? h.createdAt).toISOString().slice(0, 10);
        latestSource = labelVendorPriceExtractionMethod(h.extractionMethod);
      }
      if (cheapestCents === null || h.priceCents < cheapestCents) {
        cheapestCents = h.priceCents;
        cheapestVendor = link.vendor.name;
      }
    }
  }

  return {
    latestPriceCents,
    latestAtLabel,
    latestSource,
    cheapestVendor,
    cheapestCents,
  };
}

interface SearchParams {
  q?: string;
  filter?: string;
  page?: string | string[];
}

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireTenantId();
  const sp = await searchParams;
  const canManage = me.role === Role.ADMIN || me.role === Role.SUPER_ADMIN;

  const rawQ = sp.q?.trim() ?? '';
  const normQ = normalizeVendorItemName(rawQ);
  const filter = sp.filter ?? 'active';
  const page = parsePageParam(sp.page);
  const where = {
    tenantId: me.tenantId,
    ...(filter === 'active' ? { isActive: true } : {}),
    ...(filter === 'inactive' ? { isActive: false } : {}),
    ...(rawQ
      ? {
          OR: [
            { name: { contains: rawQ, mode: 'insensitive' as const } },
            { itemCode: { contains: rawQ, mode: 'insensitive' as const } },
            ...(normQ.length >= 2 ? [{ nameNormalized: { contains: normQ } }] : []),
          ],
        }
      : {}),
  };

  const [items, filteredTotal, activeCount, materialCount, vendorLinkedCount] = await Promise.all([
    prisma.shopMaterialItem.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      skip: pageSkip(page),
      take: DEFAULT_PAGE_SIZE,
      select: {
        id: true,
        name: true,
        nameNormalized: true,
        itemType: true,
        kind: true,
        categories: true,
        isActive: true,
        internalCostCents: true,
        markupPercentMilli: true,
        defaultSellPriceCents: true,
        updatedAt: true,
        preferredVendor: { select: { name: true } },
        _count: { select: { aliases: true, vendorCatalogLinks: true, bundleComponents: true } },
        vendorCatalogLinks: {
          select: {
            vendorId: true,
            vendor: { select: { name: true } },
            priceHistory: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                priceCents: true,
                createdAt: true,
                effectiveAt: true,
                extractionMethod: true,
              },
            },
          },
        },
      },
    }),
    prisma.shopMaterialItem.count({ where }),
    prisma.shopMaterialItem.count({ where: { tenantId: me.tenantId, isActive: true } }),
    prisma.shopMaterialItem.count({ where: { tenantId: me.tenantId, kind: EstimateLineKind.MATERIAL } }),
    prisma.shopMaterialItem.count({
      where: { tenantId: me.tenantId, vendorCatalogLinks: { some: {} } },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Catalog"
        subtitle="Modern pricing catalog for estimate building, internal rates, markup guidance, and vendor intelligence."
        actions={
          canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <ItemCsvButtons />
              <CreateCatalogItemModal />
            </div>
          ) : null
        }
      />

      <section className="mb-5 grid gap-3 sm:grid-cols-2 min-[1500px]:grid-cols-4">
        <CatalogMetric label="Visible items" value={activeCount.toString()} detail="Active in estimate picker" tone="blue" />
        <CatalogMetric label="Materials" value={materialCount.toString()} detail="Vendor-price aware lines" tone="emerald" />
        <CatalogMetric label="Vendor linked" value={vendorLinkedCount.toString()} detail="Have supplier intelligence" tone="slate" />
        <CatalogMetric label="Showing" value={filteredTotal.toString()} detail={`${filter} filter${rawQ ? ` · "${rawQ}"` : ''}`} tone="violet" />
      </section>

      <section className="mb-5 rounded-[22px] border border-white/80 bg-white/90 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form method="get" className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <input type="hidden" name="filter" value={filter} />
            <AutoSubmitInput
              name="q"
              defaultValue={rawQ}
              placeholder="Search catalog items..."
              className="h-11 min-w-[180px] flex-1 rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 text-[13.5px] outline-none transition-all placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.10)]"
            />
            <button
              type="submit"
              className="h-11 rounded-[14px] border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-slate-50"
            >
              Search
            </button>
          </form>
          <div className="flex flex-wrap gap-2 text-[12px]">
            {(['active', 'inactive', 'all'] as const).map((f) => (
              <Link
                key={f}
                href={`/items?filter=${f}${rawQ ? `&q=${encodeURIComponent(rawQ)}` : ''}`}
                className={`rounded-full px-3 py-1.5 font-semibold transition-all ${
                  filter === f
                    ? 'bg-[var(--color-bv-accent)] text-white shadow-[0_10px_22px_rgba(47,90,243,0.22)]'
                    : 'border border-slate-200 bg-white text-slate-500 hover:border-blue-100 hover:bg-blue-50 hover:text-blue-700'
                }`}
              >
                {f === 'all' ? 'All' : f === 'active' ? 'Active' : 'Inactive'}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {items.length === 0 ? (
        <EmptyState
          title="No items yet"
          description={
            canManage
              ? 'Define catalog lines here — materials link to vendor pricing; labor/machine/install use internal rates.'
              : 'Your admin team can publish catalog items for consistent estimating.'
          }
          primaryAction={
            canManage ? { label: 'Create item', href: '/items/new' } : undefined
          }
        />
      ) : (
        <section className="flex min-h-[320px] flex-col overflow-hidden rounded-[22px] border border-white/80 bg-white/90 shadow-[0_22px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl min-[1500px]:max-h-[calc(100vh-375px)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-[15px] font-semibold text-slate-950">Pricing intelligence</h2>
              <p className="mt-1 text-[12.5px] text-slate-500">Internal costs, sell hints, vendor history, and picker readiness.</p>
            </div>
            <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-700">
              Estimate ready
            </span>
          </div>
          <div className="min-h-0 overflow-y-auto p-4">
            <BulkDeleteForm action={bulkDeleteShopMaterialItemsAction} itemLabel="catalog items">
              <div className="grid gap-3">
            <div className="hidden px-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 min-[1500px]:grid min-[1500px]:grid-cols-[minmax(0,1.35fr)_120px_100px_100px_80px_minmax(0,1fr)_minmax(0,0.9fr)_110px_90px_80px_90px]">
              <span>Item</span>
              <span>Category</span>
              <span>Internal</span>
              <span>Sell hint</span>
              <span>Markup</span>
              <span>Latest vendor</span>
              <span>Cheapest</span>
              <span>Status</span>
              <span>Vendors</span>
              <span>Aliases</span>
              <span>Updated</span>
            </div>
            {items.map((it) => {
              const s = summarizeLinks(it.vendorCatalogLinks);
              const basis =
                it.kind === EstimateLineKind.MATERIAL && s.latestPriceCents !== null
                  ? s.latestPriceCents
                  : it.internalCostCents;
              const sellHint =
                it.defaultSellPriceCents ??
                sellPriceFromCostAndMarkup(basis, it.markupPercentMilli);
              const mkLabel =
                it.markupPercentMilli === 0
                  ? '—'
                  : `${(it.markupPercentMilli / 1000).toLocaleString(undefined, {
                      maximumFractionDigits: 3,
                    })}%`;
              const category = it.categories.length > 0
                ? it.categories.map(categoryLabel).join(', ')
                : kindLabel(it.kind);

              return (
                <div
                  key={it.id}
                  className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-[18px] border border-slate-100 bg-white px-4 py-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-100 hover:shadow-[0_18px_42px_rgba(15,23,42,0.08)]"
                >
                  <input
                    type="checkbox"
                    name="ids"
                    value={it.id}
                    aria-label={`Select ${it.name}`}
                    className="mt-3 h-4 w-4 rounded border-slate-300 text-[var(--color-bv-accent)] focus:ring-[var(--color-bv-accent)]"
                  />
                  <Link
                    href={`/items/${it.id}`}
                    className="group grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3 min-[1500px]:grid-cols-[minmax(0,1.35fr)_120px_100px_100px_80px_minmax(0,1fr)_minmax(0,0.9fr)_110px_90px_80px_90px]"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-blue-50 text-[13px] font-semibold text-blue-700 ring-1 ring-blue-100 transition group-hover:bg-blue-100">
                          {initials(it.name)}
                        </div>
                        <div className="min-w-0">
                          <span className="truncate text-[14px] font-semibold text-slate-950 group-hover:text-[var(--color-bv-accent)]">
                            {it.name}
                          </span>
                          {it.itemType === 'BUNDLE' ? (
                            <span className="ml-2 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                              Bundle
                            </span>
                          ) : null}
                          <p className="mt-1 truncate font-mono text-[10px] text-slate-400">
                            {it.nameNormalized}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="text-[12.5px] text-slate-500">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-600">
                        {category}
                      </span>
                    </div>

                    <CatalogRowValue label="Internal" value={formatMoney(it.internalCostCents)} />
                    <CatalogRowValue label="Sell hint" value={formatMoney(sellHint)} strong />
                    <CatalogRowValue label="Markup" value={mkLabel} />

                    <div className="min-w-0 text-[12.5px] tabular-nums">
                      <MobileLabel>Latest vendor</MobileLabel>
                      {it.kind === EstimateLineKind.MATERIAL && s.latestPriceCents !== null ? (
                        <>
                          <div className="font-semibold text-slate-900">{formatMoney(s.latestPriceCents)}</div>
                          <div className="truncate text-[11px] text-slate-500">
                            {s.latestAtLabel ?? '—'} · {s.latestSource ?? '—'}
                          </div>
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </div>

                    <div className="min-w-0 text-[12.5px]">
                      <MobileLabel>Cheapest</MobileLabel>
                      {it.kind === EstimateLineKind.MATERIAL &&
                      s.cheapestVendor &&
                      s.cheapestCents !== null ? (
                        <>
                          <div className="font-semibold tabular-nums text-slate-900">{formatMoney(s.cheapestCents)}</div>
                          <div className="truncate text-[11px] text-slate-500">{s.cheapestVendor}</div>
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </div>

                    <div>
                      <MobileLabel>Status</MobileLabel>
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                          it.isActive
                            ? 'border border-emerald-200 bg-emerald-50 text-emerald-900'
                            : 'border border-slate-200 bg-slate-50 text-slate-700'
                        }`}
                      >
                        {it.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    <CatalogRowValue
                      label="Vendors"
                      value={it.itemType === 'BUNDLE' ? `${it._count.bundleComponents} components` : String(it._count.vendorCatalogLinks)}
                    />
                    <CatalogRowValue label="Aliases" value={String(it._count.aliases)} />
                    <CatalogRowValue label="Updated" value={it.updatedAt.toISOString().slice(0, 10)} />
                  </Link>
                </div>
              );
            })}
              </div>
            </BulkDeleteForm>
          </div>
          <PaginationControls
            basePath="/items"
            page={page}
            total={filteredTotal}
            params={{ q: rawQ, filter: filter === 'active' ? undefined : filter }}
          />
        </section>
      )}
    </>
  );
}

function CatalogMetric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'blue' | 'emerald' | 'slate' | 'violet' }) {
  const toneClass = {
    blue: 'from-blue-600/10 to-indigo-500/10 text-blue-700 ring-blue-500/15',
    emerald: 'from-emerald-600/10 to-teal-500/10 text-emerald-700 ring-emerald-500/15',
    slate: 'from-slate-600/10 to-slate-400/10 text-slate-700 ring-slate-500/15',
    violet: 'from-violet-600/10 to-fuchsia-500/10 text-violet-700 ring-violet-500/15',
  }[tone];
  return (
    <div className={`rounded-[18px] border border-white/80 bg-gradient-to-br px-4 py-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] ring-1 backdrop-blur-xl ${toneClass}`}>
      <div className="text-[10px] font-black uppercase tracking-[0.13em] opacity-70">{label}</div>
      <div className="mt-2 text-[20px] font-black leading-none tracking-[-0.02em]">{value}</div>
      <p className="mt-2 text-[11.5px] font-semibold leading-snug opacity-70">{detail}</p>
    </div>
  );
}

function CatalogRowValue({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`text-[12.5px] tabular-nums ${strong ? 'font-semibold text-slate-950' : 'text-slate-600'}`}>
      <MobileLabel>{label}</MobileLabel>
      {value}
    </div>
  );
}

function MobileLabel({ children }: { children: ReactNode }) {
  return <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 min-[1500px]:hidden">{children}</span>;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
