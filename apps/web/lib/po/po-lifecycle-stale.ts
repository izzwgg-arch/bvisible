/** Display-only stale thresholds for PO lifecycle (never mutates data). */

export const STALE_NO_VENDOR_REPLY_MS = 3 * 24 * 60 * 60 * 1000;
export const STALE_PARTIAL_RECEIPT_MS = 5 * 24 * 60 * 60 * 1000;
export const STALE_UNRESOLVED_VARIANCE_MS = 5 * 24 * 60 * 60 * 1000;
export const STALE_WAITING_SHIPMENT_MS = 7 * 24 * 60 * 60 * 1000;

export function isPastPoStaleThreshold(
  referenceAt: Date,
  thresholdMs: number,
  now: Date,
): boolean {
  return now.getTime() - referenceAt.getTime() >= thresholdMs;
}

export function poStaleAgeLabel(referenceAt: Date, now: Date): string {
  const days = Math.floor((now.getTime() - referenceAt.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'Today';
  if (days === 1) return '1d';
  return `${days}d`;
}
