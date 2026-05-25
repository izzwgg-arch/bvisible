import Link from 'next/link';
import { OcrJobStatus, prisma, Role } from '@bvisible/db';
import { requireRoleWithEffectiveCompany } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { EmptyState } from '@/components/app/empty-state';
import {
  OcrStaleBadge,
  OcrStatusChip,
  formatOcrRelativeTime,
} from '@/app/(app)/admin/ocr-review/ocr-review-ui';

export const metadata = { title: 'Receipt OCR review' };
export const dynamic = 'force-dynamic';

const QUEUE_STATUSES = [
  OcrJobStatus.REVIEW_REQUIRED,
  OcrJobStatus.PENDING,
  OcrJobStatus.PROCESSING,
] as const;

const TAB_DEFS = [
  { key: 'review', label: 'Queue', statuses: QUEUE_STATUSES },
  { key: OcrJobStatus.CONFIRMED, label: 'Confirmed', statuses: [OcrJobStatus.CONFIRMED] },
  { key: OcrJobStatus.REJECTED, label: 'Rejected', statuses: [OcrJobStatus.REJECTED] },
  { key: OcrJobStatus.FAILED, label: 'Failed', statuses: [OcrJobStatus.FAILED] },
] as const;

export default async function OcrReviewIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const sp = await searchParams;
  const statusRaw = sp.status ?? 'review';
  const activeTab = TAB_DEFS.find((t) => t.key === statusRaw) ?? TAB_DEFS[0];
  const statusFilter = [...activeTab.statuses];

  const [docs, statusCounts] = await Promise.all([
    prisma.ocrDocument.findMany({
      where: {
        tenantId: me.tenantId,
        status: { in: statusFilter },
      },
      orderBy: [{ updatedAt: 'desc' }],
      include: {
        _count: { select: { lineItems: true } },
        poAttachment: {
          select: {
            id: true,
            originalFilename: true,
            purchaseOrderId: true,
            purchaseOrder: {
              select: {
                number: true,
                vendor: { select: { name: true } },
              },
            },
          },
        },
      },
      take: 100,
    }),
    prisma.ocrDocument.groupBy({
      where: { tenantId: me.tenantId },
      by: ['status'],
      _count: { _all: true },
    }),
  ]);

  const countByStatus = Object.fromEntries(
    statusCounts.map((r) => [r.status, r._count._all])
  ) as Partial<Record<OcrJobStatus, number>>;

  function tabCount(tab: (typeof TAB_DEFS)[number]): number {
    return tab.statuses.reduce((sum, s) => sum + (countByStatus[s] ?? 0), 0);
  }

  const now = new Date();

  return (
    <div className="-mx-1 rounded-xl bg-[var(--color-bv-bg)] px-1 pb-2">
      <PageHeader
        title="Receipt OCR review"
        subtitle="Scan the queue, open attachments, approve lines — pricing writes only after you confirm."
      />

      <div className="mb-3 flex flex-wrap gap-1.5">
        {TAB_DEFS.map((tab) => {
          const count = tabCount(tab);
          const active = tab.key === activeTab.key;
          return (
            <Link
              key={tab.key}
              href={`/admin/ocr-review?status=${tab.key}`}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                active
                  ? 'bg-[var(--color-bv-accent)] text-[var(--color-bv-accent-foreground)]'
                  : 'border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] text-[var(--color-bv-muted)] hover:bg-[var(--color-bv-bg)]'
              }`}
            >
              {tab.label}
              {count > 0 ? (
                <span
                  className={`tabular-nums text-[10px] font-semibold ${
                    active ? 'opacity-90' : 'text-[var(--color-bv-muted)]'
                  }`}
                >
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>

      {docs.length === 0 ? (
        <OcrEmptyState statusRaw={statusRaw} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
          <table className="w-full border-collapse text-left text-[12px]">
            <thead className="border-b border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[10px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
              <tr>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">PO</th>
                <th className="px-3 py-2">Vendor</th>
                <th className="px-3 py-2">Attachment</th>
                <th className="px-3 py-2 text-center">Lines</th>
                <th className="px-3 py-2 text-right">Updated</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr
                  key={d.id}
                  className="border-t border-[var(--color-bv-border)] hover:bg-[var(--color-bv-bg)]/60"
                >
                  <td className="px-3 py-1.5">
                    <div className="flex flex-wrap items-center gap-1">
                      <OcrStatusChip status={d.status} />
                      <OcrStaleBadge status={d.status} updatedAt={d.updatedAt} />
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    {d.poAttachment ? (
                      <Link
                        className="font-medium text-emerald-700 underline-offset-2 hover:underline"
                        href={`/purchase-orders/${d.poAttachment.purchaseOrderId}`}
                      >
                        {d.poAttachment.purchaseOrder.number}
                      </Link>
                    ) : (
                      <span className="text-[var(--color-bv-muted)]">—</span>
                    )}
                  </td>
                  <td className="max-w-[140px] truncate px-3 py-1.5 text-[var(--color-bv-muted)]">
                    {d.poAttachment?.purchaseOrder.vendor?.name ?? '—'}
                  </td>
                  <td className="max-w-[220px] px-3 py-1.5">
                    <Link
                      className="block truncate font-medium text-[var(--color-bv-text)] underline-offset-2 hover:text-emerald-700 hover:underline"
                      href={`/admin/ocr-review/${d.id}`}
                      title={d.poAttachment?.originalFilename ?? d.id}
                    >
                      {d.poAttachment?.originalFilename ?? d.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-center tabular-nums">
                    <span className="inline-flex min-w-[1.75rem] justify-center rounded-full bg-[var(--color-bv-bg)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-bv-muted)]">
                      {d._count.lineItems}
                    </span>
                  </td>
                  <td
                    className="px-3 py-1.5 text-right tabular-nums text-[var(--color-bv-muted)]"
                    title={d.updatedAt.toISOString()}
                  >
                    {formatOcrRelativeTime(d.updatedAt, now)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OcrEmptyState({ statusRaw }: { statusRaw: string }) {
  if (statusRaw === 'review') {
    return (
      <EmptyState
        title="Receipt OCR queue is clear"
        description="Upload receipts on a purchase order; after local OCR runs, suggestions appear here for operator confirmation."
        primaryAction={{ label: 'Open purchase orders', href: '/purchase-orders' }}
      />
    );
  }
  if (statusRaw === 'CONFIRMED') {
    return (
      <EmptyState
        title="No confirmed documents yet"
        description="Approved OCR batches move here after an operator confirms lines."
        primaryAction={{ label: 'Back to queue', href: '/admin/ocr-review?status=review' }}
      />
    );
  }
  if (statusRaw === 'REJECTED') {
    return (
      <EmptyState
        title="No rejected documents"
        description="Rejected OCR attempts are listed here for audit."
        primaryAction={{ label: 'Back to queue', href: '/admin/ocr-review?status=review' }}
      />
    );
  }
  if (statusRaw === 'FAILED') {
    return (
      <EmptyState
        title="No failed OCR jobs"
        description="Engine failures land here — open a row to see the error and retry from the PO attachments panel."
        primaryAction={{ label: 'Back to queue', href: '/admin/ocr-review?status=review' }}
      />
    );
  }
  return (
    <EmptyState
      title="Nothing in this filter"
      description="Try another tab above, or open the queue to review pending receipts."
      primaryAction={{ label: 'Open queue', href: '/admin/ocr-review?status=review' }}
    />
  );
}
