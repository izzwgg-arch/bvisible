import Link from 'next/link';
import type { ReactNode } from 'react';

/** Shared dense queue row for operational + PO lifecycle dashboards (display only). */
export function DashboardQueueRow({
  href,
  primary,
  secondary,
  blocker,
  staleLabel,
  statusLabel,
  nextActionLabel,
  priority = 'normal',
}: {
  href: string;
  primary: string;
  secondary: string;
  blocker: string;
  staleLabel: string | null;
  statusLabel: string;
  nextActionLabel: string;
  priority?: 'high' | 'normal';
}) {
  const priorityRing =
    priority === 'high'
      ? 'border-amber-400/70 bg-amber-50/90'
      : 'border-[var(--color-bv-border)] bg-[var(--color-bv-surface)]';

  return (
    <Link
      href={href as never}
      className={`group grid gap-2 rounded-[8px] border px-2.5 py-2 shadow-[var(--shadow-bv-card)] transition-colors hover:bg-[var(--color-bv-bg)] sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-3 ${priorityRing}`}
    >
      <div className="min-w-0">
        <span className="font-mono text-[12.5px] font-semibold text-[var(--color-bv-accent)]">
          {primary}
        </span>
        <p className="truncate text-[11.5px] text-[var(--color-bv-muted)]">{secondary}</p>
        <p className="mt-0.5 line-clamp-1 text-[11px] leading-snug text-[var(--color-bv-muted)]">
          {blocker}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1 sm:justify-end">
        {staleLabel ? <QueueBadge tone="stale">Stale {staleLabel}</QueueBadge> : null}
        <QueueBadge tone="neutral">{statusLabel}</QueueBadge>
      </div>
      <span className="text-[11.5px] font-medium text-[var(--color-bv-accent)] sm:text-right group-hover:underline">
        {nextActionLabel} →
      </span>
    </Link>
  );
}

function QueueBadge({
  tone,
  children,
}: {
  tone: 'stale' | 'neutral';
  children: ReactNode;
}) {
  const cls =
    tone === 'stale'
      ? 'border-amber-300/80 bg-amber-100 text-amber-950'
      : 'border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[var(--color-bv-text)]';

  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums ${cls}`}
    >
      {children}
    </span>
  );
}

export function sortQueueRowsByPriority<
  T extends { staleLabel?: string | null; isBlocked?: boolean; isStale?: boolean },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const score = (r: T) => {
      const blocked = 'isBlocked' in r && r.isBlocked ? 4 : 0;
      const stale =
        ('isStale' in r && r.isStale) || (r.staleLabel != null && r.staleLabel !== '')
          ? 2
          : 0;
      return blocked + stale;
    };
    return score(b) - score(a);
  });
}
