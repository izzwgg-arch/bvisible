import Link from 'next/link';

import type { PoLifecycleDashboardQueues } from '@/lib/po/get-po-lifecycle-dashboard-queues';
import type {
  OperationalQueueFilter,
  OperationalWorkflowQueues,
} from '@/lib/workflow/get-operational-workflow-queues';
import { OPERATIONAL_QUEUE_BUCKET_ORDER } from '@/lib/workflow/operational-matrix';

export type DashboardCommandCounts = {
  operationalActionable: number;
  operationalBlocked: number;
  operationalStale: number;
  operationalUnresolved: number;
  poLifecycleActionable: number;
  poLifecycleStale: number;
};

export function summarizeDashboardQueues(
  operational: OperationalWorkflowQueues | null,
  poLifecycle: PoLifecycleDashboardQueues | null,
): DashboardCommandCounts {
  let operationalBlocked = 0;
  let operationalStale = 0;
  let operationalUnresolved = 0;

  if (operational) {
    for (const bucket of OPERATIONAL_QUEUE_BUCKET_ORDER) {
      if (bucket === 'recently_completed') continue;
      for (const row of operational.sections[bucket]) {
        if (row.isBlocked) operationalBlocked += 1;
        if (row.isStale) operationalStale += 1;
        if (row.isUnresolved) operationalUnresolved += 1;
      }
    }
  }

  let poLifecycleStale = 0;
  if (poLifecycle) {
    for (const rows of Object.values(poLifecycle.sections)) {
      for (const row of rows) {
        if (row.staleLabel) poLifecycleStale += 1;
      }
    }
  }

  return {
    operationalActionable: operational?.totalActionable ?? 0,
    operationalBlocked,
    operationalStale,
    operationalUnresolved,
    poLifecycleActionable: poLifecycle?.totalActionable ?? 0,
    poLifecycleStale,
  };
}

export function DashboardCommandSummary({
  counts,
  activeFilter,
  showPoLifecycle,
}: {
  counts: DashboardCommandCounts;
  activeFilter: OperationalQueueFilter;
  showPoLifecycle: boolean;
}) {
  const needsAttention =
    counts.operationalBlocked +
    counts.operationalStale +
    counts.operationalUnresolved +
    counts.poLifecycleStale;

  const totalWork =
    counts.operationalActionable +
    (showPoLifecycle ? counts.poLifecycleActionable : 0);

  return (
    <section
      className="dashboard-ops-zone mb-6 rounded-[var(--radius-bv)] border border-slate-700/40 bg-slate-900 px-4 py-3.5 shadow-[var(--shadow-bv-elevated)] sm:px-5"
      aria-label="Operations command summary"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            Command center
          </p>
          <p className="mt-0.5 text-[15px] font-semibold tracking-tight text-slate-50">
            {totalWork > 0
              ? `${totalWork} open work item${totalWork === 1 ? '' : 's'} across queues`
              : 'Queues clear — scan completed work below'}
          </p>
          {needsAttention > 0 ? (
            <p className="mt-1 text-[12.5px] text-slate-300">
              {needsAttention} need operator attention (blocked, stale, or unresolved)
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <SummaryChip
            label="Actionable"
            value={counts.operationalActionable}
            href="/dashboard"
            active={activeFilter === 'all'}
            tone="accent"
          />
          <SummaryChip
            label="Blocked"
            value={counts.operationalBlocked}
            href="/dashboard?queue=blocked"
            active={activeFilter === 'blocked'}
            tone={counts.operationalBlocked > 0 ? 'warn' : 'muted'}
          />
          <SummaryChip
            label="Stale"
            value={counts.operationalStale + counts.poLifecycleStale}
            href="/dashboard?queue=stale"
            active={activeFilter === 'stale'}
            tone={
              counts.operationalStale + counts.poLifecycleStale > 0 ? 'warn' : 'muted'
            }
          />
          <SummaryChip
            label="Unresolved"
            value={counts.operationalUnresolved}
            href="/dashboard?queue=unresolved"
            active={activeFilter === 'unresolved'}
            tone={counts.operationalUnresolved > 0 ? 'warn' : 'muted'}
          />
          {showPoLifecycle && counts.poLifecycleActionable > 0 ? (
            <span className="inline-flex items-center rounded-full border border-slate-600 bg-slate-800/80 px-3 py-1 text-[11.5px] font-medium tabular-nums text-slate-200">
              {counts.poLifecycleActionable} on PO ladder
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function SummaryChip({
  label,
  value,
  href,
  active,
  tone,
}: {
  label: string;
  value: number;
  href: string;
  active: boolean;
  tone: 'accent' | 'warn' | 'muted';
}) {
  const toneClass =
    tone === 'warn' && value > 0
      ? 'border-amber-500/50 bg-amber-950/40 text-amber-100'
      : tone === 'accent' && active
        ? 'border-[var(--color-bv-accent)] bg-[var(--color-bv-accent)] text-white'
        : active
          ? 'border-slate-500 bg-slate-700 text-slate-50'
          : 'border-slate-600 bg-slate-800/60 text-slate-200 hover:bg-slate-700/80';

  return (
    <Link
      href={href as never}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${toneClass}`}
    >
      <span>{label}</span>
      <span className="tabular-nums font-semibold">{value}</span>
    </Link>
  );
}
