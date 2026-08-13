import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GvizTable } from './gviz';

/**
 * The Amazon links and ASINs are maintained on the "Meterial price" tab in
 * cols M (12) and N (13) — NOT on "Internal Materials", which is where the
 * retail columns were first added. Those two columns were being dropped on
 * import, so every Amazon order reached the PO with a blank SKU and no cart
 * could ever be prefilled, no matter how completely the Sheet was filled in.
 *
 * They sit past the vendor-price columns, so these also pin down that a URL
 * or an ASIN can never be mistaken for a price.
 */

const fetchSheetTab = vi.hoisted(() => vi.fn());
vi.mock('./gviz', async () => {
  const actual = await vi.importActual<typeof import('./gviz')>('./gviz');
  return { ...actual, fetchSheetTab };
});

const EMPTY: GvizTable = { cols: [], rows: [] };

/** "Meterial price": 0 name · 1 category · 10 cheapest · 11 vendor · 12 url · 13 sku. */
function materialsTab(
  rows: Array<{ name: string; cheapest?: number; url?: string; sku?: string }>
): GvizTable {
  return {
    // Real tab reports EMPTY labels (its header row is not row 1), which is
    // what makes the by-label vendor-price loop skip these columns.
    cols: new Array(14).fill(null).map(() => ({ label: '' })),
    rows: rows.map((r) => {
      const c: Array<{ v?: string | number | boolean | null } | null> = new Array(14).fill(null);
      c[0] = { v: r.name };
      c[1] = { v: 'Shop Supplies' };
      if (r.cheapest !== undefined) {
        c[10] = { v: r.cheapest };
        c[11] = { v: 'Amazon' };
      }
      if (r.url !== undefined) c[12] = { v: r.url };
      if (r.sku !== undefined) c[13] = { v: r.sku };
      return { c };
    }),
  };
}

beforeEach(() => {
  vi.resetModules();
  fetchSheetTab.mockReset();
});

describe('"Meterial price" retail columns', () => {
  it('imports the product url and ASIN instead of discarding them', async () => {
    fetchSheetTab.mockImplementation(async (tab: string) =>
      tab === 'Meterial price'
        ? materialsTab([
            {
              name: 'Blue Tape - Roll',
              cheapest: 2.64,
              url: 'https://www.amazon.com/dp/B08QDCJKHS',
              sku: 'B08QDCJKHS',
            },
          ])
        : EMPTY
    );
    const { fetchAndParseSheet } = await import('./parse');
    const data = await fetchAndParseSheet();

    const tape = data.materials.find((m) => m.name === 'Blue Tape - Roll')!;
    expect(tape.vendorSku).toBe('B08QDCJKHS');
    expect(tape.productUrl).toBe('https://www.amazon.com/dp/B08QDCJKHS');
    // The real reason this matters: the ASIN has to survive into a cart.
    const { buildAmazonCartUrl } = await import('@/lib/po/retail-cart');
    expect(buildAmazonCartUrl([{ sku: tape.vendorSku, url: tape.productUrl, qty: 1 }])).toContain(
      'ASIN.1=B08QDCJKHS'
    );
  });

  it('never mistakes a url or ASIN for a vendor price', async () => {
    fetchSheetTab.mockImplementation(async (tab: string) =>
      tab === 'Meterial price'
        ? materialsTab([
            {
              name: 'Blue Tape - Roll',
              cheapest: 2.64,
              url: 'https://www.amazon.com/dp/B08QDCJKHS',
              sku: 'B08QDCJKHS',
            },
          ])
        : EMPTY
    );
    const { fetchAndParseSheet } = await import('./parse');
    const data = await fetchAndParseSheet();

    const tape = data.materials.find((m) => m.name === 'Blue Tape - Roll')!;
    expect(tape.priceCents).toBe(264);
    expect(tape.vendorPrices.every((p) => p.priceCents > 0)).toBe(true);
    expect(tape.vendorPrices.some((p) => /amazon\.com|B08QDCJKHS/.test(p.vendor))).toBe(false);
  });

  it('leaves rows without retail columns empty rather than undefined', async () => {
    fetchSheetTab.mockImplementation(async (tab: string) =>
      tab === 'Meterial price' ? materialsTab([{ name: 'Acrylic Sheet', cheapest: 57.08 }]) : EMPTY
    );
    const { fetchAndParseSheet } = await import('./parse');
    const data = await fetchAndParseSheet();

    const acrylic = data.materials.find((m) => m.name === 'Acrylic Sheet')!;
    expect(acrylic.vendorSku).toBe('');
    expect(acrylic.productUrl).toBe('');
  });
});
