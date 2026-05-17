import type { EstimateStatus, InvoiceStatus, OcrJobStatus, POReconciliationStatus, POStatus } from '@bvisible/db';
import {
  EstimateStatus as ES,
  InvoiceStatus as IS,
  OcrJobStatus as OJS,
  POStatus as POS,
} from '@bvisible/db';
import { reconciliationNeedsAttention } from '@/lib/estimate/estimate-fulfillment';
import type { OperationalWorkflowState } from './operational-matrix';
import {
  isPastStaleThreshold,
  STALE_APPROVED_NO_PO_MS,
  STALE_INVOICE_UNPAID_MS,
  STALE_OCR_REVIEW_MS,
  STALE_QUOTE_WAITING_MS,
  STALE_RECON_UNRESOLVED_MS,
  STALE_VENDOR_REPLY_MS,
} from './operational-stale';

export const WORKFLOW_STATE_LABELS: Record<OperationalWorkflowState, string> = {
  awaiting_customer: 'Awaiting customer',
  approved_waiting_po: 'Approved',
  waiting_vendor_reply: 'Waiting for vendor',
  ocr_review_needed: 'OCR review needed',
  recon_snapshot_needed: 'Reconciliation needed',
  variance_detected: 'Variance detected',
  ready_to_finalize: 'Ready to finalize',
  invoice_attention: 'Invoice follow-up',
  unmatched_email: 'Unmatched mail',
  completed: 'Completed',
};

export type OperationalNextAction = {
  label: string;
  href: string;
};

export function getOperationalWorkflowState(input: {
  estimateStatus?: EstimateStatus | null;
  linkedPoCount?: number;
  allLinkedPosHaveQbo?: boolean;
  poStatus?: POStatus | null;
  hasVendorReply?: boolean;
  ocrStatus?: OcrJobStatus | null;
  hasReconciliationSnapshot?: boolean;
  reconciliationStatus?: POReconciliationStatus | null;
  openSpendAlertCount?: number;
  invoiceStatus?: InvoiceStatus | null;
  hasInvoice?: boolean;
  emailUnmatched?: boolean;
  finalized?: boolean;
  operatorMarkedReconciled?: boolean;
}): OperationalWorkflowState | null {
  if (input.finalized || input.estimateStatus === ES.FINALIZED) return 'completed';

  if (input.emailUnmatched) return 'unmatched_email';

  if (input.ocrStatus === OJS.REVIEW_REQUIRED) return 'ocr_review_needed';

  if (
    input.poStatus &&
    input.poStatus !== POS.CANCELED &&
    input.poStatus !== POS.DRAFT &&
    input.poStatus !== POS.RECEIVED &&
    input.hasVendorReply === false
  ) {
    return 'waiting_vendor_reply';
  }

  if (
    input.ocrStatus === OJS.CONFIRMED &&
    input.hasReconciliationSnapshot === false &&
    input.poStatus &&
    input.poStatus !== POS.CANCELED
  ) {
    return 'recon_snapshot_needed';
  }

  if (
    (input.reconciliationStatus && reconciliationNeedsAttention(input.reconciliationStatus)) ||
    (input.openSpendAlertCount ?? 0) > 0
  ) {
    return 'variance_detected';
  }

  if (input.estimateStatus === ES.SENT) return 'awaiting_customer';

  if (input.estimateStatus === ES.APPROVED && (input.linkedPoCount ?? 0) === 0) {
    return 'approved_waiting_po';
  }

  if (
    input.estimateStatus === ES.APPROVED &&
    (input.linkedPoCount ?? 0) > 0 &&
    input.allLinkedPosHaveQbo === true &&
    !input.finalized
  ) {
    return 'ready_to_finalize';
  }

  if (
    input.estimateStatus === ES.APPROVED &&
    (!input.hasInvoice || input.invoiceStatus === IS.UNPAID)
  ) {
    return 'invoice_attention';
  }

  if (input.operatorMarkedReconciled) return 'completed';

  return null;
}

export function getOperationalAttentionReason(state: OperationalWorkflowState): string {
  switch (state) {
    case 'awaiting_customer':
      return 'Customer has not responded on the public quote link.';
    case 'approved_waiting_po':
      return 'Estimate is approved but has no linked purchase order.';
    case 'waiting_vendor_reply':
      return 'PO was issued; no vendor reply recorded on the timeline yet.';
    case 'ocr_review_needed':
      return 'Receipt OCR lines need operator confirmation before pricing applies.';
    case 'recon_snapshot_needed':
      return 'OCR was approved but no reconciliation snapshot exists for this PO.';
    case 'variance_detected':
      return 'Latest reconciliation or spend alerts need operator decisions.';
    case 'ready_to_finalize':
      return 'PO coverage and QuickBooks numbers are in place; estimate can finalize.';
    case 'invoice_attention':
      return 'Billing step is incomplete for this approved job.';
    case 'unmatched_email':
      return 'Inbound vendor mail is not linked to a purchase order.';
    case 'completed':
      return 'No action required — recent completion for visibility.';
    default:
      return 'Needs operator attention.';
  }
}

export function getOperationalNextAction(input: {
  state: OperationalWorkflowState;
  estimateId?: string | null;
  poId?: string | null;
  ocrDocumentId?: string | null;
  invoiceId?: string | null;
  emailId?: string | null;
}): OperationalNextAction {
  switch (input.state) {
    case 'awaiting_customer':
    case 'approved_waiting_po':
    case 'ready_to_finalize':
    case 'invoice_attention':
      return {
        label:
          input.state === 'ready_to_finalize'
            ? 'Finalize estimate'
            : input.state === 'approved_waiting_po'
              ? 'Create PO'
              : input.state === 'invoice_attention'
                ? 'Open estimate'
                : 'Open estimate',
        href: `/estimates/${input.estimateId ?? ''}`,
      };
    case 'waiting_vendor_reply':
    case 'recon_snapshot_needed':
    case 'variance_detected':
      return {
        label:
          input.state === 'waiting_vendor_reply'
            ? 'Open PO'
            : input.state === 'recon_snapshot_needed'
              ? 'Run reconciliation'
              : 'Resolve variance',
        href: input.state === 'waiting_vendor_reply'
          ? `/purchase-orders/${input.poId ?? ''}`
          : `/purchase-orders/${input.poId ?? ''}/reconciliation`,
      };
    case 'ocr_review_needed':
      return {
        label: 'Review OCR',
        href: input.ocrDocumentId
          ? `/admin/ocr-review/${input.ocrDocumentId}`
          : '/admin/ocr-review',
      };
    case 'unmatched_email':
      return {
        label: 'Match to PO',
        href: '/admin/email-ingestion',
      };
    case 'completed':
      if (input.poId) return { label: 'View PO', href: `/purchase-orders/${input.poId}` };
      if (input.invoiceId) return { label: 'View invoice', href: `/invoices/${input.invoiceId}` };
      return { label: 'View estimate', href: `/estimates/${input.estimateId ?? ''}` };
    default:
      return { label: 'Open', href: '/dashboard' };
  }
}

export function isOperationalStale(input: {
  state: OperationalWorkflowState;
  referenceAt: Date;
  now: Date;
}): boolean {
  const { state, referenceAt, now } = input;
  switch (state) {
    case 'awaiting_customer':
      return isPastStaleThreshold(referenceAt, STALE_QUOTE_WAITING_MS, now);
    case 'approved_waiting_po':
      return isPastStaleThreshold(referenceAt, STALE_APPROVED_NO_PO_MS, now);
    case 'waiting_vendor_reply':
      return isPastStaleThreshold(referenceAt, STALE_VENDOR_REPLY_MS, now);
    case 'ocr_review_needed':
      return isPastStaleThreshold(referenceAt, STALE_OCR_REVIEW_MS, now);
    case 'variance_detected':
    case 'recon_snapshot_needed':
      return isPastStaleThreshold(referenceAt, STALE_RECON_UNRESOLVED_MS, now);
    case 'invoice_attention':
      return isPastStaleThreshold(referenceAt, STALE_INVOICE_UNPAID_MS, now);
    default:
      return false;
  }
}

export function isOperationalBlocked(state: OperationalWorkflowState): boolean {
  return (
    state === 'approved_waiting_po' ||
    state === 'ocr_review_needed' ||
    state === 'recon_snapshot_needed' ||
    state === 'variance_detected' ||
    state === 'unmatched_email' ||
    state === 'waiting_vendor_reply'
  );
}

export function isOperationalUnresolved(state: OperationalWorkflowState): boolean {
  return state !== 'completed';
}
