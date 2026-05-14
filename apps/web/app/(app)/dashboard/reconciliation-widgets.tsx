import Link from 'next/link';
import { prisma, SpendAlertStatus } from '@bvisible/db';
import { dismissSpendAlertFormAction } from '@/lib/reconciliation/actions';

export async function SpendOperationAlerts({ tenantId }: { tenantId: string }) {
  const rows = await prisma.spendAlert.findMany({
    where: { tenantId, status: SpendAlertStatus.OPEN },
    orderBy: { createdAt: 'desc' },
    take: 14,
    select: {
      id: true,
      title: true,
      body: true,
      kind: true,
      createdAt: true,
      purchaseOrderId: true,
      vendorId: true,
      vendor: { select: { name: true } },
      purchaseOrder: { select: { number: true } },
    },
  });

  if (rows.length === 0) return null;

  return (
    <section className="mb-6 rounded-[var(--radius-bv)] border border-rose-200 bg-rose-50 p-5 shadow-[var(--shadow-bv-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-rose-950">
            Spend & reconciliation alerts
          </h2>
          <p className="mt-1 text-[12.5px] text-rose-900">
            Operational signals from PO ↔ receipt snapshots. Normalized labels only
            — no raw OCR text. Nothing auto-adjusts PO lines or accounting.
          </p>
        </div>
      </div>
      <ul className="mt-4 flex flex-col gap-3">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex flex-col gap-2 rounded-[8px] border border-rose-200 bg-white px-3 py-2.5 text-[13px] text-rose-950 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium">{r.title}</div>
              <div className="mt-0.5 text-[12px] text-rose-900">{r.body}</div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--color-bv-muted)]">
                <span className="rounded bg-rose-100 px-1.5 py-0.5 font-medium text-rose-900">
                  {r.kind.replaceAll('_', ' ')}
                </span>
                {r.vendor ? (
                  <Link
                    href={`/vendors/${r.vendorId}`}
                    className="text-[var(--color-bv-accent)] underline-offset-2 hover:underline"
                  >
                    {r.vendor.name}
                  </Link>
                ) : null}
                {r.purchaseOrderId && r.purchaseOrder ? (
                  <Link
                    href={`/purchase-orders/${r.purchaseOrderId}/reconciliation`}
                    className="text-[var(--color-bv-accent)] underline-offset-2 hover:underline"
                  >
                    {r.purchaseOrder.number}
                  </Link>
                ) : null}
              </div>
            </div>
            <form className="shrink-0">
              <input type="hidden" name="alertId" value={r.id} />
              <button
                type="submit"
                formAction={dismissSpendAlertFormAction}
                className="rounded-[8px] border border-rose-300 bg-white px-3 py-1.5 text-[12px] font-medium text-rose-900 hover:bg-rose-50"
              >
                Dismiss
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
