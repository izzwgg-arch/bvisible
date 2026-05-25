/** Display-only copy for reconciliation surfaces — no business logic. */

export const RECON_COMPARE_ONLY_BANNER =
  'No PO or estimate totals change here. Line actions record your review only.';

export const RECON_ACTION_HINTS = {
  confirmPair:
    'Records that the PO line and receipt line belong together. Does not change PO pricing.',
  acceptVariance:
    'Acknowledges the price or qty difference. Does not adjust PO or estimate totals.',
  rejectMapping:
    'Marks this pairing as wrong. Run a new snapshot or merge manually to try again.',
  mergeManual:
    'Links an unmatched receipt row to a PO row. Recomputes match status for that pair only.',
  markReconciled:
    'Operator stamp only — marks this PO reviewed. Does not mutate line totals or invoices.',
  recompute:
    'Rebuilds the latest snapshot from OCR-approved receipt lines. Append-only history.',
  dismissAlert:
    'Removes this alert from OPEN queues. Does not change PO lines or reconciliation math.',
} as const;

export const RECON_EMPTY_CLEAN =
  'Latest snapshot is clean — all lines matched within tolerance. Mark reconciled when ready.';

export const RECON_EMPTY_NO_SNAPSHOT =
  'No snapshot yet. Approve OCR receipt lines on this PO, then recompute or wait for auto-run after approve.';
