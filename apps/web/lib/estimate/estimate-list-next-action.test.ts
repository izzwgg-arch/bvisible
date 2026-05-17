import { describe, expect, it } from 'vitest';
import { EstimateStatus } from '@bvisible/db';
import { getEstimateListNextAction } from './estimate-list-next-action';

describe('getEstimateListNextAction', () => {
  it('routes draft to continue', () => {
    const a = getEstimateListNextAction({ id: 'e1', status: EstimateStatus.DRAFT });
    expect(a.label).toBe('Continue draft');
    expect(a.href).toBe('/estimates/e1');
  });

  it('routes approved without PO to create PO anchor', () => {
    const a = getEstimateListNextAction({
      id: 'e1',
      status: EstimateStatus.APPROVED,
      hasLinkedPo: false,
    });
    expect(a.label).toBe('Create PO');
    expect(a.href).toContain('#estimate-create-po');
  });
});
