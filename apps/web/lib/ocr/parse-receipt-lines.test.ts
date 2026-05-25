import { describe, it, expect } from 'vitest';
import {
  FIXTURE_MULTI_LINE_INVOICE,
  FIXTURE_SIMPLE_RECEIPT,
  FIXTURE_WRAPPED_LINE_RECEIPT,
  FIXTURE_BLURRY_STYLE_RECEIPT,
  FIXTURE_TABLE_INVOICE,
  FIXTURE_QTY_AT_RECEIPT,
  FIXTURE_UNIT_SUFFIX_RECEIPT,
  FIXTURE_OCR_NOISE_RECEIPT,
  FIXTURE_ROTATED_SCAN_RECEIPT,
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

  it('merges wrapped item name + price on following line', () => {
    const lines = parseReceiptLineCandidates(FIXTURE_WRAPPED_LINE_RECEIPT);
    const coro = lines.find((l) => /coroplast/i.test(l.itemRaw));
    expect(coro?.priceCents).toBe(4500);
    expect(coro?.parseReason).toBe('wrapped_item_name');
    expect(lines.find((l) => /mounting tape/i.test(l.itemRaw))?.priceCents).toBe(1875);
    expect(lines.some((l) => /subtotal/i.test(l.itemRaw))).toBe(false);
  });

  it('skips shipping on blurry-style receipt', () => {
    const lines = parseReceiptLineCandidates(FIXTURE_BLURRY_STYLE_RECEIPT);
    expect(lines.some((l) => /shipping/i.test(l.itemRaw))).toBe(false);
    expect(lines.some((l) => /ink cartridge/i.test(l.itemRaw))).toBe(true);
  });

  it('parses table-style invoice rows and skips freight/tax/total', () => {
    const lines = parseReceiptLineCandidates(FIXTURE_TABLE_INVOICE);
    expect(lines.some((l) => /vinyl banner/i.test(l.itemRaw))).toBe(true);
    expect(lines.some((l) => /grommet/i.test(l.itemRaw))).toBe(true);
    expect(lines.some((l) => /^subtotal$/i.test(l.itemRaw))).toBe(false);
    expect(lines.some((l) => /freight/i.test(l.itemRaw))).toBe(false);
    expect(lines.some((l) => /^tax$/i.test(l.itemRaw))).toBe(false);
    expect(lines.some((l) => /^total$/i.test(l.itemRaw))).toBe(false);
    expect(lines.some((l) => /invoice inv-2026/i.test(l.itemRaw))).toBe(false);
  });

  it('parses qty @ unit price lines', () => {
    const lines = parseReceiptLineCandidates(FIXTURE_QTY_AT_RECEIPT);
    const coro = lines.find((l) => /coroplast/i.test(l.itemRaw));
    expect(coro?.priceCents).toBe(4500);
    expect(coro?.quantityMilli).toBe(2000);
    expect(coro?.parseReason).toBe('qty_at_unit_price');
  });

  it('extracts unit suffixes from item labels', () => {
    const lines = parseReceiptLineCandidates(FIXTURE_UNIT_SUFFIX_RECEIPT);
    expect(lines.find((l) => /acm panel/i.test(l.itemRaw))?.unit).toBe('SHEET');
    expect(lines.find((l) => /banner mesh/i.test(l.itemRaw))?.unit).toBe('SQ FT');
    expect(lines.find((l) => /wire standoff/i.test(l.itemRaw))?.unit).toBe('EA');
  });

  it('still extracts items from noisy OCR text and skips shipping', () => {
    const lines = parseReceiptLineCandidates(FIXTURE_OCR_NOISE_RECEIPT);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.some((l) => /cartr/i.test(l.itemRaw))).toBe(true);
    expect(lines.some((l) => /shipp/i.test(l.itemRaw))).toBe(false);
  });

  it('ignores rotated-scan meta line and merges wrapped price', () => {
    const lines = parseReceiptLineCandidates(FIXTURE_ROTATED_SCAN_RECEIPT);
    expect(lines.some((l) => /rotated/i.test(l.itemRaw))).toBe(false);
    const banner = lines.find((l) => /vinyl banner/i.test(l.itemRaw));
    expect(banner?.priceCents).toBe(8950);
    expect(banner?.parseReason).toBe('wrapped_item_name');
  });
});
