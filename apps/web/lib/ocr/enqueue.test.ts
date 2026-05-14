import { describe, it, expect } from 'vitest';
import { POAttachmentKind } from '@bvisible/db';
import { poAttachmentEligibleForOcr } from './enqueue';

describe('poAttachmentEligibleForOcr', () => {
  it('allows receipt-like kinds', () => {
    expect(poAttachmentEligibleForOcr(POAttachmentKind.RECEIPT)).toBe(true);
    expect(poAttachmentEligibleForOcr(POAttachmentKind.INVOICE)).toBe(true);
    expect(poAttachmentEligibleForOcr(POAttachmentKind.EMAIL_ATTACHMENT)).toBe(
      true
    );
  });

  it('skips decorative attachment kinds', () => {
    expect(poAttachmentEligibleForOcr(POAttachmentKind.DRAWING)).toBe(false);
    expect(poAttachmentEligibleForOcr(POAttachmentKind.INSTALL_PHOTO)).toBe(
      false
    );
  });
});
