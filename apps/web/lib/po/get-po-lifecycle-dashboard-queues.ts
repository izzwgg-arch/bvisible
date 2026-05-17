import type { PrismaClient } from '@bvisible/db';
import { POStatus, prisma } from '@bvisible/db';
import {
  lifecycleBucketForState,
  PO_LIFECYCLE_LABELS,
  PO_LIFECYCLE_QUEUE_LABELS,
  type PoLifecycleQueueBucket,
} from './po-lifecycle-matrix';
import { countOcrBuckets, parsePoLifecycleOperatorFlags } from './po-lifecycle-signals';
import {
  getPoLifecycleStaleInfo,
  getPurchaseOrderLifecycleNextAction,
  getPurchaseOrderLifecycleReason,
  getPurchaseOrderLifecycleState,
} from './po-lifecycle-state';
import type { PoLifecycleSignals } from './po-lifecycle-signals';
import {
  OcrJobStatus,
  POEventKind,
  SpendAlertStatus,
  VendorPriceExtractionMethod,
} from '@bvisible/db';

export type PoLifecycleQueueRow = {
  id: string;
  bucket: PoLifecycleQueueBucket;
  poId: string;
  poNumber: string;
  vendorName: string | null;
  customerLabel: string | null;
  lifecycleLabel: string;
  blockerReason: string;
  nextActionLabel: string;
  href: string;
  sortAt: Date;
  staleLabel: string | null;
  ownerUserId: string | null;
};

export type PoLifecycleDashboardQueues = {
  sections: Record<PoLifecycleQueueBucket, PoLifecycleQueueRow[]>;
  totalActionable: number;
};

const OPEN_PO: POStatus[] = [
  POStatus.SENT,
  POStatus.ORDERED,
  POStatus.PARTIALLY_RECEIVED,
];

export async function getPoLifecycleDashboardQueues(
  tenantId: string,
  opts: { now?: Date; currentUserId?: string | null; mineOnly?: boolean },
  db: Pick<PrismaClient, 'purchaseOrder' | 'pOReconciliation' | 'vendorPriceHistory' | 'spendAlert'> = prisma,
): Promise<PoLifecycleDashboardQueues> {
  const now = opts.now ?? new Date();
  const pos = await db.purchaseOrder.findMany({
    where: {
      tenantId,
      deletedAt: null,
      status: { in: [...OPEN_PO, POStatus.RECEIVED, POStatus.DRAFT] },
    },
    orderBy: { updatedAt: 'desc' },
    take: 60,
    select: {
      id: true,
      number: true,
      status: true,
      updatedAt: true,
      createdById: true,
      qboPoNumber: true,
      operatorMarkedReconciledAt: true,
      vendor: { select: { name: true } },
      estimate: {
        select: {
          id: true,
          status: true,
          client: { select: { companyName: true } },
          purchaseOrders: {
            where: { tenantId, deletedAt: null },
            select: { qboPoNumber: true },
          },
        },
      },
      events: {
        orderBy: { createdAt: 'asc' },
        select: { kind: true, createdAt: true },
      },
      attachments: {
        select: {
          sourceEmailId: true,
          ocrDocument: { select: { status: true } },
        },
      },
    },
  });

  const sections = Object.fromEntries(
    (Object.keys(PO_LIFECYCLE_QUEUE_LABELS) as PoLifecycleQueueBucket[]).map((b) => [
      b,
      [] as PoLifecycleQueueRow[],
    ]),
  ) as Record<PoLifecycleQueueBucket, PoLifecycleQueueRow[]>;

  const seen = new Set<string>();

  for (const po of pos) {
    if (opts.mineOnly && opts.currentUserId && po.createdById !== opts.currentUserId) {
      continue;
    }

    const ocrStatuses = po.attachments
      .map((a) => a.ocrDocument?.status)
      .filter((s): s is OcrJobStatus => s != null);
    const ocrBuckets = countOcrBuckets(ocrStatuses);
    const operatorFlags = parsePoLifecycleOperatorFlags(po.events);

    const [latestRecon, approvedLines, openAlerts] = await Promise.all([
      db.pOReconciliation.findFirst({
        where: { tenantId, purchaseOrderId: po.id },
        orderBy: { createdAt: 'desc' },
        select: { status: true, updatedAt: true },
      }),
      db.vendorPriceHistory.count({
        where: {
          tenantId,
          extractionMethod: VendorPriceExtractionMethod.OCR_APPROVED,
          sourcePoAttachment: { purchaseOrderId: po.id },
        },
      }),
      db.spendAlert.count({
        where: { tenantId, purchaseOrderId: po.id, status: SpendAlertStatus.OPEN },
      }),
    ]);

    const estimatePos = po.estimate?.purchaseOrders ?? [];
    const signals: PoLifecycleSignals = {
      poStatus: po.status,
      updatedAt: po.updatedAt,
      hasVendorReply: po.events.some((e) => e.kind === POEventKind.VENDOR_REPLY),
      vendorReplyHasAttachment: po.attachments.some((a) => a.sourceEmailId != null),
      isOperatorBlocked: operatorFlags.isOperatorBlocked,
      blockedAt: operatorFlags.blockedAt,
      operatorVendorAcknowledged: operatorFlags.operatorVendorAcknowledged,
      operatorReceivedComplete: operatorFlags.operatorReceivedComplete,
      ocrConfirmedCount: ocrBuckets.confirmed,
      ocrReviewRequiredCount: ocrBuckets.reviewRequired,
      ocrPendingCount: ocrBuckets.pending,
      approvedReceiptLineCount: approvedLines,
      hasReconciliationSnapshot: latestRecon != null,
      latestReconciliationStatus: latestRecon?.status ?? null,
      openSpendAlertCount: openAlerts,
      operatorMarkedReconciledAt: po.operatorMarkedReconciledAt,
      estimateStatus: po.estimate?.status ?? null,
      estimateFinalized: po.estimate?.status === 'FINALIZED',
      linkedEstimateHasQboOnAllPos:
        estimatePos.length > 0
          ? estimatePos.every((p) => p.qboPoNumber != null && p.qboPoNumber.trim() !== '')
          : null,
      qboPoNumber: po.qboPoNumber,
    };

    const state = getPurchaseOrderLifecycleState(signals);
    const bucket = lifecycleBucketForState(state);
    if (!bucket) continue;

    const rowKey = `${bucket}-${po.id}`;
    if (seen.has(rowKey)) continue;
    seen.add(rowKey);

    const stale = getPoLifecycleStaleInfo({
      state,
      signals,
      referenceAt: latestRecon?.updatedAt ?? po.updatedAt,
      now,
    });

    const next = getPurchaseOrderLifecycleNextAction({
      state,
      poId: po.id,
      estimateId: po.estimate?.id ?? null,
    });

    sections[bucket].push({
      id: rowKey,
      bucket,
      poId: po.id,
      poNumber: po.number,
      vendorName: po.vendor?.name ?? null,
      customerLabel: po.estimate?.client.companyName ?? null,
      lifecycleLabel: PO_LIFECYCLE_LABELS[state],
      blockerReason: getPurchaseOrderLifecycleReason(state, signals),
      nextActionLabel: next.label,
      href: next.href,
      sortAt: po.updatedAt,
      staleLabel: stale.label,
      ownerUserId: po.createdById,
    });
  }

  for (const b of Object.keys(sections) as PoLifecycleQueueBucket[]) {
    sections[b].sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime());
    sections[b] = sections[b].slice(0, 8);
  }

  const totalActionable = Object.values(sections).reduce((n, rows) => n + rows.length, 0);

  return { sections, totalActionable };
}

export { PO_LIFECYCLE_QUEUE_LABELS };
