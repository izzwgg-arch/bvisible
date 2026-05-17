import Link from 'next/link';

import type {
  PoLifecycleDashboardQueues,
  PoLifecycleQueueRow,
} from '@/lib/po/get-po-lifecycle-dashboard-queues';
import {
  PO_LIFECYCLE_QUEUE_LABELS,
  type PoLifecycleQueueBucket,
} from '@/lib/po/po-lifecycle-matrix';

const BUCKET_ORDER: PoLifecycleQueueBucket[] = [
  'waiting_vendor_ack',
  'waiting_shipment_receipt',
  'partial_receipt',
  'variance_detected',
  'ready_to_finalize',
  'blocked_backordered',
];

export function DashboardPoLifecycleQueues({
  queues,
}: {
  queues: PoLifecycleDashboardQueues;
}) {
  const hasRows = BUCKET_ORDER.some((b) => queues.sections[b].length > 0);
  if (!hasRows) return null;

  return (
    <section className="mb-10">
      <div className="mb-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-bv-muted)]">
          PO vendor lifecycle
        </h2>
        <p className="mt-1 text-[13px] text-[var(--color-bv-muted)]">
          {queues.totalActionable > 0
            ? `${queues.totalActionable} open PO${queues.totalActionable === 1 ? '' : 's'} on the vendor order ladder.`
            : 'No open lifecycle items.'}
        </p>
      </div>
      <div className="flex flex-col gap-8">
        {BUCKET_ORDER.map((bucket) => {
          const rows = queues.sections[bucket];
          if (rows.length === 0) return null;
          return <QueueBucketSection key={bucket} bucket={bucket} rows={rows} />;
        })}
      </div>
    </section>
  );
}

function QueueBucketSection({
  bucket,
  rows,
}: {
  bucket: PoLifecycleQueueBucket;
  rows: PoLifecycleQueueRow[];
}) {
  return (
    <div>
      <h3 className="mb-2 text-[12px] font-semibold text-[var(--color-bv-text)]">
        {PO_LIFECYCLE_QUEUE_LABELS[bucket]}
        <span className="ml-2 font-normal tabular-nums text-[var(--color-bv-muted)]">
          ({rows.length})
        </span>
      </h3>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={row.id}>
            <PoLifecycleQueueRowLink row={row} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PoLifecycleQueueRowLink({ row }: { row: PoLifecycleQueueRow }) {
  return (
    <Link
      href={row.href as never}
      className="group flex items-center gap-3 rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-2.5 shadow-[var(--shadow-bv-card)] transition-colors hover:bg-[var(--color-bv-bg)]"
    >
      <div className="min-w-0 flex-1">
        <span className="font-mono text-[13px] font-semibold text-[var(--color-bv-accent)]">
          {row.poNumber}
        </span>
        <p className="mt-0.5 truncate text-[12px] text-[var(--color-bv-muted)]">
          {row.vendorName ?? 'No vendor'}
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
          {row.lifecycleLabel}
        </span>
        <span className="text-[11.5px] font-medium text-[var(--color-bv-accent)] group-hover:underline">
          {row.nextActionLabel} →
        </span>
      </div>
    </Link>
  );
}
