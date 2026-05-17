/**
 * Deterministic operational workflow matrix (audit reference).
 * Derived from real DB rows only — see operational-state.ts + get-operational-workflow-queues.ts.
 *
 * | Workflow state            | Trigger (DB)                                      | Blocking condition              | Next action                         | Operator page                          |
 * |---------------------------|---------------------------------------------------|---------------------------------|-------------------------------------|----------------------------------------|
 * | awaiting_customer         | Estimate SENT + active quote link, no response    | Customer has not responded      | Follow up or mark approved            | /estimates/[id]                        |
 * | approved_waiting_po       | Estimate APPROVED, zero linked POs                 | No PO coverage                  | Create PO from estimate               | /estimates/[id]                        |
 * | waiting_vendor_reply      | PO SENT/ORDERED/PARTIAL, no VENDOR_REPLY event    | Vendor mail not on timeline     | Chase vendor / check inbox            | /purchase-orders/[id]                  |
 * | ocr_review_needed         | OcrDocument REVIEW_REQUIRED on PO attachment      | Lines not operator-approved     | Review & approve OCR lines            | /admin/ocr-review/[id]                 |
 * | recon_snapshot_needed     | OCR CONFIRMED on PO, zero POReconciliation        | No compare snapshot             | Open reconciliation / recompute       | /purchase-orders/[id]/reconciliation |
 * | variance_detected         | Latest POReconciliation needs attention           | Variances / open spend alerts   | Resolve lines / dismiss alerts        | /purchase-orders/[id]/reconciliation |
 * | ready_to_finalize         | Estimate APPROVED, POs exist, all have QBO #      | Not finalized yet               | Finalize estimate                     | /estimates/[id]                        |
 * | invoice_attention         | Approved estimate: no invoice or UNPAID invoice   | Billing step incomplete         | Create invoice / record payment       | /estimates/[id] or /invoices/[id]      |
 * | unmatched_email           | IngestedEmail UNMATCHED or PENDING                | PO link unknown                 | Match email to PO                     | /admin/email-ingestion                 |
 * | completed                 | FINALIZED estimate / stamped PO / paid invoice    | None (informational)            | Review record                         | entity detail                          |
 */

export type OperationalWorkflowState =
  | 'awaiting_customer'
  | 'approved_waiting_po'
  | 'waiting_vendor_reply'
  | 'ocr_review_needed'
  | 'recon_snapshot_needed'
  | 'variance_detected'
  | 'ready_to_finalize'
  | 'invoice_attention'
  | 'unmatched_email'
  | 'completed';

export type OperationalQueueBucket =
  | 'awaiting_customer'
  | 'approved_waiting_po'
  | 'waiting_vendor_reply'
  | 'ocr_review'
  | 'reconciliation_variance'
  | 'ready_to_finalize'
  | 'unmatched_email'
  | 'invoice_attention'
  | 'recently_completed';

export const OPERATIONAL_QUEUE_BUCKET_ORDER: OperationalQueueBucket[] = [
  'awaiting_customer',
  'approved_waiting_po',
  'waiting_vendor_reply',
  'ocr_review',
  'reconciliation_variance',
  'ready_to_finalize',
  'unmatched_email',
  'invoice_attention',
  'recently_completed',
];

export const OPERATIONAL_QUEUE_BUCKET_LABELS: Record<OperationalQueueBucket, string> = {
  awaiting_customer: 'Awaiting customer',
  approved_waiting_po: 'Approved, waiting for PO',
  waiting_vendor_reply: 'Waiting on vendor reply',
  ocr_review: 'OCR needs review',
  reconciliation_variance: 'Reconciliation variance',
  ready_to_finalize: 'Ready to finalize',
  unmatched_email: 'Unmatched inbound mail',
  invoice_attention: 'Invoice follow-up',
  recently_completed: 'Recently completed',
};

export function bucketForWorkflowState(state: OperationalWorkflowState): OperationalQueueBucket {
  switch (state) {
    case 'awaiting_customer':
      return 'awaiting_customer';
    case 'approved_waiting_po':
      return 'approved_waiting_po';
    case 'waiting_vendor_reply':
      return 'waiting_vendor_reply';
    case 'ocr_review_needed':
      return 'ocr_review';
    case 'recon_snapshot_needed':
    case 'variance_detected':
      return 'reconciliation_variance';
    case 'ready_to_finalize':
      return 'ready_to_finalize';
    case 'invoice_attention':
      return 'invoice_attention';
    case 'unmatched_email':
      return 'unmatched_email';
    case 'completed':
      return 'recently_completed';
    default:
      return 'recently_completed';
  }
}
