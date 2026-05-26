import Link from 'next/link';
import { prisma, Role, SpendAlertStatus } from '@bvisible/db';
import { requireRoleWithEffectiveCompany } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
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
        subtitle="Variance queue after OCR-approved receipts. Review PO ↔ receipt pairs — finances never auto-adjust."
      />

      <ReconciliationSafetyBanner compact />

      <section className="mb-10 mt-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-[14px] font-semibold text-[var(--color-bv-text)]">
              Open spend alerts
            </h2>
            <p className="mt-0.5 text-[12px] text-[var(--color-bv-muted)]">
              {openAlertTotal > 0
                ? `${openAlertTotal} need review — primary action opens the PO variance workspace.`
                : 'Nothing queued from the latest snapshots.'}
            </p>
          </div>
        </div>

        {openAlerts.length === 0 ? (
          <div className="mt-4 rounded-[var(--radius-bv)] border border-dashed border-emerald-200 bg-emerald-50/40 px-5 py-8 shadow-[var(--shadow-bv-card)]">
            <p className="text-[13.5px] font-medium text-emerald-950">Reconciliation inbox is clean</p>
            <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-emerald-900/80">
              No OPEN spend alerts. Alerts appear when a snapshot finds variance or coverage gaps
              between PO lines and OCR-approved receipts.
            </p>
            <Link
              href="/purchase-orders"
              className="mt-4 inline-flex text-[13px] font-medium text-[var(--color-bv-accent)] underline-offset-2 hover:underline"
            >
              Browse purchase orders
            </Link>
          </div>
        ) : (
          <>
            <ul className="mt-4 flex flex-col gap-2">
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
          </>
        )}
      </section>

      <section>
        <h2 className="text-[14px] font-semibold text-[var(--color-bv-text)]">
          Recent reconciliation snapshots
        </h2>
        <p className="mt-0.5 text-[12px] text-[var(--color-bv-muted)]">
          Append-only runs — deduped per OCR approval batch or manual refresh.
        </p>
        {recentRuns.length === 0 ? (
          <p className="mt-4 text-[13px] text-[var(--color-bv-muted)]">{RECON_EMPTY_NO_SNAPSHOT}</p>
        ) : (
          <>
          <div className="mt-4 overflow-x-auto rounded-[10px] border border-[var(--color-bv-border)]">
            <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
              <thead className="border-b border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
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
                    className="border-b border-[var(--color-bv-border)] last:border-0"
                  >
                    <td className="px-3 py-2.5 font-medium">{r.purchaseOrder.number}</td>
                    <td className="px-3 py-2.5 text-[var(--color-bv-muted)]">
                      {r.purchaseOrder.vendor?.name ?? '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <ReconciliationStatusChip status={r.status} />
                    </td>
                    <td className="px-3 py-2.5 text-[12px] tabular-nums text-[var(--color-bv-muted)]">
                      {r.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Link
                        href={`/purchase-orders/${r.purchaseOrder.id}/reconciliation`}
                        className="text-[12.5px] font-medium text-[var(--color-bv-accent)] underline-offset-2 hover:underline"
                      >
                        Review variance →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>

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
