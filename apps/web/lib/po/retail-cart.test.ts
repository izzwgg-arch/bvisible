import { describe, expect, it } from 'vitest';
import {
  buildAmazonCartUrl,
  buildRetailCartUrl,
  buildRetailItemLink,
  buildRetailItemLinks,
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
  it('accepts a non-B0 ASIN inside a /dp/ url (position makes it unambiguous)', () => {
    expect(extractAsin('', 'https://www.amazon.com/dp/0306406152')).toBe('0306406152');
  });
  it('still refuses a bare 10-char sku that is not an ASIN', () => {
    expect(extractAsin('ABC1234567', '')).toBeNull();
  });
});

describe('buildAmazonCartUrl', () => {
  const TAG = 'bvisible-20';
  it('builds a multi-item cart url when every line has an ASIN', () => {
    const url = buildAmazonCartUrl(
      [
        { sku: 'B0ABCDEFGH', url: '', qty: 2 },
        { sku: '', url: 'https://www.amazon.com/dp/B0AAAAAAAA', qty: 0.4 },
      ],
      TAG
    );
    expect(url).toContain('ASIN.1=B0ABCDEFGH&Quantity.1=2');
    expect(url).toContain('ASIN.2=B0AAAAAAAA&Quantity.2=1'); // qty rounds UP
  });
  it('always carries AssociateTag — without it Amazon redirects to the product page', () => {
    const url = buildAmazonCartUrl([{ sku: 'B0ABCDEFGH', url: '', qty: 1 }], TAG);
    expect(url).toContain('AssociateTag=bvisible-20');
  });
  it('returns null with no associate tag rather than a url that cannot work', () => {
    for (const tag of ['', '   ', undefined, null]) {
      expect(buildAmazonCartUrl([{ sku: 'B0ABCDEFGH', url: '', qty: 1 }], tag)).toBeNull();
    }
  });
  it('returns null when any line has no ASIN (no silent partial carts)', () => {
    expect(
      buildAmazonCartUrl(
        [
          { sku: 'B0ABCDEFGH', url: '', qty: 1 },
          { sku: 'NOT-ASIN', url: '', qty: 1 },
        ],
        TAG
      )
    ).toBeNull();
  });
});

describe('buildRetailCartUrl', () => {
  it('opens the first product page for stores with no cart api', () => {
    const items = [
      { name: 'Tape', qty: 1, url: 'www.homedepot.com/p/123', sku: '', unitPriceCents: 500 },
    ];
    expect(buildRetailCartUrl('Home Depot', items)).toBe('https://www.homedepot.com/p/123');
  });
  it('builds a real amazon cart when the tag and every ASIN are present', () => {
    const url = buildRetailCartUrl(
      'amazon',
      [{ name: 'VHB Tape', qty: 1, url: '', sku: 'B00I4E4IUW', unitPriceCents: 3599 }],
      'bvisible-20'
    );
    expect(url).toContain('cart/add.html?AssociateTag=bvisible-20');
    expect(url).toContain('ASIN.1=B00I4E4IUW');
  });
  it('does NOT fall back to a product page for amazon — that looked like a broken cart', () => {
    const items = [
      { name: 'VHB Tape', qty: 1, url: 'https://www.amazon.com/dp/B00I4E4IUW', sku: 'B00I4E4IUW', unitPriceCents: 3599 },
    ];
    // No tag: a product page would open from a button labelled "Create cart".
    expect(buildRetailCartUrl('amazon', items)).toBeNull();
  });
  it('returns null with no usable urls', () => {
    expect(
      buildRetailCartUrl('Walmart', [{ name: 'x', qty: 1, url: '', sku: '', unitPriceCents: 1 }])
    ).toBeNull();
  });
});

describe('buildRetailItemLinks', () => {
  // The regression: with no cart URL the review panel filtered on the stored
  // product url — blank for every shop supply — so the office got a banner
  // claiming a cart had opened and not one actionable link.
  it('gives every line a link even with no sku and no url', () => {
    const links = buildRetailItemLinks('Amazon', [
      { name: 'Blue painters tape', qty: 3, url: '', sku: '', unitPriceCents: 799 },
      { name: '3M #94 Tape Primer', qty: 0.5, url: '', sku: '', unitPriceCents: 1200 },
    ]);
    expect(links.every((l) => l.href.startsWith('https://'))).toBe(true);
    expect(links[0]!.href).toBe('https://www.amazon.com/s?k=Blue%20painters%20tape');
    expect(links[0]!.qty).toBe(3);
    expect(links[1]!.qty).toBe(1); // partial qty rounds UP — carts take whole units
  });
  it('prefers the real product page when the sheet has one', () => {
    const links = buildRetailItemLinks('Amazon', [
      { name: 'Blue tape', qty: 1, url: 'www.amazon.com/dp/B0ABCDEFGH', sku: '', unitPriceCents: 799 },
    ]);
    expect(links[0]!.href).toBe('https://www.amazon.com/dp/B0ABCDEFGH');
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

describe('buildRetailItemLink', () => {
  it('prefers a stored product url', () => {
    expect(buildRetailItemLink('Home Depot', 'SKU1', 'Tape', 'www.homedepot.com/p/123')).toBe(
      'https://www.homedepot.com/p/123'
    );
  });
  it('links straight to /dp/ when the amazon sku is an ASIN', () => {
    expect(buildRetailItemLink('Amazon', 'B0ABCDEFGH', 'Tape')).toBe(
      'https://www.amazon.com/dp/B0ABCDEFGH'
    );
  });
  it('falls back to amazon search for non-ASIN skus', () => {
    expect(buildRetailItemLink('Amazon', '', 'Blue painters tape')).toBe(
      'https://www.amazon.com/s?k=Blue%20painters%20tape'
    );
  });
  it('builds store search links for home depot / lowes / walmart', () => {
    expect(buildRetailItemLink('Home Depot', '1001234567', 'Tape')).toBe(
      'https://www.homedepot.com/s/1001234567'
    );
    expect(buildRetailItemLink("Lowe's", '', '2x4 stud')).toBe(
      'https://www.lowes.com/search?searchTerm=2x4%20stud'
    );
    expect(buildRetailItemLink('Walmart', '', 'zip ties')).toBe(
      'https://www.walmart.com/search?q=zip%20ties'
    );
  });
  it('returns empty for unknown stores and empty queries', () => {
    expect(buildRetailItemLink('Grimco', 'SKU', 'vinyl')).toBe('');
    expect(buildRetailItemLink('Amazon', '', '  ')).toBe('');
  });
});
