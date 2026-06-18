import Link from 'next/link';
import { prisma, EstimateStatus, Prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { EmptyState } from '@/components/app/empty-state';
import { formatMoney } from '@/lib/estimate/format';
import { getEstimateListNextAction } from '@/lib/estimate/estimate-list-next-action';
import { getEstimateListWorkflowChips } from '@/lib/estimate/estimate-list-workflow-chip';
import { labelEstimateStatus } from '@/lib/ui/status-labels';

export const metadata = { title: 'Estimates' };
export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<EstimateStatus, string> = {
  DRAFT: 'border-slate-200 bg-slate-50 text-slate-700',
  SENT: 'border-blue-200 bg-blue-50 text-blue-700',
  APPROVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  REJECTED: 'border-rose-200 bg-rose-50 text-rose-700',
  FINALIZED: 'border-violet-200 bg-violet-50 text-violet-700',
};

type EstimateSearchParams = {
  q?: string | string[];
  status?: string | string[];
  workflow?: string | string[];
  sort?: string | string[];
};

const STATUS_FILTERS: ReadonlyArray<{ value: 'all' | EstimateStatus; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: EstimateStatus.DRAFT, label: 'Draft' },
  { value: EstimateStatus.SENT, label: 'Sent' },
  { value: EstimateStatus.APPROVED, label: 'Approved' },
  { value: EstimateStatus.FINALIZED, label: 'Finalized' },
  { value: EstimateStatus.REJECTED, label: 'Rejected' },
];

const WORKFLOW_FILTERS = [
  { value: 'all', label: 'All workflows' },
  { value: 'needs-lines', label: 'Needs lines' },
  { value: 'ready-po', label: 'Ready for PO' },
  { value: 'ready-invoice', label: 'Ready to invoice' },
  { value: 'complete', label: 'Complete' },
] as const;

const SORT_OPTIONS = [
  { value: 'updated-desc', label: 'Recently updated' },
  { value: 'sell-desc', label: 'Highest value' },
  { value: 'sell-asc', label: 'Lowest value' },
  { value: 'title-asc', label: 'Job A-Z' },
] as const;

export default async function EstimatesPage({
  searchParams,
}: {
  searchParams?: Promise<EstimateSearchParams>;
}) {
  const me = await requireTenantId();
  const params = await searchParams;
  const query = firstParam(params?.q).trim();
  const status = normalizeStatus(firstParam(params?.status));
  const workflow = normalizeWorkflow(firstParam(params?.workflow));
  const sort = normalizeSort(firstParam(params?.sort));

  const where: Prisma.EstimateWhereInput = {
    tenantId: me.tenantId,
    deletedAt: null,
    ...(status ? { status } : {}),
    ...(query
      ? {
          OR: [
            { number: { contains: query, mode: 'insensitive' } },
            { title: { contains: query, mode: 'insensitive' } },
            { client: { companyName: { contains: query, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [estimates, hasClients] = await Promise.all([
    prisma.estimate.findMany({
      where,
      orderBy: orderByForSort(sort),
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        finalPriceCents: true,
        updatedAt: true,
        client: { select: { id: true, companyName: true } },
        _count: {
          select: {
            lines: true,
            purchaseOrders: { where: { deletedAt: null } },
            invoices: { where: { deletedAt: null } },
          },
        },
      },
      take: 200,
    }),
    prisma.client.count({
      where: { tenantId: me.tenantId, deletedAt: null },
    }),
  ]);

  const filteredEstimates = workflow === 'all'
    ? estimates
    : estimates.filter((estimate) => matchesWorkflowFilter(estimate, workflow));

  const totalSellCents = filteredEstimates.reduce((sum, estimate) => sum + estimate.finalPriceCents, 0);
  const approvedCount = filteredEstimates.filter((estimate) => estimate.status === EstimateStatus.APPROVED).length;
  const draftCount = filteredEstimates.filter((estimate) => estimate.status === EstimateStatus.DRAFT).length;
  const readyForInvoiceCount = filteredEstimates.filter(
    (estimate) =>
      estimate.status === EstimateStatus.APPROVED &&
      estimate._count.purchaseOrders > 0 &&
      estimate._count.invoices === 0
  ).length;
  const hasActiveFilters = Boolean(query || status || workflow !== 'all' || sort !== 'updated-desc');

  return (
    <>
      <PageHeader
        title="Estimates"
        subtitle={`Quotes and jobs for ${me.tenant.name}. ${filteredEstimates.length} showing.`}
        actions={
          hasClients > 0 ? (
            <Link
              href="/estimates/new"
              className="inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm transition-colors hover:opacity-90"
            >
              New estimate
            </Link>
          ) : (
            <Link
              href="/clients/new"
              className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
            >
              Add client first
            </Link>
          )
        }
      />

      <section className="mb-5 overflow-hidden rounded-[22px] border border-white/70 bg-white/85 shadow-[0_18px_60px_-38px_rgba(15,23,42,0.45)] ring-1 ring-slate-900/[0.04]">
        <div className="border-b border-slate-100 bg-gradient-to-br from-white via-blue-50/70 to-emerald-50/70 px-5 py-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <MetricCard label="Visible value" value={formatMoney(totalSellCents)} tone="blue" />
            <MetricCard label="Approved" value={approvedCount.toLocaleString()} tone="emerald" />
            <MetricCard label="Drafts" value={draftCount.toLocaleString()} tone="slate" />
            <MetricCard label="Ready invoice" value={readyForInvoiceCount.toLocaleString()} tone="violet" />
          </div>
        </div>

        <form className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(260px,1fr)_180px_190px_180px_auto] lg:items-end">
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
              <input
                name="q"
                defaultValue={query}
                placeholder="Search by estimate, job, or client..."
                className="h-11 w-full rounded-[14px] border border-slate-200 bg-white pl-10 pr-3 text-[13px] font-medium text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
              />
            </span>
          </label>

          <FilterSelect name="status" label="Status" value={status ?? 'all'} options={STATUS_FILTERS} />
          <FilterSelect name="workflow" label="Workflow" value={workflow} options={WORKFLOW_FILTERS} />
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
                href="/estimates"
                className="inline-flex h-11 items-center justify-center rounded-[14px] border border-slate-200 bg-white px-4 text-[13px] font-bold text-slate-600 shadow-sm hover:bg-slate-50"
              >
                Reset
              </Link>
            ) : null}
          </div>
        </form>
      </section>

      {estimates.length === 0 ? (
        <EmptyState
          title="No estimates yet"
          description={
            hasClients > 0 ? (
              <>
                Start with job info, then add catalog items or pricing-helper lines in the editor.
              </>
            ) : (
              <>
                Add a{' '}
                <Link href="/clients/new" className="font-medium text-[var(--color-bv-accent)] underline-offset-2 hover:underline">
                  client
                </Link>{' '}
                first — every estimate belongs to a customer.
              </>
            )
          }
          primaryAction={
            hasClients > 0
              ? { label: 'New estimate', href: '/estimates/new' }
              : { label: 'Create client', href: '/clients/new' }
          }
        />
      ) : filteredEstimates.length === 0 ? (
        <EmptyState
          title="No estimates match"
          description="Adjust the search or filters to bring estimates back into view."
          primaryAction={{ label: 'Clear filters', href: '/estimates' }}
        />
      ) : (
        <section className="flex max-h-[calc(100vh-340px)] min-h-[320px] flex-col overflow-hidden rounded-[22px] border border-white/70 bg-white/95 shadow-[0_20px_70px_-42px_rgba(15,23,42,0.55)] ring-1 ring-slate-900/[0.04]">
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-[14px] font-black uppercase tracking-[0.12em] text-slate-950">
                Estimates
              </h2>
              <p className="mt-1 text-[12px] text-slate-500">
                {filteredEstimates.length} result{filteredEstimates.length === 1 ? '' : 's'} found
              </p>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-[10.5px] uppercase tracking-[0.14em] text-slate-400">
                  <th className="px-5 py-3 font-black">Job</th>
                  <th className="px-4 py-3 font-black">Client</th>
                  <th className="px-4 py-3 font-black">Workflow</th>
                  <th className="px-4 py-3 font-black">Status</th>
                  <th className="px-4 py-3 text-right font-black">Sell</th>
                  <th className="px-4 py-3 font-black">Next</th>
                  <th className="px-5 py-3 text-right font-black">Quick</th>
                </tr>
              </thead>
              <tbody>
                {filteredEstimates.map((e) => {
                  const hasPo = e._count.purchaseOrders > 0;
                  const hasInvoice = e._count.invoices > 0;
                  const next = getEstimateListNextAction({
                    id: e.id,
                    status: e.status,
                    lineCount: e._count.lines,
                    hasLinkedPo: hasPo,
                    hasLinkedInvoice: hasInvoice,
                  });
                  const chips = getEstimateListWorkflowChips({
                    status: e.status,
                    hasLinkedPo: hasPo,
                    hasLinkedInvoice: hasInvoice,
                  });
                  return (
                    <tr
                      key={e.id}
                      className="group border-b border-slate-100 transition-colors last:border-b-0 hover:bg-blue-50/35"
                    >
                      <td className="px-5 py-4">
                        <Link
                          href={`/estimates/${e.id}` as never}
                          className="group/job block hover:text-blue-600"
                        >
                          <span className="font-mono text-[11px] font-bold text-slate-400">{e.number}</span>
                          <span className="mt-1 block text-[14px] font-black leading-tight text-slate-950 group-hover/job:text-blue-600">{e.title}</span>
                          <span className="mt-1 block text-[11.5px] font-medium text-slate-400">
                            Updated {formatDate(e.updatedAt)}
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-4 font-semibold text-slate-600">{e.client.companyName}</td>
                      <td className="px-4 py-4">
                        <WorkflowChips chips={chips} />
                      </td>
                      <td className="px-4 py-4">
                        <StatusPill status={e.status} />
                      </td>
                      <td className="px-4 py-4 text-right text-[13.5px] font-black tabular-nums text-slate-950">
                        {formatMoney(e.finalPriceCents)}
                      </td>
                      <td className="px-4 py-4">
                        <Link
                          href={next.href as never}
                          title={next.label}
                          className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-bold transition ${
                            next.tone === 'primary'
                              ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                              : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                          }`}
                        >
                          {next.label}
                          {next.tone === 'primary' ? (
                            <span aria-hidden className="text-[11px]">
                              →
                            </span>
                          ) : null}
                        </Link>
                      </td>
                      <td className="px-5 py-4">
                        <QuickActions
                          id={e.id}
                          status={e.status}
                          hasPo={hasPo}
                          hasInvoice={hasInvoice}
                        />
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

function QuickActions({
  id,
  status,
  hasPo,
  hasInvoice,
}: {
  id: string;
  status: EstimateStatus;
  hasPo: boolean;
  hasInvoice: boolean;
}) {
  const base = `/estimates/${id}`;
  const links: { label: string; href: string }[] = [];

  if (status === EstimateStatus.DRAFT || status === EstimateStatus.REJECTED) {
    links.push({ label: 'Edit', href: base });
  }
  if (status !== EstimateStatus.FINALIZED) {
    links.push({ label: 'Quote', href: `${base}/preview` });
  }
  if (status === EstimateStatus.APPROVED && !hasPo) {
    links.push({ label: 'PO', href: `${base}#estimate-create-po` });
  }
  if (status === EstimateStatus.APPROVED && hasPo && !hasInvoice) {
    links.push({ label: 'Invoice', href: `${base}#estimate-linked-invoice` });
  }

  return (
    <div className="flex flex-wrap justify-end gap-x-2 gap-y-0.5">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href as never}
          className="text-[11.5px] font-bold text-slate-400 hover:text-blue-600 hover:underline"
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}

const CHIP_TONE: Record<
  ReturnType<typeof getEstimateListWorkflowChips>[number]['tone'],
  string
> = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-700',
  action: 'border-sky-200 bg-sky-50 text-sky-900',
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  muted: 'border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[var(--color-bv-muted)]',
};

function WorkflowChips({
  chips,
}: {
  chips: ReturnType<typeof getEstimateListWorkflowChips>;
}) {
  if (chips.length === 0) return <span className="text-[12px] text-[var(--color-bv-muted)]">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <span
          key={c.label}
          title={c.label}
          className={`inline-flex max-w-[148px] items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-snug ${CHIP_TONE[c.tone]}`}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: EstimateStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-medium ${STATUS_TONE[status]}`}
    >
      {labelEstimateStatus(status)}
    </span>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'blue' | 'emerald' | 'slate' | 'violet';
}) {
  const toneClass = {
    blue: 'from-blue-600/10 to-indigo-500/10 text-blue-700 ring-blue-500/15',
    emerald: 'from-emerald-600/10 to-teal-500/10 text-emerald-700 ring-emerald-500/15',
    slate: 'from-slate-600/10 to-slate-400/10 text-slate-700 ring-slate-500/15',
    violet: 'from-violet-600/10 to-fuchsia-500/10 text-violet-700 ring-violet-500/15',
  }[tone];

  return (
    <div className={`rounded-[18px] bg-gradient-to-br px-4 py-3 ring-1 ${toneClass}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.13em] opacity-70">{label}</p>
      <p className="mt-2 text-[20px] font-black leading-none tracking-[-0.02em]">{value}</p>
    </div>
  );
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
      <select
        name={name}
        defaultValue={value}
        className="h-11 rounded-[14px] border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-700 shadow-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function normalizeStatus(value: string): EstimateStatus | null {
  if (!value || value === 'all') return null;
  return Object.values(EstimateStatus).includes(value as EstimateStatus)
    ? (value as EstimateStatus)
    : null;
}

function normalizeWorkflow(value: string): (typeof WORKFLOW_FILTERS)[number]['value'] {
  return WORKFLOW_FILTERS.some((filter) => filter.value === value)
    ? (value as (typeof WORKFLOW_FILTERS)[number]['value'])
    : 'all';
}

function normalizeSort(value: string): (typeof SORT_OPTIONS)[number]['value'] {
  return SORT_OPTIONS.some((option) => option.value === value)
    ? (value as (typeof SORT_OPTIONS)[number]['value'])
    : 'updated-desc';
}

function orderByForSort(sort: (typeof SORT_OPTIONS)[number]['value']): Prisma.EstimateOrderByWithRelationInput[] {
  switch (sort) {
    case 'sell-desc':
      return [{ finalPriceCents: 'desc' }, { updatedAt: 'desc' }];
    case 'sell-asc':
      return [{ finalPriceCents: 'asc' }, { updatedAt: 'desc' }];
    case 'title-asc':
      return [{ title: 'asc' }, { updatedAt: 'desc' }];
    case 'updated-desc':
    default:
      return [{ updatedAt: 'desc' }];
  }
}

function matchesWorkflowFilter(
  estimate: {
    status: EstimateStatus;
    _count: { lines: number; purchaseOrders: number; invoices: number };
  },
  workflow: (typeof WORKFLOW_FILTERS)[number]['value'],
): boolean {
  const hasPo = estimate._count.purchaseOrders > 0;
  const hasInvoice = estimate._count.invoices > 0;

  switch (workflow) {
    case 'needs-lines':
      return estimate._count.lines === 0;
    case 'ready-po':
      return estimate.status === EstimateStatus.APPROVED && !hasPo;
    case 'ready-invoice':
      return estimate.status === EstimateStatus.APPROVED && hasPo && !hasInvoice;
    case 'complete':
      return estimate.status === EstimateStatus.FINALIZED || hasInvoice;
    case 'all':
    default:
      return true;
  }
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(value);
}
