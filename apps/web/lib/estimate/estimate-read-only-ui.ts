import { EstimateStatus } from '@bvisible/db';

/** Customer-facing label for finalized estimate editor lockdown. */
export const FINALIZED_READ_ONLY_CHIP_LABEL = 'Finalized — read-only';

/** True when the estimate editor must not accept line/meta/pricing mutations client-side. */
export function isEstimateEditorReadOnly(status: EstimateStatus): boolean {
  return status === EstimateStatus.FINALIZED;
}
