import { describe, expect, it } from 'vitest';
import { EstimateStatus } from '@bvisible/db';
import { statusAfterSuccessfulCustomerSend } from '@/lib/estimate/send-estimate-email-status';

describe('statusAfterSuccessfulCustomerSend', () => {
  it('moves DRAFT to SENT', () => {
    expect(statusAfterSuccessfulCustomerSend(EstimateStatus.DRAFT)).toBe(EstimateStatus.SENT);
  });

  it('does not change SENT when resending', () => {
    expect(statusAfterSuccessfulCustomerSend(EstimateStatus.SENT)).toBeUndefined();
  });

  it('does not change APPROVED', () => {
    expect(statusAfterSuccessfulCustomerSend(EstimateStatus.APPROVED)).toBeUndefined();
  });
});
