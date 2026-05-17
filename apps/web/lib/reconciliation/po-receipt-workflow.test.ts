import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { buildOcrApproveTriggerDedupeKey } from './run';

describe('PO receipt workflow (static contracts)', () => {
  it('OCR approve triggers replay-safe reconciliation snapshot', async () => {
    const src = await readFile(
      new URL('../../app/(app)/admin/ocr-review/actions.ts', import.meta.url),
      'utf8',
    );
    expect(src).toContain('buildOcrApproveTriggerDedupeKey');
    expect(src).toContain('runPoReconciliationSnapshot');
    expect(src).toContain('reconciliationSkipped');
  });

  it('reject OCR never persists vendor pricing', async () => {
    const src = await readFile(
      new URL('../../app/(app)/admin/ocr-review/actions.ts', import.meta.url),
      'utf8',
    );
    const rejectBlock = src.split('rejectOcrDocumentAction')[1] ?? '';
    expect(rejectBlock).not.toContain('persistApprovedOcrPriceLines');
    expect(rejectBlock).not.toContain('runPoReconciliationSnapshot');
  });

  it('OCR approve dedupe key is stable for same line set', () => {
    const a = buildOcrApproveTriggerDedupeKey({
      tenantId: 't1',
      purchaseOrderId: 'po1',
      ocrDocumentId: 'doc1',
      includedOcrLineItemIds: ['b', 'a'],
    });
    const b = buildOcrApproveTriggerDedupeKey({
      tenantId: 't1',
      purchaseOrderId: 'po1',
      ocrDocumentId: 'doc1',
      includedOcrLineItemIds: ['a', 'b'],
    });
    expect(a).toBe(b);
  });
});
