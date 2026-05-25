import type { PoReceiptWorkflowSummary } from './get-po-receipt-workflow-summary';

export type PoReceiptNextAction = {
  label: string;
  href: string;
  tone: 'amber' | 'emerald' | 'neutral';
  priority: number;
};

/** Deterministic receipt/OCR/recon CTAs for the PO execution workspace (no mutations). */
export function buildPoReceiptNextActions(
  poId: string,
  summary: PoReceiptWorkflowSummary,
): PoReceiptNextAction[] {
  const actions: PoReceiptNextAction[] = [];

  if (summary.ocrNeedsReviewCount > 0) {
    actions.push({
      label: 'Review OCR',
      href: '/admin/ocr-review',
      tone: 'amber',
      priority: 10,
    });
  } else if (summary.approvedReceiptLineCount > 0 && !summary.hasReconciliationSnapshot) {
    actions.push({
      label: 'Run reconciliation',
      href: `/purchase-orders/${poId}/reconciliation`,
      tone: 'amber',
      priority: 20,
    });
  } else if (summary.reconciliationNeedsAttention || summary.varianceLineCount > 0) {
    actions.push({
      label: 'Resolve variance',
      href: `/purchase-orders/${poId}/reconciliation`,
      tone: 'amber',
      priority: 15,
    });
  }

  if (
    summary.hasReconciliationSnapshot &&
    !summary.operatorMarkedReconciledAt &&
    summary.openSpendAlertCount === 0 &&
    !summary.reconciliationNeedsAttention
  ) {
    actions.push({
      label: 'Mark PO reconciled',
      href: `/purchase-orders/${poId}/reconciliation`,
      tone: 'emerald',
      priority: 30,
    });
  }

  return actions;
}
