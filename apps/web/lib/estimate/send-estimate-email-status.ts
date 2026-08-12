import { EstimateStatus } from '@bvisible/db';

/**
 * After a successful SMTP send: DRAFT → SENT; other statuses unchanged
 * (resending an APPROVED or FINALIZED estimate never moves it backwards).
 */
export function statusAfterSuccessfulCustomerSend(
  current: EstimateStatus
): EstimateStatus | undefined {
  if (current === EstimateStatus.DRAFT) return EstimateStatus.SENT;
  return undefined;
}
