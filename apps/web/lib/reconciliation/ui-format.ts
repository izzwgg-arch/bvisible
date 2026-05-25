import { POReconciliationLineMatch } from '@bvisible/db';

export function fmtReconMoney(cents: number | null): string {
  if (cents === null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function fmtQtyMilli(milli: number | null): string {
  if (milli === null) return '—';
  const qty = milli / 1000;
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(3).replace(/\.?0+$/, '');
}

export function varianceTone(cents: number | null): 'neutral' | 'over' | 'under' {
  if (cents === null || cents === 0) return 'neutral';
  return cents > 0 ? 'over' : 'under';
}

export function varianceClass(cents: number | null): string {
  switch (varianceTone(cents)) {
    case 'over':
      return 'text-amber-950';
    case 'under':
      return 'text-emerald-900';
    default:
      return 'text-[var(--color-bv-muted)]';
  }
}

export function fmtSignedVariance(cents: number | null): string {
  if (cents === null) return '—';
  if (cents === 0) return fmtReconMoney(0);
  const prefix = cents > 0 ? '+' : '−';
  return `${prefix}${fmtReconMoney(Math.abs(cents))}`;
}

export function isVarianceMatch(m: POReconciliationLineMatch): boolean {
  return (
    m === POReconciliationLineMatch.PRICE_VARIANCE ||
    m === POReconciliationLineMatch.QTY_VARIANCE ||
    m === POReconciliationLineMatch.PRICE_AND_QTY_VARIANCE
  );
}

export function needsOperatorReview(m: POReconciliationLineMatch): boolean {
  return (
    isVarianceMatch(m) ||
    m === POReconciliationLineMatch.UNMATCHED_PO_LINE ||
    m === POReconciliationLineMatch.UNMATCHED_RECEIPT_LINE ||
    m === POReconciliationLineMatch.AMBIGUOUS_PO_LINE ||
    m === POReconciliationLineMatch.AMBIGUOUS_RECEIPT_LINE
  );
}

export function pairedReviewMatches(): Set<POReconciliationLineMatch> {
  return new Set([
    POReconciliationLineMatch.MATCHED,
    POReconciliationLineMatch.PRICE_VARIANCE,
    POReconciliationLineMatch.QTY_VARIANCE,
    POReconciliationLineMatch.PRICE_AND_QTY_VARIANCE,
  ]);
}
