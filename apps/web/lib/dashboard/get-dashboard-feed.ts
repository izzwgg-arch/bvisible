import {
  EmailIngestStatus,
  OcrJobStatus,
  prisma,
  SpendAlertStatus,
} from '@bvisible/db';

export interface DashboardRecentEstimate {
  id: string;
  number: string;
  title: string;
  status: string;
  updatedAt: Date;
}

export interface DashboardRecentPo {
  id: string;
  number: string;
  status: string;
  vendorName: string | null;
  updatedAt: Date;
}

export type AttentionFeedKind = 'spend' | 'vendor_price' | 'ocr_queue' | 'email_inbox';

export interface AttentionFeedItem {
  kind: AttentionFeedKind;
  title: string;
  subtitle: string | null;
  href: string;
  createdAt: Date;
}

export interface DashboardOperationalFeed {
  recentEstimates: DashboardRecentEstimate[];
  recentPurchaseOrders: DashboardRecentPo[];
  attentionItems: AttentionFeedItem[];
}

export async function getDashboardOperationalFeed(
  tenantId: string,
  opts: { includeOperatorAttention: boolean },
): Promise<DashboardOperationalFeed> {
  const [
    recentEstimates,
    recentPurchaseOrders,
    spendAlerts,
    vendorNotes,
    unmatchedEmailCount,
    pendingOcrCount,
  ] = await Promise.all([
    prisma.estimate.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 6,
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        updatedAt: true,
      },
    }),
    prisma.purchaseOrder.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 6,
      select: {
        id: true,
        number: true,
        status: true,
        updatedAt: true,
        vendor: { select: { name: true } },
      },
    }),
    opts.includeOperatorAttention
      ? prisma.spendAlert.findMany({
          where: { tenantId, status: SpendAlertStatus.OPEN },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            title: true,
            body: true,
            createdAt: true,
            purchaseOrderId: true,
          },
        })
      : Promise.resolve([]),
    prisma.vendorPriceNotification.findMany({
      where: { tenantId, dismissedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 4,
      select: {
        id: true,
        createdAt: true,
        vendor: { select: { name: true } },
        catalogItem: { select: { nameNormalized: true } },
      },
    }),
    opts.includeOperatorAttention
      ? prisma.ingestedEmail.count({
          where: {
            tenantId,
            status: { in: [EmailIngestStatus.UNMATCHED, EmailIngestStatus.PENDING] },
          },
        })
      : Promise.resolve(0),
    opts.includeOperatorAttention
      ? prisma.ocrDocument.count({
          where: {
            tenantId,
            status: {
              in: [
                OcrJobStatus.REVIEW_REQUIRED,
                OcrJobStatus.PENDING,
                OcrJobStatus.PROCESSING,
              ],
            },
          },
        })
      : Promise.resolve(0),
  ]);

  const attentionItems: AttentionFeedItem[] = [];

  for (const a of spendAlerts) {
    attentionItems.push({
      kind: 'spend',
      title: a.title,
      subtitle: a.body,
      href: a.purchaseOrderId
        ? `/purchase-orders/${a.purchaseOrderId}/reconciliation`
        : '/admin/reconciliation',
      createdAt: a.createdAt,
    });
  }

  for (const n of vendorNotes) {
    attentionItems.push({
      kind: 'vendor_price',
      title: `Vendor price: ${n.vendor.name}`,
      subtitle: n.catalogItem.nameNormalized,
      href: '/dashboard#vendor-price-alerts',
      createdAt: n.createdAt,
    });
  }

  if (opts.includeOperatorAttention && pendingOcrCount > 0) {
    attentionItems.push({
      kind: 'ocr_queue',
      title: `${pendingOcrCount} receipt OCR ${pendingOcrCount === 1 ? 'job' : 'jobs'} need attention`,
      subtitle: 'Confirm extracted lines before they affect vendor history.',
      href: '/admin/ocr-review',
      createdAt: new Date(),
    });
  }

  if (opts.includeOperatorAttention && unmatchedEmailCount > 0) {
    attentionItems.push({
      kind: 'email_inbox',
      title: `${unmatchedEmailCount} inbound ${unmatchedEmailCount === 1 ? 'message' : 'messages'} need matching`,
      subtitle: 'Link vendor mail to the correct PO.',
      href: '/admin/email-ingestion',
      createdAt: new Date(),
    });
  }

  attentionItems.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return {
    recentEstimates,
    recentPurchaseOrders: recentPurchaseOrders.map((po) => ({
      id: po.id,
      number: po.number,
      status: po.status,
      updatedAt: po.updatedAt,
      vendorName: po.vendor?.name ?? null,
    })),
    attentionItems: attentionItems.slice(0, 10),
  };
}
