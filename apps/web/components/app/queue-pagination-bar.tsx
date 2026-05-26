import Link from 'next/link';
import { formatQueueShowingLabel } from '@/lib/ui/queue-pagination';

export function QueuePaginationBar({
  loaded,
  total,
  hasMore,
  loadMoreHref,
  suffix,
}: {
  loaded: number;
  total?: number | null;
  hasMore: boolean;
  loadMoreHref: string;
  suffix?: string;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
      <p className="text-[11px] text-[var(--color-bv-muted)]">
        {formatQueueShowingLabel({ loaded, total, suffix })}
      </p>
      {hasMore ? (
        <Link
          href={loadMoreHref}
          className="inline-flex items-center justify-center rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-0.5 text-[11px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
        >
          Load more
        </Link>
      ) : null}
    </div>
  );
}
