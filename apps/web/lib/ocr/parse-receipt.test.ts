import { describe, it, expect } from 'vitest';
import { parseReceiptDocumentGuesses } from './parse-receipt';

describe('parseReceiptDocumentGuesses', () => {
  it('extracts vendor-ish first line and totals', () => {
    const text = [
      'ACME SUPPLY CO',
      '',
      'Widget bolt M8    $12.50',
      'Subtotal: $100.00',
      'Tax: $8.00',
      'Total: $108.00',
      'Invoice INV-2026-0042',
      'Date 03/14/2026',
    ].join('\n');

    const g = parseReceiptDocumentGuesses(text);
    expect(g.vendorNameGuess).toContain('ACME');
    expect(g.subtotalCentsGuess).toBe(10000);
    expect(g.taxCentsGuess).toBe(800);
    expect(g.totalCentsGuess).toBe(10800);
    expect(g.invoiceNumberGuess).toBeTruthy();
    expect(g.documentDateGuess).toBeInstanceOf(Date);
  });
});
