import Link from 'next/link';
import { prisma, Role, SpendAlertStatus } from '@bvisible/db';
import { requireRoleWithEffectiveCompany } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { AdminMetric, AdminPanel, AdminPill, adminSecondaryButtonClass } from '@/components/app/admin-ui';
import { ReconciliationSafetyBanner } from '@/components/reconciliation/reconciliation-safety-banner';
import { ReconciliationStatusChip } from '@/components/reconciliation/reconciliation-badges';
import { SpendAlertRow } from '@/components/reconciliation/spend-alert-row';
import { RECON_EMPTY_NO_SNAPSHOT } from '@/lib/reconciliation/ui-copy';
import { QueuePaginationBar } from '@/components/app/queue-pagination-bar';
import {
  buildQueueLoadMoreHref,
  parseQueuePage,
  queueFetchTake,
  resolveQueuePage,
} from '@/lib/ui/queue-pagination';

export const metadata = { title: 'PO reconciliation inbox' };
export const dynamic = 'force-dynamic';

export default async function AdminReconciliationInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const tenantId = me.tenantId;
  const sp = await searchParams;
  const page = parseQueuePage(sp.page);

  const [recentRunsRaw, openAlertsRaw, openAlertTotal, runTotal] = await Promise.all([
    prisma.pOReconciliation.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: queueFetchTake(page),
      select: {
        id: true,
        status: true,
        createdAt: true,
        summary: true,
        purchaseOrder: {
          select: { id: true, number: true, vendor: { select: { name: true } } },
        },
      },
    }),
    prisma.spendAlert.findMany({
      where: { tenantId, status: SpendAlertStatus.OPEN },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: queueFetchTake(page),
      select: {
        id: true,
        title: true,
        body: true,
        kind: true,
        purchaseOrderId: true,
        purchaseOrder: { select: { number: true } },
      },
    }),
    prisma.spendAlert.count({
      where: { tenantId, status: SpendAlertStatus.OPEN },
    }),
    prisma.pOReconciliation.count({ where: { tenantId } }),
  ]);

  const {
    rows: openAlerts,
    hasMore: alertsHasMore,
    loadedCount: alertsLoaded,
  } = resolveQueuePage(openAlertsRaw, page);
  const {
    rows: recentRuns,
    hasMore: runsHasMore,
    loadedCount: runsLoaded,
  } = resolveQueuePage(recentRunsRaw, page);
  const listHasMore = alertsHasMore || runsHasMore;

  return (
    <>
      <PageHeader
        title="PO reconciliation inbox"
        subtitle="Compare purchase orders against OCR-approved receipts. Keep finance decisions explicit and operator-reviewed."
      />

      <section className="mb-5 grid gap-3 md:grid-cols-4">
        <AdminMetric label="Open alerts" value={openAlertTotal} detail="Need spend review" tone={openAlertTotal > 0 ? 'amber' : 'emerald'} />
        <AdminMetric label="Snapshots" value={runTotal} detail="Append-only reconciliation runs" />
        <AdminMetric label="Visible alerts" value={alertsLoaded} detail="Loaded in this queue" tone="violet" />
        <AdminMetric label="Visible runs" value={runsLoaded} detail="Recent snapshot rows" tone="slate" />
      </section>

      <div className="mb-5">
        <ReconciliationSafetyBanner compact />
      </div>

      <AdminPanel
        title="Open spend alerts"
        eyebrow="Variance control"
        description={openAlertTotal > 0 ? `${openAlertTotal} need review. Primary action opens the PO variance workspace.` : 'Nothing queued from the latest snapshots.'}
        action={<AdminPill tone={openAlertTotal > 0 ? 'amber' : 'emerald'}>{openAlertTotal > 0 ? 'review needed' : 'clean'}</AdminPill>}
        className="mb-5"
      >
        {openAlerts.length === 0 ? (
          <div className="m-4 rounded-[20px] border border-dashed border-emerald-200 bg-emerald-50/60 px-5 py-8">
            <p className="text-[14px] font-semibold text-emerald-950">Reconciliation inbox is clean</p>
            <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-emerald-900/80">
              No OPEN spend alerts. Alerts appear when a snapshot finds variance or coverage gaps
              between PO lines and OCR-approved receipts.
            </p>
            <Link
              href="/purchase-orders"
              className={adminSecondaryButtonClass + ' mt-4'}
            >
              Browse purchase orders
            </Link>
          </div>
        ) : (
            <ul className="flex flex-col gap-3 p-4">
              {openAlerts.map((a) => (
                <SpendAlertRow
                  key={a.id}
                  alertId={a.id}
                  title={a.title}
                  body={a.body}
                  kind={a.kind}
                  purchaseOrderId={a.purchaseOrderId}
                  purchaseOrderNumber={a.purchaseOrder?.number}
                  variant="inbox"
                />
              ))}
            </ul>
        )}
      </AdminPanel>

      <AdminPanel
        title="Recent reconciliation snapshots"
        eyebrow="Audit trail"
        description="Append-only runs deduped per OCR approval batch or manual refresh."
      >
        {recentRuns.length === 0 ? (
          <p className="p-5 text-[13px] text-slate-500">{RECON_EMPTY_NO_SNAPSHOT}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
              <thead className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                <tr>
                  <th className="px-3 py-2.5">PO</th>
                  <th className="px-3 py-2.5">Vendor</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">When</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-blue-50/35"
                  >
                    <td className="px-3 py-3 font-semibold text-slate-950">{r.purchaseOrder.number}</td>
                    <td className="px-3 py-3 text-slate-500">
                      {r.purchaseOrder.vendor?.name ?? '—'}
                    </td>
                    <td className="px-3 py-3">
                      <ReconciliationStatusChip status={r.status} />
                    </td>
                    <td className="px-3 py-3 text-[12px] tabular-nums text-slate-500">
                      {r.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Link
                        href={`/purchase-orders/${r.purchaseOrder.id}/reconciliation`}
                        className="text-[12.5px] font-semibold text-[var(--color-bv-accent)] underline-offset-2 hover:underline"
                      >
                        Review variance →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminPanel>

      {listHasMore ? (
        <QueuePaginationBar
          loaded={Math.max(alertsLoaded, runsLoaded)}
          total={Math.max(openAlertTotal, runTotal)}
          hasMore={listHasMore}
          loadMoreHref={buildQueueLoadMoreHref(
            '/admin/reconciliation',
            { page: page > 1 ? String(page) : undefined },
            page,
          )}
          suffix={`open alerts (${alertsLoaded}/${openAlertTotal}) · snapshots (${runsLoaded}/${runTotal})`}
        />
      ) : openAlertTotal > 0 || runTotal > 0 ? (
        <p className="mt-4 text-[11px] text-[var(--color-bv-muted)]">
          Showing {alertsLoaded} open alert{alertsLoaded === 1 ? '' : 's'}
          {openAlertTotal > alertsLoaded ? ` of ${openAlertTotal}` : ''}
          {' · '}
          {runsLoaded} snapshot{runsLoaded === 1 ? '' : 's'}
          {runTotal > runsLoaded ? ` of ${runTotal}` : ''}
        </p>
      ) : null}
    </>
  );
}
