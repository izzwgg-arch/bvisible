import Link from 'next/link';
import type { ReactNode } from 'react';
import { prisma, POStatus, Prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { AutoSubmitInput, AutoSubmitSelect } from '@/components/app/auto-submit-controls';
import { EmptyState } from '@/components/app/empty-state';
import { DEFAULT_PAGE_SIZE, PaginationControls, pageSkip, parsePageParam } from '@/components/app/pagination-controls';
import { formatMoney } from '@/lib/estimate/format';
import { PoItemsPeek, type PeekLine } from './po-items-peek';
import { PoOrderedStamp } from './po-ordered-stamp';

const PEEK_LINE_LIMIT = 12;
import { labelPoStatus } from '@/lib/ui/status-labels';

export const metadata = { title: 'Purchase orders' };
export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<POStatus, string> = {
  DRAFT: 'border-slate-200 bg-slate-50 text-slate-700',
  SENT: 'border-blue-200 bg-blue-50 text-blue-700',
  ORDERED: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  PARTIALLY_RECEIVED: 'border-amber-200 bg-amber-50 text-amber-800',
  RECEIVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  CANCELED: 'border-rose-200 bg-rose-50 text-rose-700',
};

const OPEN_PO_STATUSES = new Set<POStatus>([
  POStatus.DRAFT,
  POStatus.SENT,
  POStatus.ORDERED,
  POStatus.PARTIALLY_RECEIVED,
]);

interface SearchParams {
  created?: string;
  deleted?: string;
  q?: string | string[];
  status?: string | string[];
  source?: string | string[];
  sort?: string | string[];
  page?: string | string[];
}

const STATUS_FILTERS: ReadonlyArray<{ value: 'all' | POStatus; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: POStatus.DRAFT, label: 'Draft' },
  { value: POStatus.SENT, label: 'Sent' },
  { value: POStatus.ORDERED, label: 'Ordered' },
  { value: POStatus.PARTIALLY_RECEIVED, label: 'Partially received' },
  { value: POStatus.RECEIVED, label: 'Received' },
  { value: POStatus.CANCELED, label: 'Canceled' },
];

const SOURCE_FILTERS = [
  { value: 'all', label: 'All sources' },
  { value: 'estimate-linked', label: 'Estimate linked' },
  { value: 'manual', label: 'Manual POs' },
] as const;

const SORT_OPTIONS = [
  { value: 'updated-desc', label: 'Recently updated' },
  { value: 'spend-desc', label: 'Highest spend' },
  { value: 'spend-asc', label: 'Lowest spend' },
  { value: 'number-asc', label: 'PO number A-Z' },
] as const;

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireTenantId();
  const sp = await searchParams;
  const query = firstParam(sp.q).trim();
  const status = normalizeStatus(firstParam(sp.status));
  const source = normalizeSource(firstParam(sp.source));
  const sort = normalizeSort(firstParam(sp.sort));
  const page = parsePageParam(sp.page);

  const where: Prisma.PurchaseOrderWhereInput = {
    tenantId: me.tenantId,
    deletedAt: null,
    ...(status ? { status } : {}),
    ...(source === 'estimate-linked' ? { estimateId: { not: null } } : {}),
    ...(source === 'manual' ? { estimateId: null } : {}),
    ...(query
      ? {
          OR: [
            { number: { contains: query, mode: 'insensitive' } },
            { qboPoNumber: { contains: query, mode: 'insensitive' } },
            { vendor: { name: { contains: query, mode: 'insensitive' } } },
            { estimate: { number: { contains: query, mode: 'insensitive' } } },
            { estimate: { title: { contains: query, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [pos, filteredTotal, totalPoCount] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      orderBy: orderByForSort(sort),
      select: {
        id: true,
        number: true,
        status: true,
        qboPoNumber: true,
        subtotalCents: true,
        updatedAt: true,
        createdAt: true,
        createdBy: { select: { name: true, email: true } },
        vendor: { select: { id: true, name: true } },
        estimate: {
          select: {
            id: true,
            number: true,
            title: true,
            client: { select: { companyName: true } },
          },
        },
        // Enough lines to fill the hover peek; the count below reports the truth
        // when a PO has more than this.
        lines: {
          select: { id: true, description: true, qtyMilli: true, unit: true, computedCostCents: true },
          orderBy: { sortOrder: 'asc' },
          take: PEEK_LINE_LIMIT,
        },
        _count: { select: { lines: true, attachments: true } },
      },
      skip: pageSkip(page),
      take: DEFAULT_PAGE_SIZE,
    }),
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.count({
      where: { tenantId: me.tenantId, deletedAt: null },
    }),
  ]);

  const totalAuthorizedCents = pos.reduce((sum, po) => sum + po.subtotalCents, 0);
  const openCount = pos.filter((po) => OPEN_PO_STATUSES.has(po.status)).length;
  const receivedCount = pos.filter((po) => po.status === POStatus.RECEIVED).length;
  const linkedEstimateCount = pos.filter((po) => po.estimate).length;
  const hasActiveFilters = Boolean(query || status || source !== 'all' || sort !== 'updated-desc');

  return (
    <>
      <PageHeader
        title="Purchase orders"
        subtitle={`Vendor spend command center for ${me.tenant.name}. Track authorization, receiving, and estimate coverage.`}
        actions={
          <>
            <Link
              href="/purchase-orders/new"
              className="inline-flex items-center justify-center rounded-[12px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
            >
              Blank PO
            </Link>
            <Link
              href="/purchase-orders/shop-order"
              className="inline-flex items-center justify-center rounded-[12px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--color-bv-accent-foreground)] shadow-[0_16px_34px_rgba(47,90,243,0.24)] transition-all hover:-translate-y-0.5 hover:opacity-95"
            >
              + Order materials
            </Link>
          </>
        }
      />

      {sp.created ? (
        <div className="mb-5 rounded-[var(--radius-bv)] border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] text-emerald-900">
          Created <span className="font-mono">{sp.created}</span>.
        </div>
      ) : null}
      {sp.deleted ? (
        <div className="mb-5 rounded-[var(--radius-bv)] border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">
          Deleted <span className="font-mono">{sp.deleted}</span>.
        </div>
      ) : null}

      {totalPoCount === 0 ? (
        <EmptyState
          title="No purchase orders yet"
          description={
            <>
              POs record spending against vendors. Create one manually or convert an approved
              estimate.{' '}
              <Link href="/vendors" className="font-medium text-[var(--color-bv-accent)] underline-offset-2 hover:underline">
                Vendors
              </Link>{' '}
              should exist before you place orders.
            </>
          }
          primaryAction={{ label: 'Create PO', href: '/purchase-orders/new' }}
          secondaryAction={{ label: 'Go to estimates', href: '/estimates' }}
        />
      ) : (
        <div className="grid gap-5">
          <section className="grid gap-3 md:grid-cols-4">
            <MetricCard label="Authorized spend" value={formatMoney(totalAuthorizedCents)} detail={`${pos.length} purchase orders`} tone="blue" />
            <MetricCard label="Open workflow" value={openCount.toString()} detail="Needs vendor or receiving action" tone="amber" />
            <MetricCard label="Received" value={receivedCount.toString()} detail="Closed procurement loops" tone="emerald" />
            <MetricCard label="Estimate linked" value={linkedEstimateCount.toString()} detail="Traceable to approved work" tone="violet" />
          </section>

          <section className="rounded-[22px] border border-white/80 bg-white/90 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <form method="get" className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_190px_180px_180px_auto] lg:items-end">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-black uppercase tracking-[0.13em] text-slate-400">
                  Search
                </span>
                <span className="relative block">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <circle cx="11" cy="11" r="7" />
                      <path d="m20 20-3.5-3.5" />
                    </svg>
                  </span>
                  <AutoSubmitInput
                    name="q"
                    defaultValue={query}
                    placeholder="Search PO, vendor, QBO, or estimate..."
                    className="h-11 w-full rounded-[14px] border border-slate-200 bg-white pl-10 pr-3 text-[13px] font-medium text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                  />
                </span>
              </label>

              <FilterSelect name="status" label="Status" value={status ?? 'all'} options={STATUS_FILTERS} />
              <FilterSelect name="source" label="Source" value={source} options={SOURCE_FILTERS} />
              <FilterSelect name="sort" label="Sort" value={sort} options={SORT_OPTIONS} />

              <div className="flex items-center gap-2 lg:self-end">
                <button
                  type="submit"
                  className="inline-flex h-11 items-center justify-center rounded-[14px] bg-slate-950 px-4 text-[13px] font-bold text-white shadow-sm transition hover:bg-slate-800"
                >
                  Apply
                </button>
                {hasActiveFilters ? (
                  <Link
                    href="/purchase-orders"
                    className="inline-flex h-11 items-center justify-center rounded-[14px] border border-slate-200 bg-white px-4 text-[13px] font-bold text-slate-600 shadow-sm hover:bg-slate-50"
                  >
                    Reset
                  </Link>
                ) : null}
              </div>
            </form>
          </section>

          <section className="flex max-h-[calc(100vh-360px)] min-h-[320px] flex-col overflow-hidden rounded-[22px] border border-white/80 bg-white/90 shadow-[0_22px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-[14px] bg-blue-50 text-blue-600 ring-1 ring-blue-100">
                  <ClipboardIcon />
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-slate-950">Procurement queue</h2>
                  <p className="text-[12.5px] text-slate-500">
                    {hasActiveFilters
                      ? `${filteredTotal} purchase order${filteredTotal === 1 ? '' : 's'} match the current view.`
                      : 'Every PO, vendor, status, and source estimate in one clean review surface.'}
                  </p>
                </div>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {pos.length} showing
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="grid gap-3 p-4">
                <div className="hidden px-4 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400 xl:grid xl:grid-cols-[150px_minmax(0,1fr)_176px_minmax(0,1.1fr)_120px_112px_96px]">
                  <span>PO / Status</span>
                  <span>Vendor</span>
                  <span>Ordered by &amp; when</span>
                  <span>Estimate &amp; company</span>
                  <span>Items</span>
                  <span className="text-right">Total</span>
                  <span className="text-right">Quick</span>
                </div>

                {pos.length === 0 ? (
                  <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-10 text-center">
                    <h3 className="text-[14px] font-semibold text-slate-950">No purchase orders match</h3>
                    <p className="mt-1 text-[12.5px] text-slate-500">Adjust the search or filters to bring POs back into view.</p>
                    <Link
                      href="/purchase-orders"
                      className="mt-4 inline-flex rounded-[12px] border border-slate-200 bg-white px-4 py-2 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Clear filters
                    </Link>
                  </div>
                ) : (
                  pos.map((p) => (
                    <div
                      key={p.id}
                      className="group grid items-center gap-4 rounded-[14px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-3.5 transition-colors hover:border-[#d9c7b4] xl:grid-cols-[150px_minmax(0,1fr)_176px_minmax(0,1.1fr)_120px_112px_96px]"
                    >
                      <div className="min-w-0">
                        <Link href={`/purchase-orders/${p.id}` as never} className="min-w-0">
                          <span className="block text-[14px] font-extrabold tabular-nums tracking-[-0.01em] text-[var(--color-bv-text)] group-hover:text-[#14395a]">
                            {p.number}
                          </span>
                        </Link>
                        <span className="mt-1 inline-flex">
                          <StatusPill status={p.status} />
                        </span>
                      </div>

                      <PoRowValue label="Vendor" value={p.vendor?.name ?? 'Vendor unassigned'} strong={Boolean(p.vendor)} muted={!p.vendor} />

                      <div className="min-w-0">
                        <MobileLabel>Ordered by</MobileLabel>
                        <span className="flex items-center gap-1.5">
                          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#1C4972] text-[9px] font-bold text-white">
                            {personInitials(p.createdBy.name ?? p.createdBy.email)}
                          </span>
                          <span className="truncate text-[12px] font-semibold text-[var(--color-bv-text)]">
                            {shortName(p.createdBy.name ?? p.createdBy.email)}
                          </span>
                        </span>
                        <span className="mt-0.5 block">
                          <PoOrderedStamp
                            iso={p.createdAt.toISOString()}
                            fallback={`${formatDate(p.createdAt)} · ${formatTime(p.createdAt)}`}
                          />
                        </span>
                      </div>

                      <div className="min-w-0">
                        <MobileLabel>Estimate &amp; company</MobileLabel>
                        {p.estimate ? (
                          <span className="flex min-w-0 flex-col gap-px">
                            <Link
                              href={`/estimates/${p.estimate.id}` as never}
                              className="self-start border-b border-[rgba(28,73,114,0.25)] text-[12.5px] font-bold text-[var(--color-bv-text)] transition-colors hover:border-[var(--color-bv-accent)] hover:text-[#14395a]"
                              title={p.estimate.title}
                            >
                              {p.estimate.number}
                            </Link>
                            <span className="truncate text-[12px] text-[var(--color-bv-muted)]">
                              {p.estimate.client?.companyName ?? 'No company on estimate'}
                            </span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-2">
                            <span className="text-[12px] italic text-slate-400">No estimate</span>
                            <Link
                              href={`/purchase-orders/${p.id}` as never}
                              className="whitespace-nowrap rounded-[6px] border border-dashed border-[rgba(242,135,68,0.5)] px-2 py-0.5 text-[11px] font-bold text-[var(--color-bv-accent)] transition-colors hover:border-solid hover:bg-[#fff4eb]"
                            >
                              Attach
                            </Link>
                          </span>
                        )}
                      </div>

                      <div className="min-w-0">
                        <MobileLabel>Items</MobileLabel>
                        <PoItemsPeek lines={peekLines(p.lines)} totalLines={p._count.lines} />
                      </div>

                      <div className="xl:text-right">
                        <MobileLabel>Total</MobileLabel>
                        <span className="text-[16px] font-extrabold tabular-nums tracking-[-0.02em] text-[var(--color-bv-text)]">
                          {formatMoney(p.subtotalCents)}
                        </span>
                      </div>

                      <div>
                        <MobileLabel>Quick</MobileLabel>
                        <div className="flex flex-wrap justify-end gap-x-2 gap-y-0.5">
                          <Link
                            href={`/purchase-orders/${p.id}` as never}
                            className="text-[11.5px] font-bold text-slate-400 hover:text-blue-600 hover:underline"
                          >
                            Open
                          </Link>
                          <Link
                            href={`/purchase-orders/${p.id}/reconciliation` as never}
                            className="text-[11.5px] font-bold text-slate-400 hover:text-blue-600 hover:underline"
                          >
                            Reconcile
                          </Link>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="grid gap-3 border-t border-slate-100 bg-blue-50/70 px-5 py-4 text-[12.5px] text-slate-600 md:grid-cols-3">
              <Insight label="Review cadence" value="Check ordered and partially received POs daily." />
              <Insight label="Best practice" value="Link POs back to estimates for quote-to-spend visibility." />
              <Insight label="Ready state" value="Received POs are clean handoffs for reconciliation." />
            </div>
            <PaginationControls
              basePath="/purchase-orders"
              page={page}
              total={filteredTotal}
              params={{ q: query, status: status ?? undefined, source: source === 'all' ? undefined : source, sort: sort === 'updated-desc' ? undefined : sort }}
            />
          </section>
        </div>
      )}
    </>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: 'blue' | 'amber' | 'emerald' | 'violet';
}) {
  const toneClass = {
    blue: 'from-blue-600/10 to-indigo-500/10 text-blue-700 ring-blue-500/15',
    amber: 'from-amber-500/10 to-orange-400/10 text-amber-700 ring-amber-500/15',
    emerald: 'from-emerald-600/10 to-teal-500/10 text-emerald-700 ring-emerald-500/15',
    violet: 'from-violet-600/10 to-fuchsia-500/10 text-violet-700 ring-violet-500/15',
  }[tone];

  return (
    <div className={`rounded-[18px] border border-white/80 px-4 py-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] ring-1 backdrop-blur-xl ${toneClass}`}>
      <div className="text-[10px] font-black uppercase tracking-[0.13em] opacity-70">{label}</div>
      <div className="mt-2 text-[20px] font-black leading-none tracking-[-0.02em]">{value}</div>
      <p className="mt-2 text-[11.5px] font-semibold leading-snug opacity-70">{detail}</p>
    </div>
  );
}

function Insight({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className="mt-1 font-medium text-slate-700">{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: POStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-medium ${STATUS_TONE[status]}`}
    >
      {labelPoStatus(status)}
    </span>
  );
}

function PoRowValue({
  label,
  value,
  strong,
  muted,
  mono,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  mono?: boolean;
}) {
  return (
    <div
      className={`min-w-0 truncate text-[12.5px] tabular-nums ${
        muted ? 'text-slate-400' : strong ? 'font-semibold text-slate-950' : 'text-slate-600'
      } ${mono ? 'font-mono' : ''}`}
    >
      <MobileLabel>{label}</MobileLabel>
      {value}
    </div>
  );
}

function MobileLabel({ children }: { children: ReactNode }) {
  return <span className="mb-0.5 block text-[10px] font-black uppercase tracking-[0.12em] text-slate-400 xl:hidden">{children}</span>;
}

function FilterSelect({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-black uppercase tracking-[0.13em] text-slate-400">
        {label}
      </span>
      <AutoSubmitSelect
        name={name}
        defaultValue={value}
        className="h-11 rounded-[14px] border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-700 shadow-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </AutoSubmitSelect>
    </label>
  );
}

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function normalizeStatus(value: string): POStatus | null {
  if (!value || value === 'all') return null;
  return Object.values(POStatus).includes(value as POStatus)
    ? (value as POStatus)
    : null;
}

function normalizeSource(value: string): (typeof SOURCE_FILTERS)[number]['value'] {
  return SOURCE_FILTERS.some((filter) => filter.value === value)
    ? (value as (typeof SOURCE_FILTERS)[number]['value'])
    : 'all';
}

function normalizeSort(value: string): (typeof SORT_OPTIONS)[number]['value'] {
  return SORT_OPTIONS.some((option) => option.value === value)
    ? (value as (typeof SORT_OPTIONS)[number]['value'])
    : 'updated-desc';
}

function orderByForSort(sort: (typeof SORT_OPTIONS)[number]['value']): Prisma.PurchaseOrderOrderByWithRelationInput[] {
  switch (sort) {
    case 'spend-desc':
      return [{ subtotalCents: 'desc' }, { updatedAt: 'desc' }];
    case 'spend-asc':
      return [{ subtotalCents: 'asc' }, { updatedAt: 'desc' }];
    case 'number-asc':
      return [{ number: 'asc' }, { updatedAt: 'desc' }];
    case 'updated-desc':
    default:
      return [{ updatedAt: 'desc' }];
  }
}

/** "Shmiel Rosenberg" → "SR". Falls back to the first two characters of an
 *  email local part when a user has no name set. */
function personInitials(value: string): string {
  const name = value.includes('@') ? (value.split('@')[0] ?? value) : value;
  const parts = name.split(/[-._\s]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** "Shmiel Rosenberg" → "Shmiel R." so the column holds one line. */
function shortName(value: string): string {
  if (value.includes('@')) return value.split('@')[0] ?? value;
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return value;
  return `${parts[0]} ${parts[parts.length - 1]?.[0] ?? ''}.`;
}

function peekLines(
  lines: ReadonlyArray<{
    id: string;
    description: string;
    qtyMilli: number;
    unit: string;
    computedCostCents: number;
  }>,
): PeekLine[] {
  return lines.map((line) => ({
    id: line.id,
    description: line.description,
    // qtyMilli is thousandths — show 3 as "3", 2.5 as "2.5".
    qty: String(Number((line.qtyMilli / 1000).toFixed(3))),
    unit: line.unit.toLowerCase() === 'each' ? 'ea' : line.unit.toLowerCase(),
    costCents: line.computedCostCents,
  }));
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(value);
}

function formatTime(value: Date): string {
  return new Intl.DateTimeFormat('en', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);
}

function ClipboardIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M9 5h6" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
      <path d="M8 3h8l1 3h3v15H4V6h3l1-3Z" />
    </svg>
  );
}
