import {
  OcrJobStatus,
  POEventKind,
  POReconciliationStatus,
  POStatus,
  SpendAlertStatus,
  VendorPriceExtractionMethod,
  prisma,
} from '@bvisible/db';
import { reconciliationNeedsAttention } from '@/lib/estimate/estimate-fulfillment';
import type { PurchaseOrderLifecycleState } from './po-lifecycle-matrix';
import { PO_LIFECYCLE_LABELS } from './po-lifecycle-matrix';
import {
  countOcrBuckets,
  parsePoLifecycleOperatorFlags,
  type PoLifecycleSignals,
} from './po-lifecycle-signals';
import {
  deriveReadyToFinalizeOverlay,
  getPoLifecycleStaleInfo,
  getPurchaseOrderLifecycleNextAction,
  getPurchaseOrderLifecycleReason,
  getPurchaseOrderLifecycleState,
} from './po-lifecycle-state';

export type PoLifecycleSnapshot = {
  state: PurchaseOrderLifecycleState;
  label: string;
  reason: string;
  nextAction: { label: string; href: string };
  isStale: boolean;
  staleLabel: string | null;
  isBlocked: boolean;
  vendorResponseLabel: string;
  receiptProgressLabel: string;
  signals: PoLifecycleSignals;
};

export async function getPoLifecycleSnapshot(
  tenantId: string,
  purchaseOrderId: string,
  now: Date = new Date(),
): Promise<PoLifecycleSnapshot | null> {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, tenantId, deletedAt: null },
    select: {
      id: true,
      status: true,
      updatedAt: true,
      qboPoNumber: true,
      operatorMarkedReconciledAt: true,
      estimate: {
        select: {
          id: true,
          status: true,
          purchaseOrders: {
            where: { tenantId, deletedAt: null },
            select: { qboPoNumber: true },
          },
        },
      },
      events: {
        orderBy: { createdAt: 'asc' },
        select: { kind: true, createdAt: true, sourceEmailId: true },
      },
      attachments: {
        select: {
          id: true,
          sourceEmailId: true,
          ocrDocument: { select: { status: true } },
        },
      },
    },
  });

  if (!po) return null;

  const ocrStatuses = po.attachments
    .map((a) => a.ocrDocument?.status)
    .filter((s): s is OcrJobStatus => s != null);
  const ocrBuckets = countOcrBuckets(ocrStatuses);

  const vendorReplyEvents = po.events.filter((e) => e.kind === POEventKind.VENDOR_REPLY);
  const vendorReplyHasAttachment = po.attachments.some((a) => a.sourceEmailId != null);

  const operatorFlags = parsePoLifecycleOperatorFlags(po.events);

  const [latestRecon, approvedLines, openAlerts] = await Promise.all([
    prisma.pOReconciliation.findFirst({
      where: { tenantId, purchaseOrderId },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    }),
    prisma.vendorPriceHistory.count({
      where: {
        tenantId,
        extractionMethod: VendorPriceExtractionMethod.OCR_APPROVED,
        sourcePoAttachment: { purchaseOrderId },
      },
    }),
    prisma.spendAlert.count({
      where: { tenantId, purchaseOrderId, status: SpendAlertStatus.OPEN },
    }),
  ]);

  const estimatePos = po.estimate?.purchaseOrders ?? [];
  const linkedEstimateHasQboOnAllPos =
    estimatePos.length > 0
      ? estimatePos.every((p) => p.qboPoNumber != null && p.qboPoNumber.trim() !== '')
      : null;

  const signals: PoLifecycleSignals = {
    poStatus: po.status,
    updatedAt: po.updatedAt,
    hasVendorReply: vendorReplyEvents.length > 0,
    vendorReplyHasAttachment,
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
    linkedEstimateHasQboOnAllPos,
    qboPoNumber: po.qboPoNumber,
  };

  const state = getPurchaseOrderLifecycleState(signals);
  const stale = getPoLifecycleStaleInfo({
    state,
    signals,
    referenceAt: po.updatedAt,
    now,
  });

  const vendorResponseLabel = signals.isOperatorBlocked
    ? 'Blocked by operator'
    : signals.hasVendorReply || signals.operatorVendorAcknowledged
      ? 'Vendor responded'
      : po.status === POStatus.DRAFT
        ? 'Not sent'
        : 'Awaiting vendor';

  const receiptParts: string[] = [];
  if (ocrBuckets.reviewRequired > 0) {
    receiptParts.push(`${ocrBuckets.reviewRequired} OCR need review`);
  }
  if (ocrBuckets.confirmed > 0) {
    receiptParts.push(`${ocrBuckets.confirmed} OCR confirmed`);
  }
  if (approvedLines > 0) {
    receiptParts.push(`${approvedLines} approved line${approvedLines === 1 ? '' : 's'}`);
  }
  if (latestRecon) {
    receiptParts.push(
      reconciliationNeedsAttention(latestRecon.status)
        ? `Recon: ${latestRecon.status}`
        : 'Recon: matched',
    );
  }
  const receiptProgressLabel =
    receiptParts.length > 0 ? receiptParts.join(' · ') : 'No receipt OCR yet';

  return {
    state,
    label: PO_LIFECYCLE_LABELS[state],
    reason: getPurchaseOrderLifecycleReason(state, signals),
    nextAction: getPurchaseOrderLifecycleNextAction({
      state,
      poId: purchaseOrderId,
      estimateId: po.estimate?.id ?? null,
    }),
    isStale: stale.isStale,
    staleLabel: stale.label,
    isBlocked: signals.isOperatorBlocked || state === 'variance_detected',
    vendorResponseLabel,
    receiptProgressLabel,
    signals,
  };
}
