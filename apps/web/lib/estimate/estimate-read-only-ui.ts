import { EstimateStatus } from '@bvisible/db';

/** Customer-facing label for finalized estimate editor lockdown. */
export const FINALIZED_READ_ONLY_CHIP_LABEL = 'Finalized — read-only';

/** Customer-facing label for Bid Estimator estimates opened in the classic grid. */
export const BID_READ_ONLY_CHIP_LABEL = 'Bid Estimator — edit in the workflow';

/**
 * True when the estimate editor must not accept line/meta/pricing mutations
 * client-side: FINALIZED estimates (lock), and BID estimates whose lines are
 * managed by the seven-step Bid Estimator (the grid's replace-all save would
 * destroy their source links, match evidence and pricing snapshots).
 */
export function isEstimateEditorReadOnly(status: EstimateStatus, estimateType?: string | null): boolean {
  return status === EstimateStatus.FINALIZED || estimateType === 'BID';
}
