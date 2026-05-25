import Link from 'next/link';
import type { ReactNode } from 'react';
import { EstimateStatus, POStatus, Role } from '@bvisible/db';
import type { DashboardAuditRow, DashboardMetrics } from '@/lib/dashboard/get-dashboard-metrics';
import type { AttentionFeedKind, DashboardOperationalFeed } from '@/lib/dashboard/get-dashboard-feed';
import { labelEstimateStatus, labelPoStatus } from '@/lib/ui/status-labels';

export function DashboardOperationalSections({
  feed,
  showAttention = true,
}: {
  feed: DashboardOperationalFeed;
  showAttention?: boolean;
}) {
  return (
    <details className="group mb-6 rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
      <summary className="cursor-pointer list-none px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-bv-muted)] marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          Recent records
          <span className="rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-[var(--color-bv-muted)]">
            {feed.recentEstimates.length + feed.recentPurchaseOrders.length} rows
          </span>
        </span>
      </summary>
      <div className="grid gap-4 border-t border-[var(--color-bv-border)] px-4 pb-4 pt-3 xl:grid-cols-2">
      <section>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
          Estimates
        </h3>
        {feed.recentEstimates.length === 0 ? (
          <EmptyRail>No estimates yet.</EmptyRail>
        ) : (
          <ul className="flex flex-col gap-1">
            {feed.recentEstimates.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/estimates/${e.id}` as never}
                  className="flex items-start justify-between gap-2 rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 transition-colors hover:bg-[var(--color-bv-surface)]"
                >
                  <div className="min-w-0">
                    <span className="font-mono text-[13px] font-semibold text-[var(--color-bv-accent)]">
                      {e.number}
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-[var(--color-bv-text)]">{e.title}</span>
                  </div>
                  <span className="shrink-0 rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-bv-muted)]">
                    {labelEstimateStatus(e.status as EstimateStatus)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
          Purchase orders
        </h3>
        {feed.recentPurchaseOrders.length === 0 ? (
          <EmptyRail>No purchase orders yet.</EmptyRail>
        ) : (
          <ul className="flex flex-col gap-1">
            {feed.recentPurchaseOrders.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/purchase-orders/${p.id}` as never}
                  className="flex items-start justify-between gap-2 rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 transition-colors hover:bg-[var(--color-bv-surface)]"
                >
                  <div className="min-w-0">
                    <span className="font-mono text-[13px] font-semibold text-[var(--color-bv-accent)]">
                      {p.number}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-[var(--color-bv-muted)]">
                      {p.vendorName ?? 'No vendor'}
                    </span>
                  </div>
                  <span className="shrink-0 rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-bv-muted)]">
                    {labelPoStatus(p.status as POStatus)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showAttention ? (
      <section className="xl:col-span-2">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-bv-muted)]">
          Operational attention
        </h2>
        {feed.attentionItems.length === 0 ? (
          <EmptyRail>Nothing needs attention in your queues right now.</EmptyRail>
        ) : (
          <ul className="flex flex-col gap-2">
            {feed.attentionItems.map((item, idx) => (
              <li key={`${item.kind}-${idx}-${item.href}`}>
                <Link
                  href={item.href as never}
                  className="block rounded-[10px] border border-amber-200/90 bg-amber-50/50 px-4 py-3 shadow-[var(--shadow-bv-card)] transition-colors hover:bg-amber-50"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[13.5px] font-semibold text-amber-950">{item.title}</span>
                    <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
                      {attentionKindLabel(item.kind)}
                    </span>
                  </div>
                  {item.subtitle ? (
                    <p className="mt-1 text-[12.5px] leading-snug text-amber-950/85">{item.subtitle}</p>
                  ) : null}
                  <time
                    dateTime={item.createdAt.toISOString()}
                    className="mt-2 block text-[11px] text-amber-900/70 tabular-nums"
                  >
                    {formatShortTime(item.createdAt)}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      ) : null}
      </div>
    </details>
  );
}

function attentionKindLabel(kind: AttentionFeedKind): string {
  switch (kind) {
    case 'spend':
      return 'Spend';
    case 'vendor_price':
      return 'Pricing';
    case 'ocr_queue':
      return 'OCR';
    case 'email_inbox':
      return 'Inbox';
    case 'recon_run_needed':
      return 'Reconcile';
    case 'reconciled_recent':
      return 'Reconciled';
    default:
      return 'Ops';
  }
}

function EmptyRail({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-bv)] border border-dashed border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-8 text-center text-[13px] text-[var(--color-bv-muted)] shadow-[var(--shadow-bv-card)]">
      {children}
    </div>
  );
}

export function DashboardQuickActions({
  role,
  hasClients,
}: {
  role: Role;
  hasClients: boolean;
}) {
  const isAdmin = role === Role.ADMIN || role === Role.SUPER_ADMIN;
  const inboxHref =
    role === Role.SUPER_ADMIN ? '/admin/email-ingestion/inboxes' : '/admin/email-ingestion';

  const actions: ReactNode[] = [
    <QuickLink
      key="est"
      href={hasClients ? '/estimates/new' : '/clients/new'}
      label="New estimate"
      variant={hasClients ? 'primary' : 'secondary'}
      hint={hasClients ? undefined : 'Add a client first'}
    />,
    <QuickLink key="po" href="/purchase-orders/new" label="New PO" variant="primary" />,
    <QuickLink key="cl" href="/clients/new" label="New client" variant="secondary" />,
    <QuickLink key="ven" href="/vendors/new" label="Add vendor" variant="secondary" />,
  ];

  if (isAdmin) {
    actions.push(
      <QuickLink key="inbox" href={inboxHref} label="Configure inbox" variant="secondary" />,
    );
  }

  return (
    <section className="mb-4">
      <div className="flex flex-wrap gap-1.5">{actions}</div>
    </section>
  );
}

function QuickLink({
  href,
  label,
  variant,
  hint,
}: {
  href: string;
  label: string;
  variant: 'primary' | 'secondary';
  hint?: string;
}) {
  const base =
    'inline-flex flex-col items-start rounded-[8px] px-3 py-1.5 text-[12.5px] font-medium shadow-[var(--shadow-bv-card)] transition-colors';
  const styles =
    variant === 'primary'
      ? 'bg-[var(--color-bv-accent)] text-[var(--color-bv-accent-foreground)] hover:opacity-92'
      : 'border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]';

  return (
    <Link href={href as never} className={`${base} ${styles}`}>
      <span>{label}</span>
      {hint ? (
        <span className="mt-0.5 text-[11px] font-normal opacity-80">{hint}</span>
      ) : null}
    </Link>
  );
}

export function DashboardMetricGrid({
  metrics,
  showOperatorCards,
}: {
  metrics: DashboardMetrics;
  showOperatorCards: boolean;
}) {
  const cards: {
    title: string;
    value: number;
    subtitle: string;
    href: string;
    tone?: 'default' | 'amber' | 'rose';
  }[] = [
    {
      title: 'Open estimates',
      value: metrics.openEstimates,
      subtitle: 'Draft, sent, or approved',
      href: '/estimates',
    },
    {
      title: 'Open purchase orders',
      value: metrics.openPurchaseOrders,
      subtitle: 'Not received or canceled',
      href: '/purchase-orders',
    },
  ];

  if (showOperatorCards) {
    cards.push(
      {
        title: 'Pending OCR reviews',
        value: metrics.pendingOcrReviews,
        subtitle: 'Receipt suggestions awaiting confirmation',
        href: '/admin/ocr-review',
        tone: metrics.pendingOcrReviews > 0 ? 'amber' : 'default',
      },
      {
        title: 'Unreconciled POs',
        value: metrics.unreconciledPurchaseOrders,
        subtitle: 'Open reconciliation — needs operator stamp',
        href: '/admin/reconciliation',
        tone: metrics.unreconciledPurchaseOrders > 0 ? 'rose' : 'default',
      },
    );
  }

  cards.push({
    title: 'Vendor price alerts',
    value: metrics.vendorPriceAlertsOpen,
    subtitle: 'Dismiss after review',
    href: '/dashboard#vendor-price-alerts',
    tone: metrics.vendorPriceAlertsOpen > 0 ? 'amber' : 'default',
  });

  return (
    <section className="mb-4">
      <div className="flex flex-wrap gap-2">
        {cards.map((c) => (
          <MetricCard key={c.title} {...c} />
        ))}
      </div>
    </section>
  );
}

function MetricCard({
  title,
  value,
  subtitle,
  href,
  tone = 'default',
}: {
  title: string;
  value: number;
  subtitle: string;
  href: string;
  tone?: 'default' | 'amber' | 'rose';
}) {
  const toneRing =
    tone === 'amber'
      ? 'ring-1 ring-amber-200/80'
      : tone === 'rose'
        ? 'ring-1 ring-rose-200/80'
        : '';

  return (
    <Link
      href={href as never}
      className={`inline-flex min-w-[9.5rem] flex-col rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-2 shadow-[var(--shadow-bv-card)] transition-colors hover:bg-[var(--color-bv-bg)] ${toneRing}`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-bv-muted)]">
        {title}
      </span>
      <span className="mt-0.5 text-[22px] font-semibold tabular-nums leading-none tracking-tight text-[var(--color-bv-text)]">
        {value}
      </span>
      <span className="mt-1 line-clamp-2 text-[11px] leading-snug text-[var(--color-bv-muted)]">
        {subtitle}
      </span>
    </Link>
  );
}

export function DashboardRecentActivity({ rows }: { rows: DashboardAuditRow[] }) {
  return (
    <details className="mb-6 rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
      <summary className="cursor-pointer list-none px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-bv-muted)] marker:content-none [&::-webkit-details-marker]:hidden">
        Audit timeline ({rows.length})
      </summary>
      {rows.length === 0 ? (
        <p className="border-t border-[var(--color-bv-border)] px-4 pb-4 pt-2 text-[12.5px] text-[var(--color-bv-muted)]">
          Nothing logged yet. Saves and status moves roll up here automatically.
        </p>
      ) : (
        <ul className="max-h-64 divide-y divide-[var(--color-bv-border)] overflow-y-auto border-t border-[var(--color-bv-border)]">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 py-2 text-[12px]">
              <div className="min-w-0 text-[var(--color-bv-text)]">
                <span className="font-medium">{humanizeAction(r.action)}</span>
                {r.targetType ? (
                  <span className="text-[var(--color-bv-muted)]">
                    {' '}
                    · {humanizeAction(r.targetType)}
                    {r.targetId ? (
                      <span className="font-mono text-[12px] text-[var(--color-bv-muted)]">
                        {' '}
                        {r.targetId.slice(0, 8)}…
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5 text-[12px] text-[var(--color-bv-muted)]">
                {r.actorLabel ? <span>{r.actorLabel}</span> : <span>System</span>}
                <time dateTime={r.createdAt.toISOString()} className="tabular-nums">
                  {formatShortTime(r.createdAt)}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function humanizeAction(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function formatShortTime(d: Date): string {
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
