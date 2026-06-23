import { describe, expect, it } from 'vitest';
import { brandFromAddress } from '@/lib/mailer';

describe('brandFromAddress', () => {
  it('keeps the SMTP address while forcing the B Visible sender name', () => {
    expect(brandFromAddress('Estimate <estimate@bvisible.us>')).toEqual({
      name: 'B Visible',
      address: 'estimate@bvisible.us',
    });
  });

  it('supports bare SMTP addresses', () => {
    expect(brandFromAddress('sales@bvisible.us')).toEqual({
      name: 'B Visible',
      address: 'sales@bvisible.us',
    });
  });
});
