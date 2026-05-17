import { describe, it, expect } from 'vitest';
import {
  FIXTURE_MULTI_LINE_INVOICE,
  FIXTURE_SIMPLE_RECEIPT,
} from './fixtures/sample-invoices';
import { parseReceiptLineCandidates } from './parse-receipt-lines';

describe('parseReceiptLineCandidates', () => {
  it('extracts item lines from a simple receipt and skips tax/total', () => {
    const lines = parseReceiptLineCandidates(FIXTURE_SIMPLE_RECEIPT);
    const labels = lines.map((l) => l.itemRaw);
    expect(labels.some((l) => /vinyl banner/i.test(l))).toBe(true);
    expect(labels.some((l) => /grommet/i.test(l))).toBe(true);
    expect(labels.some((l) => /^total$/i.test(l))).toBe(false);
    expect(labels.some((l) => /^tax$/i.test(l))).toBe(false);
    expect(labels.some((l) => /subtotal/i.test(l))).toBe(false);
  });

  it('parses multi-line invoice with qty patterns', () => {
    const lines = parseReceiptLineCandidates(FIXTURE_MULTI_LINE_INVOICE);
    const coro = lines.find((l) => /coroplast/i.test(l.itemRaw));
    expect(coro?.priceCents).toBe(4500);
    expect(coro?.quantityMilli).toBe(2000);
    expect(coro?.parseReason).toBe('qty_label_unit_price');

    const alum = lines.find((l) => /aluminum/i.test(l.itemRaw));
    expect(alum?.priceCents).toBe(6250);
    expect(alum?.quantityMilli).toBe(2000);

    expect(lines.find((l) => /mounting tape/i.test(l.itemRaw))?.priceCents).toBe(
      1875
    );
    expect(lines.find((l) => /design setup/i.test(l.itemRaw))?.priceCents).toBe(
      12000
    );
  });

  it('does not treat invoice number line as a price row', () => {
    const text = ['ACME CO', 'Invoice INV-2026-0042', 'Widget $12.50'].join('\n');
    const lines = parseReceiptLineCandidates(text);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.itemRaw).toMatch(/widget/i);
  });

  it('dedupes identical candidates on repeated ticks', () => {
    const text = 'Bolt M8    $12.50\nBolt M8    $12.50';
    const once = parseReceiptLineCandidates(text);
    const twice = parseReceiptLineCandidates(`${text}\n${text}`);
    expect(once).toHaveLength(1);
    expect(twice).toHaveLength(1);
  });

  it('parses 2 x unit price format', () => {
    const lines = parseReceiptLineCandidates('Sign panel blank  2 x $45.00');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.priceCents).toBe(4500);
    expect(lines[0]!.quantityMilli).toBe(2000);
  });
});
