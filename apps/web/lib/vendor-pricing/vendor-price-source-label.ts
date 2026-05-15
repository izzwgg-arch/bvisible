import { VendorPriceConfidence, VendorPriceExtractionMethod } from '@bvisible/db';

/** Operator-facing price source (never raw Prisma enum strings). */
export function labelVendorPriceSourceProduct(method: VendorPriceExtractionMethod): string {
  switch (method) {
    case VendorPriceExtractionMethod.MANUAL:
      return 'Manual';
    case VendorPriceExtractionMethod.OCR_APPROVED:
      return 'OCR verified';
    case VendorPriceExtractionMethod.LINE_REGEX:
    case VendorPriceExtractionMethod.SUBJECT_REGEX:
      return 'Email text';
    case VendorPriceExtractionMethod.FILENAME_REGEX:
      return 'Filename';
    case VendorPriceExtractionMethod.OCR_TEXT_REGEX:
      return 'OCR text (unverified)';
    default:
      return 'Unknown';
  }
}

export function labelVendorPriceConfidenceProduct(
  c: VendorPriceConfidence | null | undefined,
): string | null {
  if (c == null) return null;
  switch (c) {
    case VendorPriceConfidence.HIGH:
      return 'High confidence';
    case VendorPriceConfidence.MEDIUM:
      return 'Medium confidence';
    case VendorPriceConfidence.LOW:
      return 'Lower confidence';
    default:
      return null;
  }
}
