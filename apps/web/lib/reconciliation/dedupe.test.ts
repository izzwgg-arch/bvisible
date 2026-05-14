import { describe, expect, it } from 'vitest';
import { reconciliationDedupeKey } from './dedupe';

describe('reconciliationDedupeKey', () => {
  it('is stable for key ordering in payload', () => {
    const a = reconciliationDedupeKey({ z: 1, a: 2 });
    const b = reconciliationDedupeKey({ a: 2, z: 1 });
    expect(a).toBe(b);
  });

  it('changes when payload changes', () => {
    const a = reconciliationDedupeKey({ tenantId: 't1', poId: 'p1' });
    const b = reconciliationDedupeKey({ tenantId: 't1', poId: 'p2' });
    expect(a).not.toBe(b);
  });
});
