import type { POReconciliationStatus } from '@bvisible/db';
import { EstimateStatus as ES, POReconciliationStatus as PRS, POStatus as POS } from '@bvisible/db';
import { reconciliationNeedsAttention } from '@/lib/estimate/estimate-fulfillment';
import type { PurchaseOrderLifecycleState } from './po-lifecycle-matrix';
import type { PoLifecycleSignals } from './po-lifecycle-signals';
import {
  isPastPoStaleThreshold,
  poStaleAgeLabel,
  STALE_NO_VENDOR_REPLY_MS,
  STALE_PARTIAL_RECEIPT_MS,
  STALE_UNRESOLVED_VARIANCE_MS,
  STALE_WAITING_SHIPMENT_MS,
} from './po-lifecycle-stale';

export type PoLifecycleNextAction = {
  label: string;
  href: string;
};

export function getPurchaseOrderLifecycleState(
  signals: PoLifecycleSignals,
): PurchaseOrderLifecycleState {
  if (signals.poStatus === POS.CANCELED) return 'canceled';

  if (signals.isOperatorBlocked) return 'blocked_backordered';

  const reconAttention =
    signals.latestReconciliationStatus != null &&
    reconciliationNeedsAttention(signals.latestReconciliationStatus);
  const hasVariance =
    reconAttention || signals.openSpendAlertCount > 0;

  if (hasVariance) return 'variance_detected';

  if (signals.ocrConfirmedCount > 0 && !signals.hasReconciliationSnapshot) {
    return 'reconciliation_needed';
  }

  if (deriveReadyToFinalizeOverlay(signals)) {
    return 'ready_to_finalize';
  }

  if (
    signals.operatorReceivedComplete ||
    signals.poStatus === POS.RECEIVED ||
    (signals.operatorMarkedReconciledAt != null &&
      signals.latestReconciliationStatus === PRS.MATCHED)
  ) {
    if (signals.estimateFinalized || signals.operatorMarkedReconciledAt != null) {
      return 'completed';
    }
    return 'received';
  }

  if (
    signals.poStatus === POS.PARTIALLY_RECEIVED ||
    (signals.ocrConfirmedCount > 0 && !signals.operatorReceivedComplete)
  ) {
    return 'partially_received';
  }

  const vendorAcked =
    signals.operatorVendorAcknowledged ||
    signals.hasVendorReply ||
    signals.vendorReplyHasAttachment;

  if (vendorAcked && signals.ocrConfirmedCount === 0) {
    return 'waiting_on_shipment';
  }

  if (vendorAcked) return 'vendor_acknowledged';

  if (signals.poStatus === POS.SENT || signals.poStatus === POS.ORDERED) {
    return 'sent_to_vendor';
  }

  if (signals.poStatus === POS.DRAFT) return 'draft';

  return 'sent_to_vendor';
}

export function getPurchaseOrderLifecycleReason(
  state: PurchaseOrderLifecycleState,
  signals: PoLifecycleSignals,
): string {
  switch (state) {
    case 'draft':
      return 'PO is still a draft — not issued to the vendor yet.';
    case 'sent_to_vendor':
      return 'PO was sent or ordered; waiting for vendor acknowledgment.';
    case 'vendor_acknowledged':
      return 'Vendor replied or operator marked acknowledgment — awaiting shipment or receipt docs.';
    case 'waiting_on_shipment':
      return 'Vendor acknowledged; no receipt OCR or received status yet.';
    case 'partially_received':
      return 'Some receipt lines are confirmed; fulfillment is incomplete.';
    case 'received':
      return 'Goods/receipt side is complete — reconcile and close the loop.';
    case 'reconciliation_needed':
      return 'OCR lines were approved but no reconciliation snapshot exists.';
    case 'variance_detected':
      return 'Reconciliation or spend alerts need operator decisions.';
    case 'ready_to_finalize':
      return 'PO and estimate prerequisites are met; finalize the linked estimate.';
    case 'completed':
      return 'Operator stamped reconciled or linked estimate is finalized.';
    case 'blocked_backordered':
      return 'Operator marked this PO blocked or backordered.';
    case 'canceled':
      return 'PO is canceled.';
    default:
      return 'Review PO status and vendor communications.';
  }
}

export function getPurchaseOrderLifecycleNextAction(input: {
  state: PurchaseOrderLifecycleState;
  poId: string;
  estimateId?: string | null;
}): PoLifecycleNextAction {
  const { state, poId, estimateId } = input;
  switch (state) {
    case 'draft':
    case 'sent_to_vendor':
    case 'vendor_acknowledged':
    case 'waiting_on_shipment':
      return { label: 'Open PO', href: `/purchase-orders/${poId}` };
    case 'partially_received':
      return { label: 'Review receipts', href: `/purchase-orders/${poId}#po-attachments` };
    case 'received':
    case 'ready_to_finalize':
      return estimateId
        ? { label: 'Open estimate', href: `/estimates/${estimateId}` }
        : { label: 'Open PO', href: `/purchase-orders/${poId}` };
    case 'reconciliation_needed':
    case 'variance_detected':
      return { label: 'Reconciliation', href: `/purchase-orders/${poId}/reconciliation` };
    case 'blocked_backordered':
      return { label: 'Open PO', href: `/purchase-orders/${poId}` };
    case 'completed':
    case 'canceled':
      return { label: 'View PO', href: `/purchase-orders/${poId}` };
    default:
      return { label: 'Open PO', href: `/purchase-orders/${poId}` };
  }
}

export function deriveReadyToFinalizeOverlay(signals: PoLifecycleSignals): boolean {
  if (!signals.estimateStatus || signals.estimateStatus !== ES.APPROVED) return false;
  if (signals.estimateFinalized) return false;
  if (!signals.qboPoNumber?.trim()) return false;
  if (signals.latestReconciliationStatus && reconciliationNeedsAttention(signals.latestReconciliationStatus)) {
    return false;
  }
  return signals.linkedEstimateHasQboOnAllPos === true;
}

export function getPoLifecycleStaleInfo(input: {
  state: PurchaseOrderLifecycleState;
  signals: PoLifecycleSignals;
  referenceAt: Date;
  now: Date;
}): { isStale: boolean; label: string | null } {
  const { state, signals, referenceAt, now } = input;
  let threshold: number | null = null;
  switch (state) {
    case 'sent_to_vendor':
      threshold = STALE_NO_VENDOR_REPLY_MS;
      break;
    case 'waiting_on_shipment':
      threshold = STALE_WAITING_SHIPMENT_MS;
      break;
    case 'partially_received':
      threshold = STALE_PARTIAL_RECEIPT_MS;
      break;
    case 'variance_detected':
    case 'reconciliation_needed':
      threshold = STALE_UNRESOLVED_VARIANCE_MS;
      break;
    default:
      threshold = null;
  }
  if (threshold == null) {
    return { isStale: false, label: null };
  }
  const ref =
    state === 'sent_to_vendor' && signals.blockedAt ? signals.updatedAt : referenceAt;
  const isStale = isPastPoStaleThreshold(ref, threshold, now);
  return {
    isStale,
    label: isStale ? poStaleAgeLabel(ref, now) : null,
  };
}

export function isPoLifecycleBlocked(state: PurchaseOrderLifecycleState): boolean {
  return (
    state === 'blocked_backordered' ||
    state === 'variance_detected' ||
    state === 'reconciliation_needed' ||
    state === 'sent_to_vendor'
  );
}
