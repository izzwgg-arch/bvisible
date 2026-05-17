import { requireUserForAppShell } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { Role } from '@bvisible/db';
import { getDashboardMetrics } from '@/lib/dashboard/get-dashboard-metrics';
import { getDashboardOperationalFeed } from '@/lib/dashboard/get-dashboard-feed';
import { getOnboardingChecklistState } from '@/lib/onboarding/checklist-data';
import { isOnboardingChecklistDismissed } from '@/lib/onboarding/dismiss-action';
import { OnboardingChecklistCard } from '@/components/onboarding/onboarding-checklist-card';
import {
  getOperationalWorkflowQueues,
  type OperationalQueueFilter,
} from '@/lib/workflow/get-operational-workflow-queues';
import { VendorPriceAlerts } from './vendor-price-alerts';
import { DashboardOperationalQueues } from './dashboard-operational-queues';
import { DashboardPoLifecycleQueues } from './dashboard-po-lifecycle-queues';
import { getPoLifecycleDashboardQueues } from '@/lib/po/get-po-lifecycle-dashboard-queues';
import {
  DashboardMetricGrid,
  DashboardOperationalSections,
  DashboardQuickActions,
  DashboardRecentActivity,
} from './dashboard-widgets';

export const metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

const QUEUE_FILTERS = new Set<OperationalQueueFilter>([
  'all',
  'stale',
  'blocked',
  'unresolved',
  'mine',
]);

function parseQueueFilter(raw: string | undefined): OperationalQueueFilter {
  if (raw && QUEUE_FILTERS.has(raw as OperationalQueueFilter)) {
    return raw as OperationalQueueFilter;
  }
  return 'all';
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; queue?: string }>;
}) {
  const user = await requireUserForAppShell();
  const { error, queue: queueParam } = await searchParams;
  const queueFilter = parseQueueFilter(queueParam);

  const showOperator =
    user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;

  const [metrics, feed, dismissed, checklistState, operationalQueues, poLifecycleQueues] =
    user.tenantId != null
      ? await Promise.all([
          getDashboardMetrics(user.tenantId, {
            includeOperatorMetrics: showOperator,
          }),
          getDashboardOperationalFeed(user.tenantId, {
            includeOperatorAttention: false,
          }),
          isOnboardingChecklistDismissed(),
          getOnboardingChecklistState(user.tenantId, user.role),
          getOperationalWorkflowQueues(user.tenantId, {
            filter: queueFilter,
            currentUserId: user.id,
            includeOperatorQueues: showOperator,
          }),
          showOperator
            ? getPoLifecycleDashboardQueues(user.tenantId, {
                currentUserId: user.id,
                mineOnly: queueFilter === 'mine',
              })
            : Promise.resolve(null),
        ])
      : [null, null, true, null, null, null];

  const workspaceLabel = user.tenant.name;

  const showOnboarding =
    checklistState != null &&
    !dismissed &&
    checklistState.completedCount < checklistState.totalSteps;

  return (
    <>
      <PageHeader
        title={greeting(user.name, user.email)}
        subtitle={`${workspaceLabel} · operational overview`}
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

      {showOnboarding && checklistState ? (
        <OnboardingChecklistCard state={checklistState} role={user.role} />
      ) : null}

      {metrics ? (
        <>
          <DashboardQuickActions role={user.role} hasClients={metrics.clientCount > 0} />
          <DashboardMetricGrid metrics={metrics} showOperatorCards={showOperator} />
          {poLifecycleQueues ? (
            <DashboardPoLifecycleQueues queues={poLifecycleQueues} />
          ) : null}
          {operationalQueues ? (
            <DashboardOperationalQueues
              queues={operationalQueues}
              activeFilter={queueFilter}
              showOperatorQueues={showOperator}
            />
          ) : null}
          {feed ? <DashboardOperationalSections feed={feed} showAttention={false} /> : null}
          <DashboardRecentActivity rows={metrics.recentActivity} />
        </>
      ) : null}

      {user.tenantId ? (
        <div id="vendor-price-alerts" className="scroll-mt-8">
          <VendorPriceAlerts tenantId={user.tenantId} />
        </div>
      ) : null}

    </>
  );
}

function greeting(name: string | null, email: string): string {
  const fallback = email.split('@')[0] ?? email;
  const who = (name || fallback).split(' ')[0] ?? fallback;
  const hour = new Date().getHours();
  const tod = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  return `Good ${tod}, ${who}`;
}
