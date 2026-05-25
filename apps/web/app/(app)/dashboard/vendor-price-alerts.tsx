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
      sourceOcrDocument: {
        select: {
          id: true,
          poAttachment: {
            select: { purchaseOrderId: true },
          },
        },
      },
    },
  });

  if (rows.length === 0) {
    return (
      <details className="mb-4 rounded-[var(--radius-bv)] border border-dashed border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
        <summary className="cursor-pointer px-4 py-3 text-[12px] font-semibold text-[var(--color-bv-muted)] marker:content-none list-none [&::-webkit-details-marker]:hidden">
          Vendor price alerts — none active
        </summary>
        <p className="border-t border-[var(--color-bv-border)] px-4 pb-3 pt-2 text-[12px] text-[var(--color-bv-muted)]">
          Lower unit prices from mail or OCR appear here for review (nothing auto-updates).
        </p>
      </details>
    );
  }

  return (
    <section className="mb-4 rounded-[var(--radius-bv)] border border-amber-200 bg-amber-50 px-4 py-3 shadow-[var(--shadow-bv-card)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-semibold tracking-tight text-amber-950">
            Vendor price alerts ({rows.length})
          </h2>
          <p className="mt-0.5 text-[11.5px] text-amber-900">
            Review and dismiss — nothing auto-updates (R-VEN-03).
          </p>
        </div>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex flex-col gap-1.5 rounded-[8px] border border-amber-200 bg-white px-2.5 py-2 text-[12.5px] text-amber-950 sm:flex-row sm:items-center sm:justify-between"
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
                {r.sourceEmail ? (
                  <>Email: {r.sourceEmail.subject}</>
                ) : r.sourceOcrDocument ? (
                  <>
                    Source:{' '}
                    <Link
                      href={`/admin/ocr-review/${r.sourceOcrDocument.id}`}
                      className="underline-offset-2 hover:underline"
                    >
                      Receipt OCR review
                    </Link>
                  </>
                ) : (
                  <>Source: operational signal</>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {r.sourceEmail?.matchedPurchaseOrderId ? (
                <Link
                  href={`/purchase-orders/${r.sourceEmail.matchedPurchaseOrderId}`}
                  className="inline-flex rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-surface)]"
                >
                  View PO
                </Link>
              ) : r.sourceOcrDocument?.poAttachment?.purchaseOrderId ? (
                <Link
                  href={`/purchase-orders/${r.sourceOcrDocument.poAttachment.purchaseOrderId}`}
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
