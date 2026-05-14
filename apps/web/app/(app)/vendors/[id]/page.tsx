import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';

export const metadata = { title: 'Vendor pricing' };
export const dynamic = 'force-dynamic';

function fmtMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export default async function VendorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireTenantId();
  const { id } = await params;

  const vendor = await prisma.vendor.findFirst({
    where: { id, tenantId: me.tenantId, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      notes: true,
    },
  });
  if (!vendor) notFound();

  const history = await prisma.vendorPriceHistory.findMany({
    where: { tenantId: me.tenantId, vendorId: id },
    orderBy: { createdAt: 'desc' },
    take: 250,
    select: {
      id: true,
      itemNameRaw: true,
      itemNameNormalized: true,
      priceCents: true,
      unit: true,
      quantityMilli: true,
      confidence: true,
      extractionMethod: true,
      createdAt: true,
      sourceEmailId: true,
      vendorCatalogItemId: true,
      sourceEmail: {
        select: {
          subject: true,
          matchedPurchaseOrderId: true,
        },
      },
      sourcePoAttachment: {
        select: { purchaseOrderId: true },
      },
      ocrLineItem: {
        select: { ocrDocumentId: true },
      },
    },
  });

  const lowerThanPrior = new Set<string>();
  const byCatalog = new Map<string, typeof history>();
  for (const row of history) {
    const list = byCatalog.get(row.vendorCatalogItemId) ?? [];
    list.push(row);
    byCatalog.set(row.vendorCatalogItemId, list);
  }
  for (const [, rows] of byCatalog) {
    const sorted = [...rows].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
    for (let i = 0; i < sorted.length - 1; i++) {
      const newer = sorted[i]!;
      const older = sorted[i + 1]!;
      if (newer.priceCents < older.priceCents) {
        lowerThanPrior.add(newer.id);
      }
    }
  }

  return (
    <>
      <PageHeader
        title={vendor.name}
        subtitle="Vendor profile and price observation history (matched emails + approved receipt OCR)."
        actions={
          <Link
            href="/vendors"
            className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-1.5 text-[13px] text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
          >
            All vendors
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
          <h2 className="text-[15px] font-semibold text-[var(--color-bv-text)]">
            Contact
          </h2>
          <dl className="mt-3 grid grid-cols-[100px_1fr] gap-y-1.5 text-[13px]">
            <dt className="text-[var(--color-bv-muted)]">Email</dt>
            <dd>{vendor.email ?? '—'}</dd>
            <dt className="text-[var(--color-bv-muted)]">Phone</dt>
            <dd>{vendor.phone ?? '—'}</dd>
          </dl>
          {vendor.notes ? (
            <p className="mt-3 text-[12.5px] text-[var(--color-bv-muted)]">
              {vendor.notes}
            </p>
          ) : null}
        </section>
        <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
          <h2 className="text-[15px] font-semibold text-[var(--color-bv-text)]">
            Pricing intelligence
          </h2>
          <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--color-bv-muted)]">
            Rows are append-only observations from regex extraction on email
            subject, plain-text snippet, and attachment filenames — no PDF/OCR
            and no AI (Phase 10 foundation).
          </p>
        </section>
      </div>

      <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
        <div className="border-b border-[var(--color-bv-border)] px-5 py-3">
          <h2 className="text-[15px] font-semibold text-[var(--color-bv-text)]">
            Price history
          </h2>
          <p className="mt-0.5 text-[12px] text-[var(--color-bv-muted)]">
            Newest first · {history.length} row{history.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-bv-border)] text-left text-[11.5px] uppercase tracking-wider text-[var(--color-bv-muted)]">
                <th className="px-5 py-2 font-medium">When</th>
                <th className="px-5 py-2 font-medium">Item</th>
                <th className="px-5 py-2 font-medium">Price</th>
                <th className="px-5 py-2 font-medium">Src</th>
                <th className="px-5 py-2 font-medium">Confidence</th>
                <th className="px-5 py-2 font-medium">Email / PO</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr
                  key={h.id}
                  className="border-b border-[var(--color-bv-border)] last:border-b-0"
                >
                  <td className="whitespace-nowrap px-5 py-2.5 text-[var(--color-bv-muted)] tabular-nums">
                    {h.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                  </td>
                  <td className="max-w-[240px] px-5 py-2.5">
                    <div className="truncate font-mono text-[12px] text-[var(--color-bv-text)]">
                      {h.itemNameNormalized}
                    </div>
                    <div className="truncate text-[11px] text-[var(--color-bv-muted)]">
                      {h.itemNameRaw}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-5 py-2.5">
                    <span className="font-medium tabular-nums text-[var(--color-bv-text)]">
                      {fmtMoney(h.priceCents)}
                    </span>
                    {h.unit ? (
                      <span className="text-[11px] text-[var(--color-bv-muted)]">
                        {' '}
                        / {h.unit}
                      </span>
                    ) : null}
                    {lowerThanPrior.has(h.id) ? (
                      <span className="ml-2 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                        Lower vs prior
                      </span>
                    ) : null}
                  </td>
                  <td className="px-5 py-2.5 text-[11px] text-[var(--color-bv-muted)]">
                    {h.extractionMethod.replace(/_/g, ' ')}
                  </td>
                  <td className="px-5 py-2.5 text-[11px] capitalize text-[var(--color-bv-muted)]">
                    {h.confidence.toLowerCase()}
                  </td>
                  <td className="max-w-[200px] px-5 py-2.5">
                    <div className="truncate text-[11px] text-[var(--color-bv-muted)]">
                      {h.sourceEmail?.subject ??
                        (h.ocrLineItem
                          ? 'Receipt OCR (approved)'
                          : '—')}
                    </div>
                    {h.sourceEmail?.matchedPurchaseOrderId ? (
                      <Link
                        href={`/purchase-orders/${h.sourceEmail.matchedPurchaseOrderId}`}
                        className="text-[11px] text-[var(--color-bv-accent)] underline-offset-2 hover:underline"
                      >
                        Open PO
                      </Link>
                    ) : h.sourcePoAttachment?.purchaseOrderId ? (
                      <Link
                        href={`/purchase-orders/${h.sourcePoAttachment.purchaseOrderId}`}
                        className="text-[11px] text-[var(--color-bv-accent)] underline-offset-2 hover:underline"
                      >
                        Open PO
                      </Link>
                    ) : h.ocrLineItem ? (
                      <Link
                        href={`/admin/ocr-review/${h.ocrLineItem.ocrDocumentId}`}
                        className="text-[11px] text-[var(--color-bv-accent)] underline-offset-2 hover:underline"
                      >
                        OCR record
                      </Link>
                    ) : (
                      <span className="text-[11px] text-[var(--color-bv-muted)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {history.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-10 text-center text-[var(--color-bv-muted)]"
                  >
                    No extracted prices yet. Observations appear when matched
                    vendor emails contain line-like patterns, or when receipt OCR
                    rows are approved by an operator.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
