import Link from 'next/link';
import { prisma, Role, type VendorPriceExtractionMethod } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { EmptyState } from '@/components/app/empty-state';
import { formatMoney } from '@/lib/estimate/format';
import { normalizeVendorItemName } from '@/lib/vendor-pricing/normalize';
import { labelVendorPriceExtractionMethod } from '@/lib/ui/status-labels';

export const metadata = { title: 'Items' };
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
      isActive: true,
      category: true,
      defaultUnit: true,
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

  return (
    <>
      <PageHeader
        title="Items"
        subtitle="Managed materials with vendor pricing — deterministic catalog matching for estimates."
        actions={
          canManage ? (
            <Link
              href="/items/new"
              className="inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm transition-colors hover:opacity-90"
            >
              New item
            </Link>
          ) : null
        }
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <form method="get" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="filter" value={filter} />
          <input
            name="q"
            defaultValue={rawQ}
            placeholder="Search name…"
            className="min-w-[200px] rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-bv-accent)]"
          />
          <button
            type="submit"
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-2 text-[13px] font-medium hover:bg-[var(--color-bv-bg)]"
          >
            Search
          </button>
        </form>
        <div className="flex flex-wrap gap-2 text-[12px]">
          {(['active', 'inactive', 'all'] as const).map((f) => (
            <Link
              key={f}
              href={`/items?filter=${f}${rawQ ? `&q=${encodeURIComponent(rawQ)}` : ''}`}
              className={`rounded-full px-3 py-1 font-medium ${
                filter === f
                  ? 'bg-[var(--color-bv-accent)]/15 text-[var(--color-bv-accent)] ring-1 ring-[var(--color-bv-accent)]/25'
                  : 'border border-[var(--color-bv-border)] text-[var(--color-bv-muted)] hover:bg-[var(--color-bv-bg)]'
              }`}
            >
              {f === 'all' ? 'All' : f === 'active' ? 'Active' : 'Inactive'}
            </Link>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No items yet"
          description={
            canManage
              ? 'Define shop materials here so vendor pricing and estimate hints stay organized.'
              : 'Your admin team can publish managed materials so estimates reference consistent pricing.'
          }
          primaryAction={
            canManage ? { label: 'Create item', href: '/items/new' } : undefined
          }
        />
      ) : (
        <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-[13px]">
              <thead>
                <tr className="border-b border-[var(--color-bv-border)] text-left text-[11px] uppercase tracking-wider text-[var(--color-bv-muted)]">
                  <th className="px-4 py-2 font-medium">Item</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Latest price</th>
                  <th className="px-4 py-2 font-medium">Cheapest</th>
                  <th className="px-4 py-2 font-medium">Preferred</th>
                  <th className="px-4 py-2 font-medium">Vendors</th>
                  <th className="px-4 py-2 font-medium">Aliases</th>
                  <th className="px-4 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const s = summarizeLinks(it.vendorCatalogLinks);
                  return (
                    <tr key={it.id} className="border-b border-[var(--color-bv-border)] last:border-b-0">
                      <td className="px-4 py-2.5 align-top">
                        <Link href={`/items/${it.id}`} className="font-semibold text-[var(--color-bv-accent)]">
                          {it.name}
                        </Link>
                        <div className="mt-0.5 font-mono text-[10px] text-[var(--color-bv-muted)]">
                          {it.nameNormalized}
                        </div>
                        {it.category ? (
                          <div className="mt-1 text-[11px] text-[var(--color-bv-muted)]">{it.category}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                            it.isActive
                              ? 'border border-emerald-200 bg-emerald-50 text-emerald-900'
                              : 'border border-slate-200 bg-slate-50 text-slate-700'
                          }`}
                        >
                          {it.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 align-top tabular-nums">
                        {s.latestPriceCents !== null ? (
                          <>
                            <div className="font-medium">{formatMoney(s.latestPriceCents)}</div>
                            <div className="text-[11px] text-[var(--color-bv-muted)]">
                              {s.latestAtLabel ?? '—'} · {s.latestSource ?? '—'}
                            </div>
                          </>
                        ) : (
                          <span className="text-[var(--color-bv-muted)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        {s.cheapestVendor && s.cheapestCents !== null ? (
                          <>
                            <div className="font-medium tabular-nums">{formatMoney(s.cheapestCents)}</div>
                            <div className="text-[11px] text-[var(--color-bv-muted)]">{s.cheapestVendor}</div>
                          </>
                        ) : (
                          <span className="text-[var(--color-bv-muted)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 align-top text-[12px]">
                        {it.preferredVendor?.name ?? (
                          <span className="text-[var(--color-bv-muted)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 align-top tabular-nums">{it._count.vendorCatalogLinks}</td>
                      <td className="px-4 py-2.5 align-top tabular-nums">{it._count.aliases}</td>
                      <td className="px-4 py-2.5 align-top text-[12px] text-[var(--color-bv-muted)] tabular-nums">
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
