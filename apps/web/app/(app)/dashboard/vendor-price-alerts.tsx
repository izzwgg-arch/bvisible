import Link from 'next/link';
import { prisma } from '@bvisible/db';
import { dismissVendorPriceNotificationAction } from '@/lib/vendor-pricing/actions';

function fmtMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export async function VendorPriceAlerts({ tenantId }: { tenantId: string }) {
  const rows = await prisma.vendorPriceNotification.findMany({
    where: { tenantId, dismissedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 12,
    select: {
      id: true,
      oldPriceCents: true,
      newPriceCents: true,
      createdAt: true,
      vendorId: true,
      vendor: { select: { name: true } },
      catalogItem: { select: { nameNormalized: true } },
      sourceEmail: {
        select: {
          matchedPurchaseOrderId: true,
          subject: true,
        },
      },
    },
  });

  if (rows.length === 0) return null;

  return (
    <section className="mb-6 rounded-[var(--radius-bv)] border border-amber-200 bg-amber-50 p-5 shadow-[var(--shadow-bv-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-amber-950">
            Vendor price alerts
          </h2>
          <p className="mt-1 text-[12.5px] text-amber-900">
            A matched vendor email quoted a lower price than the last recorded
            price for that item. Nothing is auto-updated — dismiss when
            reviewed (R-VEN-03).
          </p>
        </div>
      </div>
      <ul className="mt-4 flex flex-col gap-3">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex flex-col gap-2 rounded-[8px] border border-amber-200 bg-white px-3 py-2.5 text-[13px] text-amber-950 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                <Link
                  href={`/vendors/${r.vendorId}`}
                  className="text-[var(--color-bv-accent)] underline-offset-2 hover:underline"
                >
                  {r.vendor.name}
                </Link>
                <span className="text-[var(--color-bv-muted)]"> · </span>
                <span className="font-mono text-[12px]">
                  {r.catalogItem.nameNormalized}
                </span>
              </div>
              <div className="mt-0.5 text-[12px] text-amber-900">
                {fmtMoney(r.oldPriceCents)} → {fmtMoney(r.newPriceCents)}{' '}
                <span className="text-emerald-700">
                  (−{fmtMoney(r.oldPriceCents - r.newPriceCents)})
                </span>
              </div>
              <div className="mt-1 truncate text-[11px] text-amber-800">
                Email: {r.sourceEmail.subject}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {r.sourceEmail.matchedPurchaseOrderId ? (
                <Link
                  href={`/purchase-orders/${r.sourceEmail.matchedPurchaseOrderId}`}
                  className="inline-flex rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-surface)]"
                >
                  View PO
                </Link>
              ) : null}
              <form action={dismissVendorPriceNotificationAction}>
                <input type="hidden" name="notificationId" value={r.id} />
                <button
                  type="submit"
                  className="inline-flex rounded-[6px] bg-[var(--color-bv-text)] px-2.5 py-1 text-[12px] font-medium text-white hover:opacity-90"
                >
                  Dismiss
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
