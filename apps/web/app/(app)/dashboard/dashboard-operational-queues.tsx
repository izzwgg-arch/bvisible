import Link from 'next/link';

import type {
  OperationalQueueFilter,
  OperationalQueueItem,
  OperationalWorkflowQueues,
} from '@/lib/workflow/get-operational-workflow-queues';
import {
  OPERATIONAL_QUEUE_BUCKET_LABELS,
  OPERATIONAL_QUEUE_BUCKET_ORDER,
  type OperationalQueueBucket,
} from '@/lib/workflow/operational-matrix';
import { WORKFLOW_STATE_LABELS } from '@/lib/workflow/operational-state';

const FILTER_OPTIONS: { key: OperationalQueueFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'stale', label: 'Stale' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'unresolved', label: 'Unresolved' },
  { key: 'mine', label: 'Mine' },
];

export function DashboardOperationalQueues({
  queues,
  activeFilter,
  showOperatorQueues,
}: {
  queues: OperationalWorkflowQueues;
  activeFilter: OperationalQueueFilter;
  showOperatorQueues: boolean;
}) {
  const buckets = OPERATIONAL_QUEUE_BUCKET_ORDER.filter((b) => {
    if (!showOperatorQueues) {
      return (
        b !== 'ocr_review' &&
        b !== 'reconciliation_variance' &&
        b !== 'unmatched_email'
      );
    }
    return true;
  });

  const hasRows = buckets.some((b) => queues.sections[b].length > 0);

  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-bv-muted)]">
            Operational queues
          </h2>
          <p className="mt-1 text-[13px] text-[var(--color-bv-muted)]">
            {queues.totalActionable > 0
              ? `${queues.totalActionable} item${queues.totalActionable === 1 ? '' : 's'} need a clear next step.`
              : 'Queues are clear — check recently completed below.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTER_OPTIONS.map((f) => (
            <Link
              key={f.key}
              href={filterHref(f.key)}
              className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                activeFilter === f.key
                  ? 'bg-[var(--color-bv-accent)] text-[var(--color-bv-accent-foreground)]'
                  : 'border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] text-[var(--color-bv-muted)] hover:bg-[var(--color-bv-bg)]'
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      {!hasRows ? (
        <QueueEmptyState />
      ) : (
        <div className="flex flex-col gap-8">
          {buckets.map((bucket) => {
            const rows = queues.sections[bucket];
            if (rows.length === 0) return null;
            return <QueueSection key={bucket} bucket={bucket} rows={rows} />;
          })}
        </div>
      )}
    </section>
  );
}

function QueueEmptyState() {
  return (
    <div className="rounded-[var(--radius-bv)] border border-dashed border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-5 py-10 text-center text-[13px] text-[var(--color-bv-muted)] shadow-[var(--shadow-bv-card)]">
      No queue items match this filter. Try <strong>All</strong> or clear filters.
    </div>
  );
}

function QueueSection({
  bucket,
  rows,
}: {
  bucket: OperationalQueueBucket;
  rows: OperationalQueueItem[];
}) {
  return (
    <div>
      <h3 className="mb-2 text-[12px] font-semibold text-[var(--color-bv-text)]">
        {OPERATIONAL_QUEUE_BUCKET_LABELS[bucket]}
        <span className="ml-2 font-normal tabular-nums text-[var(--color-bv-muted)]">
          ({rows.length})
        </span>
      </h3>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={row.id}>
            <QueueRow row={row} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function QueueRow({ row }: { row: OperationalQueueItem }) {
  return (
    <Link
      href={row.href as never}
      className="group flex items-center gap-3 rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-2.5 shadow-[var(--shadow-bv-card)] transition-colors hover:bg-[var(--color-bv-bg)]"
    >
      <div className="min-w-0 flex-1">
        <span className="font-mono text-[13px] font-semibold text-[var(--color-bv-accent)]">
          {row.title}
        </span>
        <p className="mt-0.5 truncate text-[12px] text-[var(--color-bv-muted)]">
          {row.subtitle}
          {row.customerLabel ? ` · ${row.customerLabel}` : ''}
        </p>
        <p className="mt-1 line-clamp-1 text-[11.5px] leading-snug text-[var(--color-bv-muted)]">
          {row.blockerReason}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {row.staleLabel ? (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-amber-950">
            Stale {row.staleLabel}
          </span>
        ) : null}
        <span className="rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-bv-text)]">
          {row.workflowStateLabel ?? WORKFLOW_STATE_LABELS[row.workflowState]}
        </span>
        <span className="text-[11.5px] font-medium text-[var(--color-bv-accent)] group-hover:underline">
          {row.nextActionLabel} →
        </span>
      </div>
    </Link>
  );
}

function filterHref(filter: OperationalQueueFilter): string {
  if (filter === 'all') return '/dashboard';
  return `/dashboard?queue=${filter}`;
}
