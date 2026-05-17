import type { EstimateStatus, OcrJobStatus, POEventKind, POReconciliationStatus, POStatus } from '@bvisible/db';
import { POEventKind as PEK } from '@bvisible/db';

export type PoLifecycleSignals = {
  poStatus: POStatus;
  updatedAt: Date;
  hasVendorReply: boolean;
  vendorReplyHasAttachment: boolean;
  isOperatorBlocked: boolean;
  blockedAt: Date | null;
  operatorVendorAcknowledged: boolean;
  operatorReceivedComplete: boolean;
  ocrConfirmedCount: number;
  ocrReviewRequiredCount: number;
  ocrPendingCount: number;
  approvedReceiptLineCount: number;
  hasReconciliationSnapshot: boolean;
  latestReconciliationStatus: POReconciliationStatus | null;
  openSpendAlertCount: number;
  operatorMarkedReconciledAt: Date | null;
  estimateStatus: EstimateStatus | null;
  estimateFinalized: boolean;
  linkedEstimateHasQboOnAllPos: boolean | null;
  qboPoNumber: string | null;
};

export function parsePoLifecycleOperatorFlags(
  events: ReadonlyArray<{ kind: POEventKind; createdAt: Date }>,
): {
  isOperatorBlocked: boolean;
  blockedAt: Date | null;
  operatorVendorAcknowledged: boolean;
  operatorReceivedComplete: boolean;
} {
  const sorted = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  let isOperatorBlocked = false;
  let blockedAt: Date | null = null;
  let operatorVendorAcknowledged = false;
  let operatorReceivedComplete = false;

  for (const e of sorted) {
    switch (e.kind) {
      case PEK.OPERATOR_BLOCKED:
        isOperatorBlocked = true;
        blockedAt = e.createdAt;
        break;
      case PEK.OPERATOR_BLOCKED_CLEARED:
        isOperatorBlocked = false;
        blockedAt = null;
        break;
      case PEK.OPERATOR_VENDOR_ACKNOWLEDGED:
        operatorVendorAcknowledged = true;
        break;
      case PEK.OPERATOR_RECEIVED_COMPLETE:
        operatorReceivedComplete = true;
        break;
      default:
        break;
    }
  }

  return {
    isOperatorBlocked,
    blockedAt,
    operatorVendorAcknowledged,
    operatorReceivedComplete,
  };
}

export function countOcrBuckets(
  statuses: ReadonlyArray<OcrJobStatus>,
): {
  confirmed: number;
  reviewRequired: number;
  pending: number;
} {
  let confirmed = 0;
  let reviewRequired = 0;
  let pending = 0;
  for (const s of statuses) {
    if (s === 'CONFIRMED') confirmed++;
    else if (s === 'REVIEW_REQUIRED' || s === 'FAILED' || s === 'REJECTED') reviewRequired++;
    else if (s === 'PENDING' || s === 'PROCESSING') pending++;
  }
  return { confirmed, reviewRequired, pending };
}
