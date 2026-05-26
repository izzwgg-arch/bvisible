import Link from 'next/link';
import { OcrJobStatus, prisma, Role } from '@bvisible/db';
import { requireRoleWithEffectiveCompany } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { EmptyState } from '@/components/app/empty-state';
import { isOcrQueueStale } from '@/app/(app)/admin/ocr-review/ocr-review-ui';
import { OcrQueueTable, type OcrQueueRow } from '@/app/(app)/admin/ocr-review/ocr-queue-table';
import { QueuePaginationBar } from '@/components/app/queue-pagination-bar';
import {
  buildQueueLoadMoreHref,
  parseQueuePage,
  queueFetchTake,
  resolveQueuePage,
} from '@/lib/ui/queue-pagination';
import { STALE_OCR_REVIEW_MS } from '@/lib/workflow/operational-stale';

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
  searchParams: Promise<{ status?: string; stale?: string; page?: string }>;
}) {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const sp = await searchParams;
  const statusRaw = sp.status ?? 'review';
  const activeTab = TAB_DEFS.find((t) => t.key === statusRaw) ?? TAB_DEFS[0];
  const statusFilter = [...activeTab.statuses];
  const staleOnly = sp.stale === '1' && activeTab.key === 'review';
  const page = parseQueuePage(sp.page);
  const now = new Date();

  const listWhere = {
    tenantId: me.tenantId,
    status: { in: statusFilter },
    ...(staleOnly
      ? {
          updatedAt: {
            lt: new Date(now.getTime() - STALE_OCR_REVIEW_MS),
          },
        }
      : {}),
  };

  const [docsRaw, statusCounts, queueDocsForStaleCount, tabTotal] = await Promise.all([
    prisma.ocrDocument.findMany({
      where: listWhere,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
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
      take: queueFetchTake(page),
    }),
    prisma.ocrDocument.groupBy({
      where: { tenantId: me.tenantId },
      by: ['status'],
      _count: { _all: true },
    }),
    activeTab.key === 'review'
      ? prisma.ocrDocument.findMany({
          where: {
            tenantId: me.tenantId,
            status: { in: [...QUEUE_STATUSES] },
          },
          select: { id: true, status: true, updatedAt: true },
        })
      : Promise.resolve([]),
    staleOnly
      ? prisma.ocrDocument.count({ where: listWhere })
      : prisma.ocrDocument.count({
          where: { tenantId: me.tenantId, status: { in: statusFilter } },
        }),
  ]);

  const { rows: docs, hasMore, loadedCount } = resolveQueuePage(docsRaw, page);

  const countByStatus = Object.fromEntries(
    statusCounts.map((r) => [r.status, r._count._all])
  ) as Partial<Record<OcrJobStatus, number>>;

  function tabCount(tab: (typeof TAB_DEFS)[number]): number {
    return tab.statuses.reduce((sum, s) => sum + (countByStatus[s] ?? 0), 0);
  }

  const staleQueueCount = queueDocsForStaleCount.filter((d) =>
    isOcrQueueStale(d.status, d.updatedAt, now)
  ).length;

  const queueRows: OcrQueueRow[] = docs.map((d) => ({
    id: d.id,
    status: d.status,
    updatedAt: d.updatedAt.toISOString(),
    lineCount: d._count.lineItems,
    attachmentLabel: d.poAttachment?.originalFilename ?? d.id.slice(0, 8),
    attachmentTitle: d.poAttachment?.originalFilename ?? d.id,
    poId: d.poAttachment?.purchaseOrderId ?? null,
    poNumber: d.poAttachment?.purchaseOrder.number ?? null,
    vendorName: d.poAttachment?.purchaseOrder.vendor?.name ?? null,
  }));

  const tabHref = (tabKey: string, stale?: boolean) => {
    const params = new URLSearchParams({ status: tabKey });
    if (stale) params.set('stale', '1');
    return `/admin/ocr-review?${params.toString()}`;
  };

  return (
    <div className="-mx-1 rounded-xl bg-[var(--color-bv-bg)] px-1 pb-2">
      <PageHeader
        title="Receipt OCR review"
        subtitle="Dense queue — open, confirm lines, approve. Pricing writes only after you confirm."
      />

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {TAB_DEFS.map((tab) => {
          const count = tabCount(tab);
          const active = tab.key === activeTab.key && !staleOnly;
          return (
            <Link
              key={tab.key}
              href={tabHref(tab.key)}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                active
                  ? 'bg-[var(--color-bv-accent)] text-[var(--color-bv-accent-foreground)]'
                  : 'border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] text-[var(--color-bv-muted)] hover:bg-[var(--color-bv-bg)]'
              }`}
            >
              {tab.label}
              <span
                className={`tabular-nums text-[10px] font-semibold ${
                  active ? 'opacity-90' : 'text-[var(--color-bv-muted)]'
                }`}
              >
                {count}
              </span>
            </Link>
          );
        })}
        {activeTab.key === 'review' && staleQueueCount > 0 ? (
          <Link
            href={staleOnly ? tabHref('review') : tabHref('review', true)}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
              staleOnly
                ? 'bg-orange-600 text-white'
                : 'border border-orange-200 bg-orange-50 text-orange-950 hover:bg-orange-100'
            }`}
          >
            Stale
            <span className="tabular-nums text-[10px] font-semibold">{staleQueueCount}</span>
          </Link>
        ) : null}
      </div>

      {docs.length === 0 ? (
        <OcrEmptyState statusRaw={statusRaw} staleOnly={staleOnly} />
      ) : (
        <>
          <OcrQueueTable rows={queueRows} nowIso={now.toISOString()} />
          <QueuePaginationBar
            loaded={loadedCount}
            total={staleOnly ? tabTotal : tabCount(activeTab)}
            hasMore={hasMore}
            loadMoreHref={buildQueueLoadMoreHref('/admin/ocr-review', {
              status: activeTab.key,
              stale: staleOnly ? '1' : undefined,
              page: page > 1 ? String(page) : undefined,
            }, page)}
            suffix={
              staleOnly
                ? `stale in ${activeTab.label.toLowerCase()}`
                : `in ${activeTab.label.toLowerCase()}`
            }
          />
        </>
      )}
    </div>
  );
}

function OcrEmptyState({
  statusRaw,
  staleOnly,
}: {
  statusRaw: string;
  staleOnly: boolean;
}) {
  if (staleOnly) {
    return (
      <EmptyState
        title="No stale OCR jobs"
        description="Nothing in the queue has been waiting more than two days."
        primaryAction={{ label: 'Show full queue', href: '/admin/ocr-review?status=review' }}
      />
    );
  }
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
