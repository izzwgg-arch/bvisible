import Link from 'next/link';
import { prisma, Role, EstimateLineKind, type VendorPriceExtractionMethod } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { ItemCsvButtons } from './csv-buttons';
import { PageHeader } from '@/components/app-shell';
import { EmptyState } from '@/components/app/empty-state';
import { formatMoney, kindLabel } from '@/lib/estimate/format';
import { normalizeVendorItemName } from '@/lib/vendor-pricing/normalize';
import { labelVendorPriceExtractionMethod } from '@/lib/ui/status-labels';
import { sellPriceFromCostAndMarkup } from '@/lib/shop-material/markup';

export const metadata = { title: 'Catalog' };
export const dynamic = 'force-dynamic';

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

  const items = await prisma.shopMaterialItem.findMany({
    where: {
      tenantId: me.tenantId,
      ...(filter === 'active' ? { isActive: true } : {}),
      ...(filter === 'inactive' ? { isActive: false } : {}),
      ...(rawQ
        ? {
            OR: [
              { name: { contains: rawQ, mode: 'insensitive' } },
              ...(normQ.length >= 2 ? [{ nameNormalized: { contains: normQ } }] : []),
            ],
          }
        : {}),
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: 150,
    select: {
      id: true,
      name: true,
      nameNormalized: true,
      kind: true,
      isActive: true,
      internalCostCents: true,
      markupPercentMilli: true,
      defaultSellPriceCents: true,
      updatedAt: true,
      preferredVendor: { select: { name: true } },
      _count: { select: { aliases: true, vendorCatalogLinks: true } },
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
  });

  const activeCount = items.filter((item) => item.isActive).length;
  const materialCount = items.filter((item) => item.kind === EstimateLineKind.MATERIAL).length;
  const vendorLinkedCount = items.filter((item) => item._count.vendorCatalogLinks > 0).length;

  return (
    <>
      <PageHeader
        title="Catalog"
        subtitle="Modern pricing catalog for estimate building, internal rates, markup guidance, and vendor intelligence."
        actions={
          canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <ItemCsvButtons />
              <Link
                href="/items/new"
                className="inline-flex items-center justify-center rounded-[12px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--color-bv-accent-foreground)] shadow-[0_16px_34px_rgba(47,90,243,0.24)] transition-all hover:-translate-y-0.5 hover:opacity-95"
              >
                Create catalog item
              </Link>
            </div>
          ) : null
        }
      />

      <section className="mb-5 grid gap-3 md:grid-cols-4">
        <CatalogMetric label="Visible items" value={activeCount.toString()} detail="Active in estimate picker" />
        <CatalogMetric label="Materials" value={materialCount.toString()} detail="Vendor-price aware lines" />
        <CatalogMetric label="Vendor linked" value={vendorLinkedCount.toString()} detail="Have supplier intelligence" />
        <CatalogMetric label="Showing" value={items.length.toString()} detail={`${filter} filter${rawQ ? ` · "${rawQ}"` : ''}`} />
      </section>

      <section className="mb-5 rounded-[22px] border border-white/80 bg-white/90 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form method="get" className="flex min-w-[280px] flex-1 flex-wrap items-center gap-2">
            <input type="hidden" name="filter" value={filter} />
            <input
              name="q"
              defaultValue={rawQ}
              placeholder="Search catalog items..."
              className="h-11 min-w-[240px] flex-1 rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 text-[13.5px] outline-none transition-all placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.10)]"
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
        <section className="overflow-hidden rounded-[22px] border border-white/80 bg-white/90 shadow-[0_22px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-[15px] font-semibold text-slate-950">Pricing intelligence</h2>
              <p className="mt-1 text-[12.5px] text-slate-500">Internal costs, sell hints, vendor history, and picker readiness.</p>
            </div>
            <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-700">
              Estimate ready
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-[13px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  <th className="px-4 py-3 font-semibold">Item</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Internal</th>
                  <th className="px-4 py-3 font-semibold">Sell hint</th>
                  <th className="px-4 py-3 font-semibold">Markup</th>
                  <th className="px-4 py-3 font-semibold">Latest vendor</th>
                  <th className="px-4 py-3 font-semibold">Cheapest</th>
                  <th className="px-4 py-3 font-semibold">Preferred</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Vendors</th>
                  <th className="px-4 py-3 font-semibold">Aliases</th>
                  <th className="px-4 py-3 font-semibold">Updated</th>
                </tr>
              </thead>
              <tbody>
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

                  return (
                    <tr key={it.id} className="group border-b border-slate-100 last:border-b-0 hover:bg-blue-50/35">
                      <td className="px-4 py-4 align-top">
                        <Link href={`/items/${it.id}`} className="font-semibold text-slate-950 transition-colors group-hover:text-blue-700">
                          {it.name}
                        </Link>
                        <div className="mt-1 font-mono text-[10px] text-slate-400">
                          {it.nameNormalized}
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top text-[12px]">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-600">
                          {kindLabel(it.kind)}
                        </span>
                      </td>
                      <td className="px-4 py-4 align-top tabular-nums text-slate-700">
                        {formatMoney(it.internalCostCents)}
                      </td>
                      <td className="px-4 py-4 align-top tabular-nums font-semibold text-slate-950">
                        {formatMoney(sellHint)}
                      </td>
                      <td className="px-4 py-4 align-top tabular-nums text-[12px] text-slate-600">{mkLabel}</td>
                      <td className="px-4 py-4 align-top tabular-nums">
                        {it.kind === EstimateLineKind.MATERIAL && s.latestPriceCents !== null ? (
                          <>
                            <div className="font-semibold text-slate-900">{formatMoney(s.latestPriceCents)}</div>
                            <div className="text-[11px] text-slate-500">
                              {s.latestAtLabel ?? '—'} · {s.latestSource ?? '—'}
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 align-top">
                        {it.kind === EstimateLineKind.MATERIAL &&
                        s.cheapestVendor &&
                        s.cheapestCents !== null ? (
                          <>
                            <div className="font-semibold tabular-nums text-slate-900">{formatMoney(s.cheapestCents)}</div>
                            <div className="text-[11px] text-slate-500">{s.cheapestVendor}</div>
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 align-top text-[12px] text-slate-600">
                        {it.kind === EstimateLineKind.MATERIAL ? (
                          it.preferredVendor?.name ?? (
                            <span className="text-slate-400">—</span>
                          )
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 align-top">
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                            it.isActive
                              ? 'border border-emerald-200 bg-emerald-50 text-emerald-900'
                              : 'border border-slate-200 bg-slate-50 text-slate-700'
                          }`}
                        >
                          {it.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-4 align-top tabular-nums text-slate-600">{it._count.vendorCatalogLinks}</td>
                      <td className="px-4 py-4 align-top tabular-nums text-slate-600">{it._count.aliases}</td>
                      <td className="px-4 py-4 align-top text-[12px] text-slate-500 tabular-nums">
                        {it.updatedAt.toISOString().slice(0, 10)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function CatalogMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[20px] border border-white/80 bg-white/90 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className="mt-3 text-[28px] font-semibold tracking-[-0.04em] text-slate-950">{value}</div>
      <p className="mt-1 text-[12.5px] leading-snug text-slate-500">{detail}</p>
    </div>
  );
}
