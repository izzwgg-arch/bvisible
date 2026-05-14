import Link from 'next/link';
import { OcrJobStatus, prisma, Role } from '@bvisible/db';
import { requireRoleWithEffectiveCompany } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';

export const metadata = { title: 'Receipt OCR review' };
export const dynamic = 'force-dynamic';

const STATUS_OPTIONS = [
  OcrJobStatus.REVIEW_REQUIRED,
  OcrJobStatus.PENDING,
  OcrJobStatus.PROCESSING,
  OcrJobStatus.FAILED,
  OcrJobStatus.CONFIRMED,
  OcrJobStatus.REJECTED,
] as const;

export default async function OcrReviewIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const sp = await searchParams;
  const statusRaw = sp.status ?? 'review';
  const statusFilter =
    statusRaw === 'review'
      ? [
          OcrJobStatus.REVIEW_REQUIRED,
          OcrJobStatus.PENDING,
          OcrJobStatus.PROCESSING,
        ]
      : (STATUS_OPTIONS as readonly string[]).includes(statusRaw)
        ? [statusRaw as OcrJobStatus]
        : [
            OcrJobStatus.REVIEW_REQUIRED,
            OcrJobStatus.PENDING,
            OcrJobStatus.PROCESSING,
          ];

  const docs = await prisma.ocrDocument.findMany({
    where: {
      tenantId: me.tenantId,
      status: { in: statusFilter },
    },
    orderBy: [{ updatedAt: 'desc' }],
    include: {
      poAttachment: {
        select: {
          id: true,
          originalFilename: true,
          purchaseOrderId: true,
          purchaseOrder: { select: { number: true } },
        },
      },
    },
    take: 80,
  });

  return (
    <div>
      <PageHeader
        title="Receipt OCR review"
        subtitle="Local OCR suggestions — confirm before vendor price history is written."
      />

      <div className="mb-4 flex flex-wrap gap-2 text-[13px]">
        <Link
          className="rounded-md border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-1.5 font-medium text-[var(--color-bv-text)]"
          href="/admin/ocr-review?status=review"
        >
          Queue
        </Link>
        <Link
          className="rounded-md border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-1.5 font-medium text-[var(--color-bv-text)]"
          href="/admin/ocr-review?status=CONFIRMED"
        >
          Confirmed
        </Link>
        <Link
          className="rounded-md border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-1.5 font-medium text-[var(--color-bv-text)]"
          href="/admin/ocr-review?status=REJECTED"
        >
          Rejected
        </Link>
        <Link
          className="rounded-md border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-1.5 font-medium text-[var(--color-bv-text)]"
          href="/admin/ocr-review?status=FAILED"
        >
          Failed
        </Link>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)]">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead className="bg-[var(--color-bv-bg)] text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
            <tr>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">PO</th>
              <th className="px-4 py-3">File</th>
              <th className="px-4 py-3">Updated</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr
                key={d.id}
                className="border-t border-[var(--color-bv-border)] hover:bg-[var(--color-bv-bg)]"
              >
                <td className="px-4 py-3 font-medium">{d.status}</td>
                <td className="px-4 py-3">
                  {d.poAttachment ? (
                    <Link
                      className="text-emerald-700 underline"
                      href={`/purchase-orders/${d.poAttachment.purchaseOrderId}`}
                    >
                      {d.poAttachment.purchaseOrder.number}
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-3">
                  <Link
                    className="text-emerald-700 underline"
                    href={`/admin/ocr-review/${d.id}`}
                  >
                    {d.poAttachment?.originalFilename ?? d.id.slice(0, 8)}
                  </Link>
                </td>
                <td className="px-4 py-3 text-[var(--color-bv-muted)]">
                  {d.updatedAt.toISOString().slice(0, 19).replace('T', ' ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {docs.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-[var(--color-bv-muted)]">
            No OCR jobs in this filter.
          </p>
        ) : null}
      </div>
    </div>
  );
}
