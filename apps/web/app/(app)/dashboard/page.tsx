import { requireUserForAppShell } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { Role } from '@bvisible/db';
import { getDashboardMetrics } from '@/lib/dashboard/get-dashboard-metrics';
import { getDashboardOperationalFeed } from '@/lib/dashboard/get-dashboard-feed';
import { VendorPriceAlerts } from './vendor-price-alerts';
import {
  DashboardMetricGrid,
  DashboardOperationalSections,
  DashboardQuickActions,
  DashboardRecentActivity,
} from './dashboard-widgets';

export const metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUserForAppShell();
  const { error } = await searchParams;

  const showOperator =
    user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;

  const [metrics, feed] =
    user.tenantId != null
      ? await Promise.all([
          getDashboardMetrics(user.tenantId, {
            includeOperatorMetrics: showOperator,
          }),
          getDashboardOperationalFeed(user.tenantId, {
            includeOperatorAttention: false,
          }),
        ])
      : [null, null];

  return (
    <>
      <PageHeader
        title="Operations cockpit"
        subtitle="Live work, pricing, and activity in one clean view."
      />
      {error === 'forbidden' ? (
        <div className="mb-6 rounded-[var(--radius-bv)] border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900">
          You don&apos;t have permission to view that page.
        </div>
      ) : null}
      {error === 'multi-company' ? (
        <div className="mb-6 rounded-[var(--radius-bv)] border border-red-200 bg-red-50 px-4 py-3 text-[13.5px] text-red-950">
          Multiple companies are configured in the database without a canonical{' '}
          <span className="font-mono">bvisible</span> slug. Resolve this in{' '}
          <strong>Company settings</strong> before continuing (single-company mode).
        </div>
      ) : null}
      {error === 'no-tenant' ? (
        <div className="mb-6 rounded-[var(--radius-bv)] border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900">
          That page needs a workspace. Open <strong>Company settings</strong> or contact an
          administrator.
        </div>
      ) : null}

      {metrics ? (
        <>
          <DashboardQuickActions role={user.role} hasClients={metrics.clientCount > 0} />
          <DashboardMetricGrid metrics={metrics} showOperatorCards={showOperator} />

          {user.tenantId && metrics.vendorPriceAlertsOpen > 0 ? (
            <div id="vendor-price-alerts" className="scroll-mt-8">
              <VendorPriceAlerts tenantId={user.tenantId} />
            </div>
          ) : null}

          {feed ? <DashboardOperationalSections feed={feed} showAttention={false} /> : null}
          <DashboardRecentActivity rows={metrics.recentActivity} />
        </>
      ) : null}

      {user.tenantId && metrics && metrics.vendorPriceAlertsOpen === 0 ? (
        <div id="vendor-price-alerts" className="scroll-mt-8">
          <VendorPriceAlerts tenantId={user.tenantId} />
        </div>
      ) : null}
    </>
  );
}

