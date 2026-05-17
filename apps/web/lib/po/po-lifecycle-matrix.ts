/**
 * PO lifecycle audit matrix (deterministic, read from DB signals only).
 *
 * | Lifecycle state           | Primary signals                                      | Blocker                         | Next action              |
 * |---------------------------|------------------------------------------------------|---------------------------------|--------------------------|
 * | draft                     | POStatus DRAFT                                       | Not sent to vendor              | Send / assign vendor     |
 * | sent_to_vendor            | SENT or ORDERED, no vendor ack                       | Awaiting vendor confirmation    | Chase vendor             |
 * | vendor_acknowledged       | VENDOR_REPLY (+ attachment) or OPERATOR_VENDOR_ACK   | Awaiting production/ship        | Wait for shipment docs   |
 * | waiting_on_shipment       | Acknowledged, no receipt OCR/status                  | No receipt yet                  | Upload / watch inbox     |
 * | partially_received        | PARTIALLY_RECEIVED or partial OCR CONFIRMED          | Receipt incomplete              | Review OCR / receive rest|
 * | received                  | RECEIVED or OPERATOR_RECEIVED_COMPLETE or recon OK   | Ops wrap-up                     | Reconcile / stamp        |
 * | reconciliation_needed     | OCR CONFIRMED, no snapshot                           | Compare not run                 | Run reconciliation       |
 * | variance_detected         | Recon VARIANCE/REVIEW/PARTIAL or open spend alerts   | Mismatch needs decision         | Resolve variance         |
 * | ready_to_finalize         | Linked estimate APPROVED, QBO #, recon clean         | Estimate not finalized          | Finalize estimate        |
 * | completed                 | Canceled, or operator reconciled stamp               | None                            | View record              |
 * | blocked_backordered       | Latest OPERATOR_BLOCKED (not cleared)                | Vendor/production blocked       | Clear when unblocked     |
 *
 * Gaps before this work: POStatus alone; vendor reply and OCR/recon inferred mentally.
 */

export type PurchaseOrderLifecycleState =
  | 'draft'
  | 'sent_to_vendor'
  | 'vendor_acknowledged'
  | 'waiting_on_shipment'
  | 'partially_received'
  | 'received'
  | 'reconciliation_needed'
  | 'variance_detected'
  | 'ready_to_finalize'
  | 'completed'
  | 'blocked_backordered'
  | 'canceled';

export const PO_LIFECYCLE_LADDER: PurchaseOrderLifecycleState[] = [
  'draft',
  'sent_to_vendor',
  'vendor_acknowledged',
  'waiting_on_shipment',
  'partially_received',
  'received',
  'reconciliation_needed',
  'variance_detected',
  'ready_to_finalize',
  'completed',
];

export const PO_LIFECYCLE_LABELS: Record<PurchaseOrderLifecycleState, string> = {
  draft: 'Draft',
  sent_to_vendor: 'Sent to vendor',
  vendor_acknowledged: 'Vendor acknowledged',
  waiting_on_shipment: 'Waiting on shipment',
  partially_received: 'Partially received',
  received: 'Received',
  reconciliation_needed: 'Reconciliation needed',
  variance_detected: 'Variance detected',
  ready_to_finalize: 'Ready to finalize',
  completed: 'Completed',
  blocked_backordered: 'Blocked / backordered',
  canceled: 'Canceled',
};

export type PoLifecycleQueueBucket =
  | 'waiting_vendor_ack'
  | 'waiting_shipment_receipt'
  | 'partial_receipt'
  | 'variance_detected'
  | 'ready_to_finalize'
  | 'blocked_backordered';

export const PO_LIFECYCLE_QUEUE_LABELS: Record<PoLifecycleQueueBucket, string> = {
  waiting_vendor_ack: 'Waiting for vendor acknowledgment',
  waiting_shipment_receipt: 'Waiting on shipment / receipt',
  partial_receipt: 'Partial receipt',
  variance_detected: 'Variance detected',
  ready_to_finalize: 'Ready to finalize',
  blocked_backordered: 'Blocked / backordered',
};

export function lifecycleBucketForState(
  state: PurchaseOrderLifecycleState,
): PoLifecycleQueueBucket | null {
  switch (state) {
    case 'sent_to_vendor':
      return 'waiting_vendor_ack';
    case 'waiting_on_shipment':
    case 'vendor_acknowledged':
      return 'waiting_shipment_receipt';
    case 'partially_received':
      return 'partial_receipt';
    case 'variance_detected':
    case 'reconciliation_needed':
      return 'variance_detected';
    case 'ready_to_finalize':
      return 'ready_to_finalize';
    case 'blocked_backordered':
      return 'blocked_backordered';
    default:
      return null;
  }
}
