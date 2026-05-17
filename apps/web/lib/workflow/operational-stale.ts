/** Display-only stale thresholds (deterministic; never mutates data). */

export const STALE_QUOTE_WAITING_MS = 3 * 24 * 60 * 60 * 1000;
export const STALE_APPROVED_NO_PO_MS = 2 * 24 * 60 * 60 * 1000;
export const STALE_VENDOR_REPLY_MS = 3 * 24 * 60 * 60 * 1000;
export const STALE_OCR_REVIEW_MS = 2 * 24 * 60 * 60 * 1000;
export const STALE_RECON_UNRESOLVED_MS = 5 * 24 * 60 * 60 * 1000;
export const STALE_INVOICE_UNPAID_MS = 7 * 24 * 60 * 60 * 1000;

export function isPastStaleThreshold(referenceAt: Date, thresholdMs: number, now: Date): boolean {
  return now.getTime() - referenceAt.getTime() >= thresholdMs;
}

export function staleAgeLabel(referenceAt: Date, now: Date): string {
  const days = Math.floor((now.getTime() - referenceAt.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'Today';
  if (days === 1) return '1d';
  return `${days}d`;
}
