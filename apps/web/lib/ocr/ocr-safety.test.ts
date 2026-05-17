import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('OCR financial safety (static contracts)', () => {
  it('approval action requires REVIEW_REQUIRED and calls persistApprovedOcrPriceLines', async () => {
    const src = await readFile(
      new URL('../../app/(app)/admin/ocr-review/actions.ts', import.meta.url),
      'utf8'
    );
    expect(src).toContain('OcrJobStatus.REVIEW_REQUIRED');
    expect(src).toContain('persistApprovedOcrPriceLines');
    expect(src).toContain('runPoReconciliationSnapshot');
    const rejectBlock = src.split('rejectOcrDocumentAction')[1] ?? '';
    expect(rejectBlock).not.toContain('persistApprovedOcrPriceLines');
  });

  it('persist OCR path uses OCR_APPROVED method only in persist module', async () => {
    const src = await readFile(
      new URL('../vendor-pricing/persist.ts', import.meta.url),
      'utf8'
    );
    expect(src).toContain('VendorPriceExtractionMethod.OCR_APPROVED');
    expect(src).toContain('Never called automatically');
  });

  it('reconciliation runner filters OCR_APPROVED observations', async () => {
    const src = await readFile(
      new URL('../reconciliation/run.ts', import.meta.url),
      'utf8'
    );
    expect(src).toContain('VendorPriceExtractionMethod.OCR_APPROVED');
  });
});
