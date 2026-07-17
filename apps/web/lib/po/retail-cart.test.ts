import { describe, expect, it } from 'vitest';
import {
  buildAmazonCartUrl,
  buildOfficeDraftEmail,
  buildRetailCartUrl,
  extractAsin,
  isRetailVendor,
  normalizeExternalUrl,
} from './retail-cart';

describe('normalizeExternalUrl', () => {
  it('keeps absolute urls', () => {
    expect(normalizeExternalUrl('https://www.amazon.com/dp/B0ABCDEFGH')).toBe(
      'https://www.amazon.com/dp/B0ABCDEFGH'
    );
  });
  it('adds https:// to scheme-less domain urls (the 404 fix)', () => {
    expect(normalizeExternalUrl('www.amazon.com/dp/B0ABCDEFGH')).toBe(
      'https://www.amazon.com/dp/B0ABCDEFGH'
    );
    expect(normalizeExternalUrl('homedepot.com/p/123')).toBe('https://homedepot.com/p/123');
  });
  it('drops non-urls instead of producing broken relative links', () => {
    expect(normalizeExternalUrl('see office binder')).toBe('');
    expect(normalizeExternalUrl('')).toBe('');
    expect(normalizeExternalUrl(null)).toBe('');
  });
});

describe('extractAsin', () => {
  it('uses a valid ASIN sku', () => {
    expect(extractAsin('b0abcdefgh', '')).toBe('B0ABCDEFGH');
  });
  it('extracts from /dp/ and /gp/product/ urls', () => {
    expect(extractAsin('', 'https://www.amazon.com/dp/B0ABCDEFGH?th=1')).toBe('B0ABCDEFGH');
    expect(extractAsin('BLUE-TAPE', 'amazon.com/gp/product/B0ABCDEFGH/ref=x')).toBe('B0ABCDEFGH');
  });
  it('returns null when nothing resolvable', () => {
    expect(extractAsin('SKU123', 'https://www.homedepot.com/p/123')).toBeNull();
  });
});

describe('buildAmazonCartUrl', () => {
  it('builds a multi-item cart url when every line has an ASIN', () => {
    const url = buildAmazonCartUrl([
      { sku: 'B0ABCDEFGH', url: '', qty: 2 },
      { sku: '', url: 'https://www.amazon.com/dp/B0AAAAAAAA', qty: 0.4 },
    ]);
    expect(url).toContain('ASIN.1=B0ABCDEFGH&Quantity.1=2');
    expect(url).toContain('ASIN.2=B0AAAAAAAA&Quantity.2=1'); // qty rounds UP
  });
  it('returns null when any line has no ASIN (no silent partial carts)', () => {
    expect(
      buildAmazonCartUrl([
        { sku: 'B0ABCDEFGH', url: '', qty: 1 },
        { sku: 'NOT-ASIN', url: '', qty: 1 },
      ])
    ).toBeNull();
  });
});

describe('buildRetailCartUrl', () => {
  it('prefers the amazon cart, falls back to first product page', () => {
    const items = [
      { name: 'Tape', qty: 1, url: 'www.homedepot.com/p/123', sku: '', unitPriceCents: 500 },
    ];
    expect(buildRetailCartUrl('Home Depot', items)).toBe('https://www.homedepot.com/p/123');
  });
  it('returns null with no usable urls', () => {
    expect(
      buildRetailCartUrl('Walmart', [{ name: 'x', qty: 1, url: '', sku: '', unitPriceCents: 1 }])
    ).toBeNull();
  });
});

describe('isRetailVendor', () => {
  it('matches the supported online stores', () => {
    for (const v of ['Amazon', 'Home Depot', 'walmart.com', "Lowe's", 'Staples', 'Target']) {
      expect(isRetailVendor(v)).toBe(true);
    }
    expect(isRetailVendor('Grimco')).toBe(false);
  });
});

describe('buildOfficeDraftEmail', () => {
  it('includes vendor, items, quantities, prices, links, and total', () => {
    const { subject, body } = buildOfficeDraftEmail(
      'PO-1042',
      'Amazon',
      'https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=B0ABCDEFGH&Quantity.1=2',
      [
        {
          name: 'Blue painters tape',
          qty: 2,
          url: 'www.amazon.com/dp/B0ABCDEFGH',
          sku: 'B0ABCDEFGH',
          unitPriceCents: 799,
        },
      ]
    );
    expect(subject).toBe('Review & place order: PO-1042 — Amazon');
    expect(body).toContain('Vendor: Amazon');
    expect(body).toContain('Blue painters tape (SKU B0ABCDEFGH) x 2 @ $7.99 = $15.98');
    expect(body).toContain('https://www.amazon.com/dp/B0ABCDEFGH');
    expect(body).toContain('Order total: $15.98');
    expect(body).toContain('Prefilled cart:');
    expect(body).toContain('Nothing has been ordered automatically');
  });
});
