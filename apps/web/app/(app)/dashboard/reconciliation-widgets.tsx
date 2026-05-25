import Link from 'next/link';
import { prisma, SpendAlertStatus } from '@bvisible/db';
import { RECON_COMPARE_ONLY_BANNER } from '@/lib/reconciliation/ui-copy';
import { SpendAlertRow } from '@/components/reconciliation/spend-alert-row';

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
          <p className="mt-1 text-[12px] text-rose-900/90">{RECON_COMPARE_ONLY_BANNER}</p>
        </div>
        <Link
          href="/admin/reconciliation"
          className="shrink-0 text-[12.5px] font-medium text-rose-900 underline-offset-2 hover:underline"
        >
          Full inbox →
        </Link>
      </div>

      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((r) => (
          <SpendAlertRow
            key={r.id}
            alertId={r.id}
            title={r.title}
            body={r.body}
            kind={r.kind}
            purchaseOrderId={r.purchaseOrderId}
            purchaseOrderNumber={r.purchaseOrder?.number}
            vendorName={r.vendor?.name}
            vendorId={r.vendorId}
            variant="dashboard"
          />
        ))}
      </ul>
    </section>
  );
}
