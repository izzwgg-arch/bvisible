import { EstimateStatus } from '@bvisible/db';

/**
 * After a successful SMTP send: DRAFT → SENT; other statuses unchanged.
 * FINALIZED cannot be emailed from this flow (blocked earlier).
 */
export function statusAfterSuccessfulCustomerSend(
  current: EstimateStatus
): EstimateStatus | undefined {
  if (current === EstimateStatus.DRAFT) return EstimateStatus.SENT;
  return undefined;
}
