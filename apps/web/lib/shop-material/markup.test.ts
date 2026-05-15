import { describe, expect, it } from 'vitest';
import {
  impliedMarkupPercentMilli,
  parseMarkupPercentToMilli,
  sellPriceFromCostAndMarkup,
} from './markup';

describe('sellPriceFromCostAndMarkup', () => {
  it('applies 30% markup', () => {
    expect(sellPriceFromCostAndMarkup(10000, 30000)).toBe(13000);
  });
  it('200% markup (stored milli) equals ×3 sell vs cost — matches default estimate economics wording', () => {
    expect(sellPriceFromCostAndMarkup(10000, 200000)).toBe(30000);
  });
  it('handles zero markup', () => {
    expect(sellPriceFromCostAndMarkup(14500, 0)).toBe(14500);
  });
});

describe('impliedMarkupPercentMilli', () => {
  it('inverts markup', () => {
    expect(impliedMarkupPercentMilli(10000, 13000)).toBe(30000);
  });
});

describe('parseMarkupPercentToMilli', () => {
  it('parses integers and decimals', () => {
    expect(parseMarkupPercentToMilli('')).toBe(0);
    expect(parseMarkupPercentToMilli('25')).toBe(25000);
    expect(parseMarkupPercentToMilli('12.5')).toBe(12500);
    expect(parseMarkupPercentToMilli('garbage')).toBe(null);
  });
});
