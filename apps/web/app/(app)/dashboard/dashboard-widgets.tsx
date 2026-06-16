import Link from 'next/link';
import type { ReactNode } from 'react';
import { EstimateStatus, POStatus, Role } from '@bvisible/db';
import type { DashboardAuditRow, DashboardMetrics } from '@/lib/dashboard/get-dashboard-metrics';
import type { AttentionFeedKind, DashboardOperationalFeed } from '@/lib/dashboard/get-dashboard-feed';
import { cn } from '@/lib/cn';
import { labelEstimateStatus, labelPoStatus } from '@/lib/ui/status-labels';

export function DashboardOperationalSections({
  feed,
  showAttention = true,
}: {
  feed: DashboardOperationalFeed;
  showAttention?: boolean;
}) {
  const rowCount = feed.recentEstimates.length + feed.recentPurchaseOrders.length;

  return (
    <details className="group mb-6 overflow-hidden rounded-[28px] border border-white/[0.72] bg-white/[0.78] shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <summary className="cursor-pointer list-none px-5 py-4 marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-[12px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Recent records
            </span>
            <span className="mt-1 block text-[13px] text-slate-500">
              {rowCount} active updates
            </span>
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-500 shadow-sm">
            Open
          </span>
        </span>
      </summary>
      <div className="grid gap-4 border-t border-slate-200/80 px-5 pb-5 pt-4 xl:grid-cols-2">
      <section>
        <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          Estimates
        </h3>
        {feed.recentEstimates.length === 0 ? (
          <EmptyRail>No estimates yet.</EmptyRail>
        ) : (
          <ul className="flex flex-col gap-2">
            {feed.recentEstimates.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/estimates/${e.id}` as never}
                  className="group/row flex items-start justify-between gap-3 rounded-[18px] border border-slate-200/[0.85] bg-white/[0.72] px-3.5 py-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_14px_34px_rgba(37,99,235,0.10)]"
                >
                  <div className="min-w-0">
                    <span className="font-mono text-[12px] font-semibold text-blue-600">
                      {e.number}
                    </span>
                    <span className="mt-1 block truncate text-[13px] font-medium text-slate-950">{e.title}</span>
                  </div>
                  <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                    {labelEstimateStatus(e.status as EstimateStatus)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          Purchase orders
        </h3>
        {feed.recentPurchaseOrders.length === 0 ? (
          <EmptyRail>No purchase orders yet.</EmptyRail>
        ) : (
          <ul className="flex flex-col gap-2">
            {feed.recentPurchaseOrders.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/purchase-orders/${p.id}` as never}
                  className="group/row flex items-start justify-between gap-3 rounded-[18px] border border-slate-200/[0.85] bg-white/[0.72] px-3.5 py-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-cyan-200 hover:shadow-[0_14px_34px_rgba(6,182,212,0.10)]"
                >
                  <div className="min-w-0">
                    <span className="font-mono text-[12px] font-semibold text-cyan-700">
                      {p.number}
                    </span>
                    <span className="mt-1 block truncate text-[12px] font-medium text-slate-500">
                      {p.vendorName ?? 'No vendor'}
                    </span>
                  </div>
                  <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
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
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
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
                  className="block rounded-[18px] border border-amber-200/90 bg-amber-50/70 px-4 py-3 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-amber-50"
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
    <div className="rounded-[20px] border border-dashed border-slate-300 bg-white/60 px-4 py-8 text-center text-[13px] text-slate-500">
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
    <section className="mb-6 flex justify-end">
      <div className="inline-flex max-w-full flex-wrap items-center justify-end gap-1.5 rounded-[22px] border border-white/80 bg-white/[0.72] p-1.5 shadow-[0_18px_48px_rgba(15,23,42,0.08)] backdrop-blur-xl">
        {actions}
      </div>
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
    'inline-flex min-h-10 items-center rounded-[16px] px-4 py-2 text-[12px] font-semibold transition-all hover:-translate-y-0.5';
  const styles =
    variant === 'primary'
      ? 'bg-blue-600 text-white shadow-[0_12px_28px_rgba(37,99,235,0.22)] hover:bg-blue-500'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950';

  return (
    <Link href={href as never} className={`${base} ${styles}`}>
      <span className="whitespace-nowrap">{label}</span>
      {hint ? (
        <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
          {hint}
        </span>
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
    tone?: 'default' | 'blue' | 'cyan' | 'amber' | 'rose';
  }[] = [
    {
      title: 'Open estimates',
      value: metrics.openEstimates,
      subtitle: 'Pipeline',
      href: '/estimates',
      tone: 'blue',
    },
    {
      title: 'Open purchase orders',
      value: metrics.openPurchaseOrders,
      subtitle: 'Procurement',
      href: '/purchase-orders',
      tone: 'cyan',
    },
  ];

  if (showOperatorCards) {
    cards.push(
      {
        title: 'Pending OCR reviews',
        value: metrics.pendingOcrReviews,
        subtitle: 'Review',
        href: '/admin/ocr-review',
        tone: metrics.pendingOcrReviews > 0 ? 'amber' : 'default',
      },
      {
        title: 'Unreconciled POs',
        value: metrics.unreconciledPurchaseOrders,
        subtitle: 'Reconcile',
        href: '/admin/reconciliation',
        tone: metrics.unreconciledPurchaseOrders > 0 ? 'rose' : 'default',
      },
    );
  }

  cards.push({
    title: 'Vendor price alerts',
    value: metrics.vendorPriceAlertsOpen,
    subtitle: 'Pricing',
    href: '/dashboard#vendor-price-alerts',
    tone: metrics.vendorPriceAlertsOpen > 0 ? 'amber' : 'default',
  });

  return (
    <section className="mb-6">
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-5">
        {cards.map((c) => (
          <MetricCard key={c.title} {...c} maxValue={Math.max(...cards.map((card) => card.value), 1)} />
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
  tone = 'blue',
  maxValue,
}: {
  title: string;
  value: number;
  subtitle: string;
  href: string;
  tone?: 'default' | 'blue' | 'cyan' | 'amber' | 'rose';
  maxValue: number;
}) {
  const percent = Math.min(100, Math.round((value / maxValue) * 100));
  const accent = metricTone(tone);

  return (
    <Link
      href={href as never}
      className="group relative overflow-hidden rounded-[28px] border border-white/[0.72] bg-white/[0.82] p-4 shadow-[0_22px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl transition-all hover:-translate-y-1 hover:shadow-[0_30px_80px_rgba(15,23,42,0.12)]"
    >
      <div
        aria-hidden
        className={cn('absolute -right-10 -top-12 h-32 w-32 rounded-full blur-2xl', accent.glow)}
      />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {subtitle}
          </span>
          <span className="mt-2 block text-[15px] font-semibold text-slate-950">
            {title}
          </span>
        </div>
        <Gauge percent={percent} toneClass={accent.ring} />
      </div>
      <div className="relative mt-8 flex items-end justify-between gap-3">
        <span className="text-[42px] font-semibold tabular-nums leading-none tracking-[-0.06em] text-slate-950">
          {value}
        </span>
        <span className={cn('rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]', accent.pill)}>
          {value === 0 ? 'Clear' : 'Open'}
        </span>
      </div>
      <div className="relative mt-4 flex h-8 items-end gap-1.5">
        {[0.35, 0.58, 0.82, 0.48, 0.72].map((step, index) => (
          <span
            key={index}
            aria-hidden
            className={cn('flex-1 rounded-t-full', accent.bar)}
            style={{ height: `${Math.max(14, percent * step)}%` }}
          />
        ))}
      </div>
    </Link>
  );
}

function Gauge({ percent, toneClass }: { percent: number; toneClass: string }) {
  return (
    <span
      aria-hidden
      className={cn('grid h-14 w-14 place-items-center rounded-full bg-slate-100', toneClass)}
      style={{
        background: `conic-gradient(var(--gauge-color) ${percent * 3.6}deg, #e2e8f0 0deg)`,
      }}
    >
      <span className="grid h-10 w-10 place-items-center rounded-full bg-white text-[10px] font-semibold text-slate-500 shadow-sm">
        {percent}%
      </span>
    </span>
  );
}

function metricTone(tone: 'default' | 'blue' | 'cyan' | 'amber' | 'rose') {
  switch (tone) {
    case 'cyan':
      return {
        bar: 'bg-cyan-400',
        glow: 'bg-cyan-300/35',
        pill: 'bg-cyan-50 text-cyan-700',
        ring: '[--gauge-color:#22d3ee]',
      };
    case 'amber':
      return {
        bar: 'bg-amber-400',
        glow: 'bg-amber-300/35',
        pill: 'bg-amber-50 text-amber-700',
        ring: '[--gauge-color:#f59e0b]',
      };
    case 'rose':
      return {
        bar: 'bg-rose-400',
        glow: 'bg-rose-300/35',
        pill: 'bg-rose-50 text-rose-700',
        ring: '[--gauge-color:#fb7185]',
      };
    case 'blue':
      return {
        bar: 'bg-blue-500',
        glow: 'bg-blue-400/30',
        pill: 'bg-blue-50 text-blue-700',
        ring: '[--gauge-color:#3b82f6]',
      };
    default:
      return {
        bar: 'bg-slate-400',
        glow: 'bg-slate-300/30',
        pill: 'bg-slate-100 text-slate-600',
        ring: '[--gauge-color:#94a3b8]',
      };
  }
}

export function DashboardRecentActivity({ rows }: { rows: DashboardAuditRow[] }) {
  return (
    <details className="mb-6 overflow-hidden rounded-[28px] border border-white/[0.72] bg-white/70 shadow-[0_18px_50px_rgba(15,23,42,0.06)] backdrop-blur-xl">
      <summary className="cursor-pointer list-none px-5 py-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 marker:content-none [&::-webkit-details-marker]:hidden">
        Audit timeline ({rows.length})
      </summary>
      {rows.length === 0 ? (
        <p className="border-t border-slate-200/80 px-5 pb-5 pt-3 text-[12.5px] text-slate-500">
          Nothing logged yet. Saves and status moves roll up here automatically.
        </p>
      ) : (
        <ul className="max-h-64 divide-y divide-slate-200/80 overflow-y-auto border-t border-slate-200/80">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-5 py-3 text-[12px]">
              <div className="min-w-0 text-slate-950">
                <span className="font-medium">{humanizeAction(r.action)}</span>
                {r.targetType ? (
                  <span className="text-slate-500">
                    {' '}
                    · {humanizeAction(r.targetType)}
                    {r.targetId ? (
                      <span className="font-mono text-[12px] text-slate-400">
                        {' '}
                        {r.targetId.slice(0, 8)}…
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5 text-[12px] text-slate-500">
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
