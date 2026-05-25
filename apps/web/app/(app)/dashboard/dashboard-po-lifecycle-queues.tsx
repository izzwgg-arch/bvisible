import type {
  PoLifecycleDashboardQueues,
  PoLifecycleQueueRow,
} from '@/lib/po/get-po-lifecycle-dashboard-queues';
import {
  PO_LIFECYCLE_QUEUE_LABELS,
  type PoLifecycleQueueBucket,
} from '@/lib/po/po-lifecycle-matrix';
import { DashboardQueueRow, sortQueueRowsByPriority } from './dashboard-queue-row';

const BUCKET_ORDER: PoLifecycleQueueBucket[] = [
  'blocked_backordered',
  'variance_detected',
  'waiting_vendor_ack',
  'waiting_shipment_receipt',
  'partial_receipt',
  'ready_to_finalize',
];

export function DashboardPoLifecycleQueues({
  queues,
}: {
  queues: PoLifecycleDashboardQueues;
}) {
  const hasRows = BUCKET_ORDER.some((b) => queues.sections[b].length > 0);
  if (!hasRows) return null;

  return (
    <div>
      <p className="mb-2 text-[12px] text-[var(--color-bv-muted)]">
        {queues.totalActionable > 0
          ? `${queues.totalActionable} on vendor order ladder`
          : 'No open lifecycle items'}
      </p>
      <div className="flex flex-col gap-4">
        {BUCKET_ORDER.map((bucket) => {
          const rows = sortQueueRowsByPriority(queues.sections[bucket]);
          if (rows.length === 0) return null;
          return <QueueBucketSection key={bucket} bucket={bucket} rows={rows} />;
        })}
      </div>
    </div>
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
      <h3 className="mb-1.5 flex items-baseline gap-2 text-[11.5px] font-semibold text-[var(--color-bv-text)]">
        {PO_LIFECYCLE_QUEUE_LABELS[bucket]}
        <span className="font-normal tabular-nums text-[var(--color-bv-muted)]">
          {rows.length}
        </span>
      </h3>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.id}>
            <DashboardQueueRow
              href={row.href}
              primary={row.poNumber}
              secondary={`${row.vendorName ?? 'No vendor'}${row.customerLabel ? ` · ${row.customerLabel}` : ''}`}
              blocker={row.blockerReason}
              staleLabel={row.staleLabel}
              statusLabel={row.lifecycleLabel}
              nextActionLabel={row.nextActionLabel}
              priority={row.staleLabel ? 'high' : 'normal'}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
