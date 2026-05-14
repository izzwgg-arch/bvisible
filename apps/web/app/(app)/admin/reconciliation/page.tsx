import Link from 'next/link';
import {
  POReconciliationStatus,
  prisma,
  Role,
  SpendAlertKind,
  SpendAlertStatus,
} from '@bvisible/db';
import { requireRole } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { dismissSpendAlertFormAction } from '@/lib/reconciliation/actions';

export const metadata = { title: 'PO reconciliation inbox' };
export const dynamic = 'force-dynamic';

function statusLabel(s: POReconciliationStatus): string {
  return s.replaceAll('_', ' ');
}

export default async function AdminReconciliationInboxPage() {
  const me = await requireRole(Role.ADMIN, Role.SUPER_ADMIN);
  if (!me.tenantId) {
    return (
      <PageHeader
        title="PO reconciliation"
        subtitle="Assign a tenant to your admin user to review reconciliation snapshots."
      />
    );
  }

  const tenantId = me.tenantId;

  const [recentRuns, openAlerts] = await Promise.all([
    prisma.pOReconciliation.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 40,
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
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: {
        id: true,
        title: true,
        kind: true,
        purchaseOrderId: true,
        purchaseOrder: { select: { number: true } },
      },
    }),
  ]);

  const priceAlerts = openAlerts.filter(
    (a) => a.kind === SpendAlertKind.PRICE_OVER_PO_EXPECTED,
  );

  return (
    <>
      <PageHeader
        title="PO reconciliation inbox"
        subtitle="Deterministic PO ↔ approved receipt pairing. Humans dismiss alerts and stamp reconciliations — nothing auto-mutates finances."
      />

      <section className="mb-10">
        <h2 className="text-[14px] font-semibold text-[var(--color-bv-text)]">
          Open spend alerts
        </h2>
        <p className="mt-1 text-[12.5px] text-[var(--color-bv-muted)]">
          Top price variances and coverage gaps from the latest snapshots.
        </p>
        {openAlerts.length === 0 ? (
          <p className="mt-4 text-[13px] text-[var(--color-bv-muted)]">
            No open alerts.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {openAlerts.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-3 text-[13px]"
              >
                <div className="min-w-0">
                  <div className="font-medium text-[var(--color-bv-text)]">
                    {a.title}
                  </div>
                  <div className="mt-0.5 text-[11px] uppercase tracking-wide text-[var(--color-bv-muted)]">
                    {a.kind.replaceAll('_', ' ')}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {a.purchaseOrderId ? (
                    <Link
                      href={`/purchase-orders/${a.purchaseOrderId}/reconciliation`}
                      className="rounded-[8px] bg-[var(--color-bv-accent)] px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-95"
                    >
                      {a.purchaseOrder?.number ?? 'PO'}
                    </Link>
                  ) : null}
                  <form>
                    <input type="hidden" name="alertId" value={a.id} />
                    <button
                      type="submit"
                      formAction={dismissSpendAlertFormAction}
                      className="rounded-[8px] border border-[var(--color-bv-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
                    >
                      Dismiss
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-[14px] font-semibold text-[var(--color-bv-text)]">
          Recent reconciliation snapshots
        </h2>
        <p className="mt-1 text-[12.5px] text-[var(--color-bv-muted)]">
          Append-only runs — replay deduped per OCR approval batch or manual refresh.
        </p>
        {recentRuns.length === 0 ? (
          <p className="mt-4 text-[13px] text-[var(--color-bv-muted)]">
            No reconciliation rows yet. Approve OCR lines on a PO to enqueue the first snapshot.
          </p>
        ) : (
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
                    <td className="px-3 py-2.5 font-medium">
                      {r.purchaseOrder.number}
                    </td>
                    <td className="px-3 py-2.5 text-[var(--color-bv-muted)]">
                      {r.purchaseOrder.vendor?.name ?? '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-800">
                        {statusLabel(r.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[12px] text-[var(--color-bv-muted)]">
                      {r.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Link
                        href={`/purchase-orders/${r.purchaseOrder.id}/reconciliation`}
                        className="text-[var(--color-bv-accent)] underline-offset-2 hover:underline"
                      >
                        Detail
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10 rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-950">
        <span className="font-semibold">Top price increases (open alerts): </span>
        {priceAlerts.length === 0
          ? 'None queued.'
          : `${priceAlerts.length} open — drill into each PO from the list above.`}
      </section>
    </>
  );
}
