import {
  EmailIngestStatus,
  EmailMatchReason,
  EstimateStatus,
  InvoiceStatus,
  OcrJobStatus,
  POReconciliationLineMatch,
  POReconciliationLineResolution,
  POReconciliationStatus,
  POStatus,
  SpendAlertKind,
  SpendAlertStatus,
  VendorPriceExtractionMethod,
} from '@bvisible/db';

/** Display-only labels — DB enums stay unchanged. */

export function labelEstimateStatus(s: EstimateStatus): string {
  switch (s) {
    case EstimateStatus.DRAFT:
      return 'Draft';
    case EstimateStatus.SENT:
      return 'Sent';
    case EstimateStatus.APPROVED:
      return 'Approved';
    case EstimateStatus.REJECTED:
      return 'Rejected';
    case EstimateStatus.FINALIZED:
      return 'Finalized';
    default:
      return String(s).replace(/_/g, ' ');
  }
}

export function labelInvoiceStatus(s: InvoiceStatus): string {
  switch (s) {
    case InvoiceStatus.UNPAID:
      return 'Unpaid';
    case InvoiceStatus.PAID:
      return 'Paid';
    case InvoiceStatus.VOIDED:
      return 'Voided';
    default:
      return String(s).replace(/_/g, ' ');
  }
}

export function labelPoStatus(s: POStatus): string {
  switch (s) {
    case POStatus.DRAFT:
      return 'Draft';
    case POStatus.SENT:
      return 'Sent';
    case POStatus.ORDERED:
      return 'Ordered';
    case POStatus.PARTIALLY_RECEIVED:
      return 'Partially received';
    case POStatus.RECEIVED:
      return 'Received';
    case POStatus.CANCELED:
      return 'Canceled';
    default:
      return String(s).replace(/_/g, ' ');
  }
}

export function labelOcrJobStatus(s: OcrJobStatus): string {
  switch (s) {
    case OcrJobStatus.PENDING:
      return 'Queued';
    case OcrJobStatus.PROCESSING:
      return 'Processing';
    case OcrJobStatus.REVIEW_REQUIRED:
      return 'Needs review';
    case OcrJobStatus.CONFIRMED:
      return 'Confirmed';
    case OcrJobStatus.REJECTED:
      return 'Rejected';
    case OcrJobStatus.FAILED:
      return 'Failed';
    default:
      return String(s).replace(/_/g, ' ');
  }
}

export function labelEmailIngestStatus(s: EmailIngestStatus): string {
  switch (s) {
    case EmailIngestStatus.PENDING:
      return 'Pending';
    case EmailIngestStatus.UNMATCHED:
      return 'Needs matching';
    case EmailIngestStatus.MATCHED:
      return 'Matched';
    case EmailIngestStatus.FAILED:
      return 'Failed';
    case EmailIngestStatus.DISMISSED:
      return 'Dismissed';
    default:
      return String(s).replace(/_/g, ' ');
  }
}

export function labelEmailMatchReason(r: EmailMatchReason): string {
  switch (r) {
    case EmailMatchReason.QBO_NUMBER:
      return 'QBO PO number';
    case EmailMatchReason.PO_NUMBER:
      return 'Internal PO number';
    case EmailMatchReason.VENDOR_AND_RECENT:
      return 'Vendor + recent open PO';
    case EmailMatchReason.MANUAL:
      return 'Manual link';
    case EmailMatchReason.NONE:
      return 'No auto-match';
    default:
      return String(r).replace(/_/g, ' ');
  }
}

export function labelReconciliationLineMatch(m: POReconciliationLineMatch): string {
  switch (m) {
    case POReconciliationLineMatch.MATCHED:
      return 'Matched';
    case POReconciliationLineMatch.PRICE_VARIANCE:
      return 'Price variance';
    case POReconciliationLineMatch.QTY_VARIANCE:
      return 'Qty variance';
    case POReconciliationLineMatch.PRICE_AND_QTY_VARIANCE:
      return 'Price & qty variance';
    case POReconciliationLineMatch.UNMATCHED_PO_LINE:
      return 'PO line unmatched';
    case POReconciliationLineMatch.UNMATCHED_RECEIPT_LINE:
      return 'Receipt line unmatched';
    case POReconciliationLineMatch.AMBIGUOUS_PO_LINE:
      return 'Ambiguous PO line';
    case POReconciliationLineMatch.AMBIGUOUS_RECEIPT_LINE:
      return 'Ambiguous receipt line';
    default:
      return String(m).replace(/_/g, ' ');
  }
}

export function labelReconciliationLineResolution(
  r: POReconciliationLineResolution,
): string {
  switch (r) {
    case POReconciliationLineResolution.NONE:
      return 'Unresolved';
    case POReconciliationLineResolution.CONFIRMED_PAIR:
      return 'Confirmed';
    case POReconciliationLineResolution.ACCEPTED_VARIANCE:
      return 'Variance accepted';
    case POReconciliationLineResolution.REJECTED_PAIR:
      return 'Rejected';
    default:
      return String(r).replace(/_/g, ' ');
  }
}

export function labelSpendAlertStatus(s: SpendAlertStatus): string {
  switch (s) {
    case SpendAlertStatus.OPEN:
      return 'Open';
    case SpendAlertStatus.SUPERSEDED:
      return 'Superseded';
    case SpendAlertStatus.DISMISSED:
      return 'Dismissed';
    default:
      return String(s).replace(/_/g, ' ');
  }
}

export function labelSpendAlertKind(k: SpendAlertKind): string {
  switch (k) {
    case SpendAlertKind.PRICE_OVER_PO_EXPECTED:
      return 'Price over PO';
    case SpendAlertKind.QTY_MISMATCH:
      return 'Quantity mismatch';
    case SpendAlertKind.PO_TOTAL_OVER_EXPECTED:
      return 'PO total over expected';
    case SpendAlertKind.UNMATCHED_RECEIPT_LINE:
      return 'Unmatched receipt line';
    case SpendAlertKind.MISSING_PO_RECEIPT_LINE:
      return 'Missing receipt line';
    case SpendAlertKind.RECONCILIATION_AMBIGUOUS:
      return 'Ambiguous pairing';
    default:
      return String(k).replace(/_/g, ' ');
  }
}

export function labelPoReconciliationStatus(s: POReconciliationStatus): string {
  switch (s) {
    case POReconciliationStatus.PENDING:
      return 'In progress';
    case POReconciliationStatus.PARTIAL:
      return 'Partial match';
    case POReconciliationStatus.VARIANCE:
      return 'Variance';
    case POReconciliationStatus.REVIEW_REQUIRED:
      return 'Needs review';
    case POReconciliationStatus.MATCHED:
      return 'Matched';
    case POReconciliationStatus.RESOLVED:
      return 'Resolved';
    default:
      return String(s).replace(/_/g, ' ');
  }
}

export function labelVendorPriceExtractionMethod(m: VendorPriceExtractionMethod): string {
  switch (m) {
    case VendorPriceExtractionMethod.OCR_APPROVED:
      return 'Verified';
    case VendorPriceExtractionMethod.OCR_TEXT_REGEX:
      return 'From OCR text';
    case VendorPriceExtractionMethod.LINE_REGEX:
      return 'Line parse';
    case VendorPriceExtractionMethod.SUBJECT_REGEX:
      return 'Subject parse';
    case VendorPriceExtractionMethod.FILENAME_REGEX:
      return 'Filename parse';
    case VendorPriceExtractionMethod.MANUAL:
      return 'Manual';
    default:
      return String(m).replace(/_/g, ' ');
  }
}
