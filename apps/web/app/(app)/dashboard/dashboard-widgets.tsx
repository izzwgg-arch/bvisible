import Link from 'next/link';
import { Role } from '@bvisible/db';
import type { DashboardMetrics, DashboardNamedValue, DashboardSeriesPoint } from '@/lib/dashboard/get-dashboard-metrics';
import { cn } from '@/lib/cn';

const BRAND_NAVY = '#1C4972';
const BRAND_ORANGE = '#F28744';

export function DashboardAnalyticsBoard({
  role,
  hasClients,
  metrics,
  showOperatorCards,
}: {
  role: Role;
  hasClients: boolean;
  metrics: DashboardMetrics;
  showOperatorCards: boolean;
}) {
  const topCards = [
    {
      label: 'Open Estimates',
      value: metrics.openEstimates,
      href: '/estimates',
      change: `${metrics.estimatePerformance.createdLast30} created in 30 days`,
      icon: 'user' as const,
      tone: 'navy' as const,
    },
    {
      label: 'Pending OCR',
      value: metrics.pendingOcrReviews,
      href: '/admin/ocr-review',
      change: `${metrics.receiptOcr.waitingReview} waiting review`,
      icon: 'receipt' as const,
      tone: 'green' as const,
      hidden: !showOperatorCards,
    },
    {
      label: 'PO Reconciliation',
      value: metrics.unreconciledPurchaseOrders,
      href: '/admin/reconciliation',
      change: `${metrics.poReconciliation.waitingReview} in review`,
      icon: 'clipboard' as const,
      tone: 'purple' as const,
      hidden: !showOperatorCards,
    },
    {
      label: 'Vendor Alerts',
      value: metrics.vendorPriceAlertsOpen,
      href: '/dashboard#vendor-price-changes',
      change: metrics.vendorPriceAlertsOpen === 0 ? 'No new alerts' : 'Needs pricing review',
      icon: 'check' as const,
      tone: 'green' as const,
    },
  ].filter((card) => !card.hidden);
  const receiptOcrTotal = Math.max(
    metrics.receiptOcr.processed + metrics.receiptOcr.waitingReview + metrics.receiptOcr.rejected + metrics.receiptOcr.failed,
    1,
  );
  const poReconciliationTotal = Math.max(
    metrics.poReconciliation.matched +
      metrics.poReconciliation.waitingReview +
      metrics.poReconciliation.priceMismatches +
      metrics.poReconciliation.quantityMismatches,
    1,
  );

  return (
    <div className="dashboard-analytics -mx-4 -my-5 min-h-[calc(100vh-2.5rem)] px-4 py-5 text-[#1C4972] sm:-mx-5 sm:px-5 lg:-mx-6 lg:px-6 xl:-mx-7 xl:px-7 min-[1500px]:-mx-8 min-[1500px]:-my-8 min-[1500px]:px-8 min-[1500px]:py-8 print:m-0 print:min-h-0 print:bg-white print:p-0">
      <div className="mx-auto w-full max-w-[1600px]">
      <header className="mb-5 flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-semibold leading-none tracking-[-0.04em] text-[#1C4972]">
            Operations Command Center
          </h1>
          <p className="mt-1.5 text-[13px] text-[#6d7480]">
            Real-time overview of your business operations
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-medium text-[#6d7480]">
            Last updated: {formatShortTime(new Date())}
          </span>
          <span className="inline-flex h-9 items-center rounded-[8px] border border-[#e7edf2] bg-white px-3 text-[12px] font-semibold text-[#1C4972] shadow-sm">
            All Locations
            <span aria-hidden className="ml-3 text-[#6d7480]">⌄</span>
          </span>
          <span className="relative grid h-9 w-9 place-items-center rounded-[10px] border border-[#e7edf2] bg-white text-[#1C4972] shadow-sm">
            <BellIcon />
            {metrics.vendorPriceAlertsOpen > 0 ? (
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#F28744]" />
            ) : null}
          </span>
        </div>
      </header>

      <section className="mb-4 grid shrink-0 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {topCards.map((card) => (
          <TopStatCard key={card.label} {...card} />
        ))}
      </section>

      <section className="mb-4 grid gap-4 xl:grid-cols-3">
        <AnalyticsPanel title="Email Ingestion" subtitle="Health of mail processing" className="xl:min-h-[300px]">
          <div className="grid gap-4 lg:grid-cols-[150px_minmax(0,1fr)]">
            <DonutGauge value={metrics.emailIngestion.successRate} label="Success Rate" tone="navy" />
            <MetricList
              rows={[
                ['Emails Today', metrics.emailIngestion.emailsToday.toLocaleString()],
                ['Processed', metrics.emailIngestion.processed.toLocaleString()],
                ['Failed', metrics.emailIngestion.failed.toLocaleString(), 'danger'],
                ['Avg Processing Time', formatDuration(metrics.emailIngestion.avgProcessingMs)],
              ]}
            />
          </div>
          <LineChart title="Email Volume (Last 14 Days)" points={metrics.emailIngestion.series} tone="navy" />
        </AnalyticsPanel>

        <AnalyticsPanel title="Receipt OCR" subtitle="OCR pipeline performance" className="xl:min-h-[300px]">
          <div className="grid gap-4 lg:grid-cols-[150px_minmax(0,1fr)]">
            <SegmentedDonut
              value={metrics.receiptOcr.successRate}
              label="Processed"
              segments={[
                { value: (metrics.receiptOcr.processed / receiptOcrTotal) * 100, color: '#35b779' },
                { value: (metrics.receiptOcr.waitingReview / receiptOcrTotal) * 100, color: '#f2b84b' },
                { value: ((metrics.receiptOcr.rejected + metrics.receiptOcr.failed) / receiptOcrTotal) * 100, color: '#e44f5f' },
              ]}
            />
            <MetricList
              rows={[
                ['Processed', `${metrics.receiptOcr.successRate}% (${metrics.receiptOcr.processed})`, 'success'],
                ['Waiting Review', `${metrics.receiptOcr.waitingReview}`],
                ['Rejected', `${metrics.receiptOcr.rejected + metrics.receiptOcr.failed}`, 'danger'],
              ]}
            />
          </div>
          <LineChart title="Receipts Processed (Last 14 Days)" points={metrics.receiptOcr.series} tone="green" />
        </AnalyticsPanel>

        <AnalyticsPanel title="PO Reconciliation" subtitle="Purchase order matching performance" className="xl:min-h-[300px]">
          <div className="grid gap-4 lg:grid-cols-[150px_minmax(0,1fr)]">
            <SegmentedDonut
              value={metrics.poReconciliation.matchRate}
              label="Matched"
              segments={[
                { value: (metrics.poReconciliation.matched / poReconciliationTotal) * 100, color: '#7c3aed' },
                { value: (metrics.poReconciliation.waitingReview / poReconciliationTotal) * 100, color: '#f2b84b' },
                { value: (metrics.poReconciliation.priceMismatches / poReconciliationTotal) * 100, color: BRAND_ORANGE },
                { value: (metrics.poReconciliation.quantityMismatches / poReconciliationTotal) * 100, color: '#e44f5f' },
              ]}
            />
            <MetricList
              rows={[
                ['Matched', `${metrics.poReconciliation.matchRate}% (${metrics.poReconciliation.matched})`, 'success'],
                ['Awaiting Review', `${metrics.poReconciliation.waitingReview}`],
                ['Price Mismatches', `${metrics.poReconciliation.priceMismatches}`, 'warning'],
                ['Quantity Mismatches', `${metrics.poReconciliation.quantityMismatches}`, 'danger'],
              ]}
            />
          </div>
          <LineChart title="POs Reconciled (Last 4 Weeks)" points={metrics.poReconciliation.series} tone="purple" />
        </AnalyticsPanel>
      </section>

      <section className="mb-4 grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(360px,0.95fr)]">
        <AnalyticsPanel title="Workflow Pipeline" subtitle="Live flow of documents through the system" className="xl:min-h-[150px]">
          <Pipeline rows={metrics.workflowPipeline} />
        </AnalyticsPanel>
        <AnalyticsPanel id="vendor-price-changes" title="Vendor Price Changes" subtitle="Last 30 days" className="xl:min-h-[150px]">
          <VendorPriceChanges metrics={metrics.vendorPriceChanges} />
        </AnalyticsPanel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.75fr)]">
        <AnalyticsPanel title="Estimate Performance" subtitle="Last 30 days" className="xl:min-h-[205px]">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_155px_minmax(190px,0.9fr)]">
            <div>
              <MetricInline
                label="Estimates Created"
                value={metrics.estimatePerformance.createdLast30.toLocaleString()}
                detail={`${signedDelta(metrics.estimatePerformance.createdLast30, metrics.estimatePerformance.createdPrevious30)} vs previous 30 days`}
              />
              <LineChart points={metrics.estimatePerformance.series} tone="navy" compact />
            </div>
            <div className="grid gap-3">
              <DonutGauge value={metrics.estimatePerformance.approvalRate} label="Approved" tone="navy" compact />
              <StatusLegend rows={metrics.estimatePerformance.statusBreakdown} total={metrics.estimatePerformance.createdLast30} />
            </div>
            <div>
              <MetricInline
                label="Revenue Pipeline"
                value={formatMoney(metrics.estimatePerformance.revenuePipelineCents)}
                detail="Open estimate value"
              />
              <BarChart rows={metrics.estimatePerformance.revenueByStatus} />
            </div>
          </div>
        </AnalyticsPanel>
        <AnalyticsPanel title="Quick Actions" className="xl:min-h-[205px]">
          <QuickActions role={role} hasClients={hasClients} />
        </AnalyticsPanel>
      </section>
      </div>
    </div>
  );
}

function TopStatCard({
  label,
  value,
  change,
  icon,
  tone,
  href,
}: {
  label: string;
  value: number;
  change: string;
  icon: 'user' | 'receipt' | 'clipboard' | 'check';
  tone: 'navy' | 'green' | 'purple';
  href: string;
}) {
  const styles = toneStyles(tone);
  return (
    <Link
      href={href as never}
      className="group flex min-h-[112px] items-center justify-between rounded-[12px] border border-[#e7edf2] bg-white px-5 py-4 shadow-[0_1px_2px_rgba(28,73,114,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(28,73,114,0.10)]"
    >
      <div>
        <p className="text-[13px] font-semibold text-[#1C4972]">{label}</p>
        <p className="mt-3 text-[34px] font-semibold leading-none tracking-[-0.045em] text-[#101828]">
          {value.toLocaleString()}
        </p>
        <p className="mt-2 text-[11px] font-medium text-[#4fa56f]">
          ▲ {change}
        </p>
      </div>
      <span className={cn('grid h-14 w-14 place-items-center rounded-[13px]', styles.soft, styles.text)}>
        <StatIcon icon={icon} />
      </span>
    </Link>
  );
}

function AnalyticsPanel({
  id,
  title,
  subtitle,
  className,
  children,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn('min-h-0 rounded-[12px] border border-[#e7edf2] bg-white p-5 shadow-[0_1px_2px_rgba(28,73,114,0.04)]', className)}>
      <div className="mb-4">
        <h2 className="text-[14px] font-semibold text-[#1C4972]">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-[11px] text-[#6d7480]">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function DonutGauge({
  value,
  label,
  tone,
  compact = false,
}: {
  value: number;
  label: string;
  tone: 'navy' | 'green' | 'purple';
  compact?: boolean;
}) {
  const styles = toneStyles(tone);
  return (
    <div className="flex flex-col items-center justify-center">
      <div
        className={cn('grid place-items-center rounded-full', compact ? 'h-[112px] w-[112px]' : 'h-[130px] w-[130px]')}
        style={{
          background: `conic-gradient(${styles.hex} ${Math.max(0, Math.min(100, value)) * 3.6}deg, #eef2f5 0deg)`,
        }}
      >
        <div className={cn('grid place-items-center rounded-full bg-white shadow-[inset_0_0_0_1px_#edf2f7]', compact ? 'h-[76px] w-[76px]' : 'h-[88px] w-[88px]')}>
          <div className="text-center">
            <p className={cn('font-semibold leading-none tracking-[-0.045em] text-[#101828]', compact ? 'text-[25px]' : 'text-[30px]')}>{value}%</p>
            <p className="mt-1 text-[10px] font-medium text-[#6d7480]">{label}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SegmentedDonut({
  value,
  label,
  segments,
}: {
  value: number;
  label: string;
  segments: Array<{ value: number; color: string }>;
}) {
  let cursor = 0;
  const stops = segments
    .filter((segment) => segment.value > 0)
    .map((segment) => {
      const start = cursor;
      cursor += Math.max(segment.value, 1) * 3.6;
      return `${segment.color} ${start}deg ${cursor}deg`;
    })
    .join(', ');
  const background = stops.length ? `conic-gradient(${stops}, #eef2f5 ${cursor}deg 360deg)` : '#eef2f5';

  return (
    <div className="flex flex-col items-center justify-center">
      <div className="grid h-[130px] w-[130px] place-items-center rounded-full" style={{ background }}>
        <div className="grid h-[88px] w-[88px] place-items-center rounded-full bg-white shadow-[inset_0_0_0_1px_#edf2f7]">
          <div className="text-center">
            <p className="text-[30px] font-semibold leading-none tracking-[-0.045em] text-[#101828]">{value}%</p>
            <p className="mt-1 text-[10px] font-medium text-[#6d7480]">{label}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricList({ rows }: { rows: Array<[string, string, ('success' | 'warning' | 'danger')?]> }) {
  return (
    <dl className="space-y-3 pt-2">
      {rows.map(([label, value, tone]) => (
        <div key={label} className="flex items-center justify-between gap-3 text-[12px]">
          <dt className="text-[#6d7480]">{label}</dt>
          <dd
            className={cn(
              'font-semibold tabular-nums text-[#1C4972]',
              tone === 'success' && 'text-[#35b779]',
              tone === 'warning' && 'text-[#d98926]',
              tone === 'danger' && 'text-[#d34d4d]',
            )}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function LineChart({
  title,
  points,
  tone,
  compact = false,
}: {
  title?: string;
  points: DashboardSeriesPoint[];
  tone: 'navy' | 'green' | 'purple';
  compact?: boolean;
}) {
  const styles = toneStyles(tone);
  const max = Math.max(...points.map((point) => point.value), 1);
  const chartHeight = compact ? 76 : 88;
  const width = 320;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const coords = points.map((point, index) => {
    const x = Math.round(index * step);
    const y = Math.round(chartHeight - (point.value / max) * (chartHeight - 14) - 7);
    return `${x},${y}`;
  });

  return (
    <div className={compact ? 'mt-3' : 'mt-5'}>
      {title ? <p className="mb-2 text-[10px] font-medium text-[#6d7480]">{title}</p> : null}
      <svg viewBox={`0 0 ${width} ${chartHeight}`} className={cn('w-full overflow-visible', compact ? 'h-[76px]' : 'h-[88px]')}>
        <polyline points={coords.join(' ')} fill="none" stroke={styles.hex} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point, index) => {
          const [x, y] = coords[index]!.split(',').map(Number);
          return <circle key={`${point.label}-${index}`} cx={x} cy={y} r="2.4" fill={styles.hex} />;
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[9px] text-[#6d7480]">
        {points.filter((_, index) => index === 0 || index === points.length - 1 || index % Math.ceil(points.length / 4) === 0).map((point, index) => (
          <span key={`${point.label}-${index}`}>{point.label}</span>
        ))}
      </div>
    </div>
  );
}

function Pipeline({ rows }: { rows: DashboardNamedValue[] }) {
  return (
    <div className="flex h-full flex-wrap items-center justify-between gap-3 pb-1">
      {rows.map((row, index) => (
        <div key={row.label} className="flex min-w-[116px] items-center gap-3">
          <div className="text-center">
            <span className="mx-auto grid h-10 w-10 place-items-center rounded-[10px] border border-[#dfe7ee] bg-[#f8fbfd] text-[#1C4972]">
              {pipelineIcon(index)}
            </span>
            <p className="mt-2 text-[20px] font-semibold leading-none text-[#101828]">{row.value.toLocaleString()}</p>
            <p className="mt-1 text-[10px] text-[#6d7480]">{row.label}</p>
          </div>
          {index < rows.length - 1 ? <span className="hidden text-[20px] text-[#9aa9b7] lg:block">→</span> : null}
        </div>
      ))}
    </div>
  );
}

function VendorPriceChanges({ metrics }: { metrics: DashboardMetrics['vendorPriceChanges'] }) {
  const max = Math.max(...metrics.series.flatMap((row) => [row.increases, row.decreases]), 1);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_150px]">
      <div>
        <DualLineChart rows={metrics.series} max={max} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
        <MetricInline label="Price Increases" value={metrics.increases.toLocaleString()} detail={metrics.largestIncreasePct == null ? 'No increases' : `+${metrics.largestIncreasePct.toFixed(1)}% ${metrics.largestIncreaseLabel ?? ''}`} danger />
        <MetricInline label="Price Decreases" value={metrics.decreases.toLocaleString()} detail={metrics.largestDecreasePct == null ? 'No decreases' : `-${metrics.largestDecreasePct.toFixed(1)}% ${metrics.largestDecreaseLabel ?? ''}`} success />
      </div>
    </div>
  );
}

function DualLineChart({ rows, max }: { rows: Array<{ label: string; increases: number; decreases: number }>; max: number }) {
  const width = 360;
  const height = 102;
  const step = rows.length > 1 ? width / (rows.length - 1) : width;
  const pointsFor = (key: 'increases' | 'decreases') =>
    rows
      .map((row, index) => `${Math.round(index * step)},${Math.round(height - (row[key] / max) * (height - 18) - 9)}`)
      .join(' ');
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[118px] w-full overflow-visible">
        <polyline points={pointsFor('increases')} fill="none" stroke={BRAND_ORANGE} strokeWidth="2.4" strokeLinecap="round" />
        <polyline points={pointsFor('decreases')} fill="none" stroke={BRAND_NAVY} strokeWidth="2.4" strokeLinecap="round" strokeDasharray="4 4" />
      </svg>
      <div className="flex justify-between text-[9px] text-[#6d7480]">
        {rows.map((row) => <span key={row.label}>{row.label}</span>)}
      </div>
    </div>
  );
}

function BarChart({ rows }: { rows: DashboardNamedValue[] }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="mt-4 flex h-24 items-end gap-3">
      {rows.map((row, index) => (
        <div key={row.label} className="flex flex-1 flex-col items-center gap-2">
          <span
            className={cn('w-full rounded-t-[8px]', index % 2 === 0 ? 'bg-[#1C4972]' : 'bg-[#F28744]')}
            style={{ height: `${Math.max(10, (row.value / max) * 100)}%` }}
          />
          <span className="text-[9px] text-[#6d7480]">{row.label}</span>
        </div>
      ))}
    </div>
  );
}

function StatusLegend({ rows, total }: { rows: DashboardNamedValue[]; total: number }) {
  const colors = ['bg-[#35b779]', 'bg-[#5e9ee8]', 'bg-[#7c3aed]', 'bg-[#f2b84b]', 'bg-[#F28744]'];
  const denominator = Math.max(total, rows.reduce((sum, row) => sum + row.value, 0), 1);
  return (
    <div className="space-y-1.5">
      {rows.slice(0, 3).map((row, index) => (
        <div key={row.label} className="flex items-center justify-between gap-2 text-[10px]">
          <span className="flex items-center gap-1.5 text-[#6d7480]">
            <span className={cn('h-2 w-2 rounded-full', colors[index])} />
            {row.label}
          </span>
          <span className="font-semibold tabular-nums text-[#1C4972]">
            {Math.round((row.value / denominator) * 100)}% ({row.value})
          </span>
        </div>
      ))}
    </div>
  );
}

function MetricInline({
  label,
  value,
  detail,
  success = false,
  danger = false,
}: {
  label: string;
  value: string;
  detail: string;
  success?: boolean;
  danger?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-medium text-[#6d7480]">{label}</p>
      <p className="mt-1 text-[23px] font-semibold leading-none tracking-[-0.035em] text-[#101828]">{value}</p>
      <p className={cn('mt-1 text-[10px] font-medium text-[#6d7480]', success && 'text-[#35b779]', danger && 'text-[#d34d4d]')}>
        {detail}
      </p>
    </div>
  );
}

function QuickActions({ role, hasClients }: { role: Role; hasClients: boolean }) {
  const isAdmin = role === Role.ADMIN || role === Role.SUPER_ADMIN;
  const actions = [
    { label: 'New Estimate', href: hasClients ? '/estimates/new' : '/clients/new' },
    { label: 'New Catalog Item', href: '/items/new' },
    { label: 'Upload Receipt', href: '/admin/ocr-review', admin: true },
    { label: 'Create PO', href: '/purchase-orders/new' },
    { label: 'Add Vendor', href: '/vendors/new' },
    { label: 'Import Vendor Pricing', href: '/admin/email-ingestion', admin: true },
  ].filter((action) => !action.admin || isAdmin);

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {actions.map((action) => (
        <Link
          key={action.label}
          href={action.href as never}
          className="flex min-h-9 items-center gap-2.5 rounded-[9px] border border-[#e7edf2] bg-white px-3 text-[11px] font-semibold text-[#1C4972] transition hover:-translate-y-0.5 hover:border-[#F28744]/35 hover:shadow-[0_10px_24px_rgba(242,135,68,0.12)]"
        >
          <span className="text-[#F28744]">＋</span>
          {action.label}
        </Link>
      ))}
    </div>
  );
}

function StatIcon({ icon }: { icon: 'user' | 'receipt' | 'clipboard' | 'check' }) {
  const common = { className: 'h-6 w-6', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, viewBox: '0 0 24 24' };
  if (icon === 'receipt') return <svg {...common}><path d="M7 3h10v18l-2-1-2 1-2-1-2 1-2-1V3Z" /><path d="M9 8h6" /><path d="M9 12h6" /><path d="M9 16h3" /></svg>;
  if (icon === 'clipboard') return <svg {...common}><path d="M9 5h6" /><path d="M9 3h6v4H9z" /><path d="M7 5H5v16h14V5h-2" /><path d="m9 14 2 2 4-5" /></svg>;
  if (icon === 'check') return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.2 2.2 4.8-5.4" /></svg>;
  return <svg {...common}><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></svg>;
}

function BellIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M18 9a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </svg>
  );
}

function pipelineIcon(index: number): string {
  return ['✉', '◎', '☷', '▣', '✓'][index] ?? '•';
}

function toneStyles(tone: 'navy' | 'green' | 'purple') {
  switch (tone) {
    case 'green':
      return { hex: '#35b779', soft: 'bg-[#eafaf2]', text: 'text-[#35b779]' };
    case 'purple':
      return { hex: '#7c3fc8', soft: 'bg-[#f2eafa]', text: 'text-[#7c3fc8]' };
    case 'navy':
    default:
      return { hex: BRAND_NAVY, soft: 'bg-[#eef3f7]', text: 'text-[#1C4972]' };
  }
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function signedDelta(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? '+100%' : '0%';
  const delta = ((current - previous) / previous) * 100;
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}%`;
}

function formatShortTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}