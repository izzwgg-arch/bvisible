import {
  EmailIngestStatus,
  EstimateStatus,
  OcrJobStatus,
  POReconciliationStatus,
  POStatus,
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
    default:
      return String(m).replace(/_/g, ' ');
  }
}
