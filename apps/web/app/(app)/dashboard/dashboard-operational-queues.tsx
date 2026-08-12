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
import { DASHBOARD_QUEUE_PREVIEW_LIMIT } from '@/lib/ui/queue-pagination';
import { DashboardQueueRow, sortQueueRowsByPriority } from './dashboard-queue-row';

const FULL_QUEUE_HREF: Partial<Record<OperationalQueueBucket, string>> = {
  ocr_review: '/admin/ocr-review?status=review',
  reconciliation_variance: '/admin/reconciliation',
  unmatched_email: '/admin/email-ingestion?filter=unmatched',
};

const FILTER_OPTIONS: { key: OperationalQueueFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'stale', label: 'Stale' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'unresolved', label: 'Unresolved' },
  { key: 'mine', label: 'Mine' },
];

const PRIORITY_BUCKETS: OperationalQueueBucket[] = [
  'ocr_review',
  'reconciliation_variance',
  'unmatched_email',
  'approved_waiting_po',
  'waiting_vendor_reply',
  'awaiting_customer',
  'ready_to_finalize',
  'recently_completed',
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
  const buckets = PRIORITY_BUCKETS.filter((b) => {
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
  const blockerRows = collectPriorityRows(queues, buckets);

  return (
    <div>
      <div className="sticky top-0 z-20 -mx-1 mb-3 flex flex-col gap-2 rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)]/95 px-1 py-2 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="px-2 text-[12px] text-[var(--color-bv-muted)]">
          {queues.totalActionable > 0
            ? `${queues.totalActionable} need a next step`
            : 'Clear — see recently completed'}
        </p>
        <div className="flex flex-wrap gap-1 px-1">
          {FILTER_OPTIONS.map((f) => (
            <Link
              key={f.key}
              href={filterHref(f.key)}
              className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-medium transition-colors ${
                activeFilter === f.key
                  ? 'bg-[var(--color-bv-accent)] text-[var(--color-bv-accent-foreground)]'
                  : 'border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[var(--color-bv-muted)] hover:bg-[var(--color-bv-surface)]'
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
        <div className="flex flex-col gap-4">
          {activeFilter === 'all' && blockerRows.length > 0 ? (
            <NeedsOperatorRail rows={blockerRows} />
          ) : null}
          {buckets.map((bucket) => {
            const rows = sortQueueRowsByPriority(queues.sections[bucket]);
            if (rows.length === 0) return null;
            return <QueueSection key={bucket} bucket={bucket} rows={rows} />;
          })}
        </div>
      )}
    </div>
  );
}

function collectPriorityRows(
  queues: OperationalWorkflowQueues,
  buckets: OperationalQueueBucket[],
): OperationalQueueItem[] {
  const out: OperationalQueueItem[] = [];
  for (const bucket of buckets) {
    if (bucket === 'recently_completed') continue;
    for (const row of queues.sections[bucket]) {
      if (row.isBlocked || row.isStale || row.isUnresolved) out.push(row);
    }
  }
  return sortQueueRowsByPriority(out).slice(0, 8);
}

function NeedsOperatorRail({ rows }: { rows: OperationalQueueItem[] }) {
  return (
    <div className="rounded-[10px] border border-amber-300/60 bg-amber-50/40 px-3 py-2.5">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-950">
        Needs operator ({rows.length})
      </h3>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={`priority-${row.id}`}>
            <OperationalQueueRowLink row={row} priority="high" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function QueueEmptyState() {
  return (
    <div className="rounded-[var(--radius-bv)] border border-dashed border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-8 text-center text-[12.5px] text-[var(--color-bv-muted)]">
      No queue items match this filter. Try <strong>All</strong>.
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
  const fullHref = FULL_QUEUE_HREF[bucket];
  const atPreviewCap = rows.length >= DASHBOARD_QUEUE_PREVIEW_LIMIT;

  return (
    <div>
      <h3 className="mb-1.5 flex flex-wrap items-baseline gap-2 text-[11.5px] font-semibold text-[var(--color-bv-text)]">
        {OPERATIONAL_QUEUE_BUCKET_LABELS[bucket]}
        <span className="font-normal tabular-nums text-[var(--color-bv-muted)]">
          {rows.length}
          {atPreviewCap ? '+' : ''}
        </span>
        {fullHref ? (
          <Link
            href={fullHref}
            className="text-[10.5px] font-medium text-[var(--color-bv-accent)] underline-offset-2 hover:underline"
          >
            {atPreviewCap ? 'Full queue →' : 'Open queue →'}
          </Link>
        ) : null}
      </h3>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.id}>
            <OperationalQueueRowLink
              row={row}
              priority={row.isBlocked || row.isStale ? 'high' : 'normal'}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function OperationalQueueRowLink({
  row,
  priority,
}: {
  row: OperationalQueueItem;
  priority: 'high' | 'normal';
}) {
  return (
    <DashboardQueueRow
      href={row.href}
      primary={row.title}
      secondary={`${row.subtitle}${row.customerLabel ? ` · ${row.customerLabel}` : ''}`}
      blocker={row.blockerReason}
      staleLabel={row.staleLabel}
      statusLabel={row.workflowStateLabel ?? WORKFLOW_STATE_LABELS[row.workflowState]}
      nextActionLabel={row.nextActionLabel}
      priority={priority}
    />
  );
}

function filterHref(filter: OperationalQueueFilter): string {
  if (filter === 'all') return '/dashboard';
  return `/dashboard?queue=${filter}`;
}
