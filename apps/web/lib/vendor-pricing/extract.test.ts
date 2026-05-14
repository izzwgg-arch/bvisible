import { describe, expect, it } from 'vitest';
import {
  extractPricesFromFilename,
  extractPricesFromSubject,
  extractPricesFromTextBlob,
  parseMoneyToCents,
} from './extract';

describe('parseMoneyToCents', () => {
  it('parses dollars with optional commas and cents', () => {
    expect(parseMoneyToCents('145.00')).toBe(14500);
    expect(parseMoneyToCents('1,234.5')).toBe(123450);
  });

  it('returns null for invalid money', () => {
    expect(parseMoneyToCents('')).toBeNull();
    expect(parseMoneyToCents('abc')).toBeNull();
  });
});

describe('extractPricesFromSubject', () => {
  it('extracts item and price from subject', () => {
    const rows = extractPricesFromSubject('ACM 4X8 WHITE $145.00', null);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.itemRaw).toContain('ACM');
    expect(rows[0]?.priceCents).toBe(14500);
    expect(rows[0]?.method).toBe('SUBJECT_REGEX');
    expect(rows[0]?.confidence).toBe('MEDIUM');
  });
});

describe('extractPricesFromTextBlob', () => {
  it('extracts colon pattern per line', () => {
    const text = 'ITEM: ACM 4X8 WHITE — $145.00\nPVC 1/2 4X8 = 89.50';
    const rows = extractPricesFromTextBlob(text, 'LINE_REGEX', null);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const prices = rows.map((r) => r.priceCents).sort((a, b) => a - b);
    expect(prices).toContain(14500);
    expect(prices).toContain(8950);
    expect(rows.every((r) => r.method === 'LINE_REGEX')).toBe(true);
    expect(rows.every((r) => r.confidence === 'HIGH')).toBe(true);
  });
});

describe('extractPricesFromFilename', () => {
  it('parses delimiter patterns in base filename', () => {
    const rows = extractPricesFromFilename('ACM_4x8_white-145.50.pdf', null);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.priceCents).toBe(14550);
    expect(rows[0]?.method).toBe('FILENAME_REGEX');
    expect(rows[0]?.confidence).toBe('MEDIUM');
  });

  it('uses $ fallback token when delimiters missing', () => {
    const rows = extractPricesFromFilename('Quote_ACM_sheet_$612.00.png', 'att1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.priceCents).toBe(61200);
    expect(rows[0]?.sourceAttachmentId).toBe('att1');
  });
});

describe('extract safety filters', () => {
  it('ignores lines that look like phone numbers', () => {
    const text =
      'ACM 4X8 WHITE: 145.00\nCall us at (555) 123-4567 for pricing\nPVC: 50';
    const rows = extractPricesFromTextBlob(text, 'LINE_REGEX', null);
    expect(rows.some((r) => r.itemRaw.includes('555'))).toBe(false);
    expect(rows.some((r) => r.priceCents === 14500)).toBe(true);
  });

  it('skips numeric garbage without letters', () => {
    const rows = extractPricesFromTextBlob('12345: 99.00', 'LINE_REGEX', null);
    expect(rows).toHaveLength(0);
  });

  it('does not throw on odd lines (no regex capture)', () => {
    expect(() =>
      extractPricesFromTextBlob('no price here\n\n===', 'LINE_REGEX', null)
    ).not.toThrow();
    expect(() =>
      extractPricesFromSubject('nothing to see', null)
    ).not.toThrow();
  });
});
