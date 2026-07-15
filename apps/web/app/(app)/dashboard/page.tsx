import { requireUserForAppShell } from '@/lib/auth/current-user';
import { Role } from '@bvisible/db';
import { getDashboardMetrics } from '@/lib/dashboard/get-dashboard-metrics';
import { DashboardAnalyticsBoard } from './dashboard-widgets';

export const metadata = { title: 'Overview' };
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

  const metrics =
    user.tenantId != null
      ? await getDashboardMetrics(user.tenantId, {
          includeOperatorMetrics: showOperator,
        })
      : null;

  return (
    <>
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
        <DashboardAnalyticsBoard
          role={user.role}
          hasClients={metrics.clientCount > 0}
          metrics={metrics}
          showOperatorCards={showOperator}
        />
      ) : null}
    </>
  );
}

