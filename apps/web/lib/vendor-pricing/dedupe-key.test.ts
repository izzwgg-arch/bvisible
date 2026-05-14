import { describe, it, expect } from 'vitest';
import { buildDedupeKey } from '@/lib/vendor-pricing/persist';

describe('OCR approval dedupe keys', () => {
  it('differs per OCR line item id so replay targets one observation', () => {
    const base = {
      tenantId: 't1',
      ocrDocumentId: 'doc1',
      method: 'OCR_APPROVED',
      item: 'ACM 4X8 WHITE',
      price: 14500,
      unit: null as string | null,
    };
    const a = buildDedupeKey({ ...base, ocrLineItemId: 'line_a' });
    const b = buildDedupeKey({ ...base, ocrLineItemId: 'line_b' });
    expect(a).not.toBe(b);
    expect(a).toHaveLength(64);
  });
});
