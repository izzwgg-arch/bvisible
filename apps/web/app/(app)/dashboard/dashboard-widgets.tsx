import Link from 'next/link';
import type { ReactNode } from 'react';
import { Role } from '@bvisible/db';
import type { DashboardAuditRow, DashboardMetrics } from '@/lib/dashboard/get-dashboard-metrics';

export function DashboardFirstRunGuide({
  metrics,
}: {
  metrics: Pick<DashboardMetrics, 'clientCount' | 'openEstimates' | 'openPurchaseOrders'>;
}) {
  const quiet =
    metrics.clientCount === 0 &&
    metrics.openEstimates === 0 &&
    metrics.openPurchaseOrders === 0;

  if (!quiet) return null;

  return (
    <section className="mb-8 rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-gradient-to-br from-[var(--color-bv-surface)] to-[var(--color-bv-bg)] p-6 shadow-[var(--shadow-bv-card)]">
      <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-bv-text)]">
        Welcome — let&apos;s set up your workspace
      </h2>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-[13.5px] leading-relaxed text-[var(--color-bv-muted)]">
        <li>
          <Link
            href="/clients/new"
            className="font-medium text-[var(--color-bv-accent)] underline-offset-2 hover:underline"
          >
            Create a client
          </Link>{' '}
          — every estimate is tied to a customer record.
        </li>
        <li>
          <Link
            href="/vendors/new"
            className="font-medium text-[var(--color-bv-accent)] underline-offset-2 hover:underline"
          >
            Add vendors
          </Link>{' '}
          you buy from (needed for purchase orders and price tracking).
        </li>
        <li>
          Start an{' '}
          <Link
            href="/estimates/new"
            className="font-medium text-[var(--color-bv-accent)] underline-offset-2 hover:underline"
          >
            estimate
          </Link>{' '}
          once you have at least one client.
        </li>
      </ol>
    </section>
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
    <section className="mb-8">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-bv-muted)]">
        Quick actions
      </h2>
      <div className="flex flex-wrap gap-2">{actions}</div>
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
    'inline-flex flex-col items-start rounded-[10px] px-3.5 py-2.5 text-[13px] font-medium shadow-[var(--shadow-bv-card)] transition-colors';
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
    <section className="mb-8">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-bv-muted)]">
        At a glance
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
      className={`rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)] transition-colors hover:bg-[var(--color-bv-bg)] ${toneRing}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
          {title}
        </span>
        {value > 0 ? (
          <span className="rounded-full bg-[var(--color-bv-accent)]/12 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--color-bv-accent)]">
            Open
          </span>
        ) : (
          <span className="rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--color-bv-muted)]">
            Clear
          </span>
        )}
      </div>
      <div className="mt-3 text-[28px] font-semibold tabular-nums tracking-tight text-[var(--color-bv-text)]">
        {value}
      </div>
      <p className="mt-1 text-[12.5px] leading-snug text-[var(--color-bv-muted)]">{subtitle}</p>
    </Link>
  );
}

export function DashboardRecentActivity({ rows }: { rows: DashboardAuditRow[] }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-bv-muted)]">
        Recent activity
      </h2>
      {rows.length === 0 ? (
        <div className="rounded-[var(--radius-bv)] border border-dashed border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-5 py-8 text-[13.5px] text-[var(--color-bv-muted)] shadow-[var(--shadow-bv-card)]">
          No audit events yet for this workspace. Actions on estimates, POs, and admin tools will
          appear here.
        </div>
      ) : (
        <ul className="divide-y divide-[var(--color-bv-border)] overflow-hidden rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3 text-[13px]">
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
    </section>
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
