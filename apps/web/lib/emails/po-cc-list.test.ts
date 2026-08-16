import { describe, expect, it } from 'vitest';
import { isValidCcEmail, normalizeCcList, PO_CC_MAX_RECIPIENTS } from './po-cc-list';

describe('isValidCcEmail', () => {
  it('accepts ordinary addresses', () => {
    expect(isValidCcEmail('cg@bvisible.us')).toBe(true);
    expect(isValidCcEmail('  lt@bvisible.us  ')).toBe(true);
    expect(isValidCcEmail('first.last+po@sub.example.co.uk')).toBe(true);
  });

  it('rejects things that are not addresses', () => {
    expect(isValidCcEmail('')).toBe(false);
    expect(isValidCcEmail('   ')).toBe(false);
    expect(isValidCcEmail('office')).toBe(false);
    expect(isValidCcEmail('office@')).toBe(false);
    expect(isValidCcEmail('office@localhost')).toBe(false);
    expect(isValidCcEmail('a b@example.com')).toBe(false);
  });

  it('rejects addresses beyond the practical RFC length', () => {
    expect(isValidCcEmail(`${'a'.repeat(320)}@example.com`)).toBe(false);
  });
});

describe('normalizeCcList', () => {
  it('an empty list is a valid result, not an error — it means vendor only', () => {
    const r = normalizeCcList([]);
    expect(r.emails).toEqual([]);
    expect(r.invalid).toEqual([]);
    expect(r.tooMany).toBe(false);
  });

  it('treats blank entries as "no recipient" rather than as invalid', () => {
    expect(normalizeCcList(['', '   ', '\n']).emails).toEqual([]);
    expect(normalizeCcList(['', '   ']).invalid).toEqual([]);
  });

  it('splits a pasted string on commas, semicolons, and newlines', () => {
    const r = normalizeCcList('cg@bvisible.us, lt@bvisible.us; sales@bvisible.us\nops@bvisible.us');
    expect(r.emails).toEqual([
      'cg@bvisible.us',
      'lt@bvisible.us',
      'sales@bvisible.us',
      'ops@bvisible.us',
    ]);
    expect(r.invalid).toEqual([]);
  });

  it('de-duplicates case-insensitively but keeps what was typed', () => {
    const r = normalizeCcList(['CG@bvisible.us', 'cg@bvisible.us', 'Cg@BVisible.us']);
    expect(r.emails).toEqual(['CG@bvisible.us']);
  });

  it('reports bad entries individually instead of failing the whole list', () => {
    const r = normalizeCcList(['cg@bvisible.us', 'not-an-email', 'lt@bvisible.us']);
    expect(r.emails).toEqual(['cg@bvisible.us', 'lt@bvisible.us']);
    expect(r.invalid).toEqual(['not-an-email']);
  });

  it('flags and truncates a list past the recipient cap', () => {
    const many = Array.from({ length: PO_CC_MAX_RECIPIENTS + 3 }, (_, i) => `p${i}@example.com`);
    const r = normalizeCcList(many);
    expect(r.tooMany).toBe(true);
    expect(r.emails).toHaveLength(PO_CC_MAX_RECIPIENTS);
  });

  it('does not flag a list exactly at the cap', () => {
    const exact = Array.from({ length: PO_CC_MAX_RECIPIENTS }, (_, i) => `p${i}@example.com`);
    expect(normalizeCcList(exact).tooMany).toBe(false);
  });
});
