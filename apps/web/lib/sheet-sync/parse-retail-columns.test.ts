import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GvizTable } from './gviz';

/**
 * The shop-order Amazon cart could never be built: the Internal Materials tab
 * — where every retail shop supply lives (blue tape, adhesives, primers) — had
 * no product-URL or SKU column, so `vendorSku`/`productUrl` reached the
 * shop-order catalog hardcoded empty. With no ASIN on any line,
 * `buildAmazonCartUrl` returned null for every order and the office was told a
 * cart had opened when nothing had.
 *
 * Cols 13 (product URL) and 14 (SKU/ASIN) are the fix. They are optional —
 * rows predating them must still parse.
 */

const fetchSheetTab = vi.hoisted(() => vi.fn());
vi.mock('./gviz', async () => {
  const actual = await vi.importActual<typeof import('./gviz')>('./gviz');
  return { ...actual, fetchSheetTab };
});

const EMPTY: GvizTable = { cols: [], rows: [] };

/** "Internal Materials": 0 id · 3 name · 6 price · 12 active · 13 url · 14 sku. */
function internalTab(
  rows: Array<{ id: string; name: string; price: number; url?: string; sku?: string; width?: number }>
): GvizTable {
  return {
    cols: new Array(15).fill(null).map(() => ({ label: '' })),
    rows: rows.map((r) => {
      const width = r.width ?? 15;
      const c: Array<{ v?: string | number | boolean | null } | null> = new Array(width).fill(null);
      c[0] = { v: r.id };
      c[3] = { v: r.name };
      c[6] = { v: r.price };
      c[12] = { v: 'TRUE' };
      if (r.url !== undefined && width > 13) c[13] = { v: r.url };
      if (r.sku !== undefined && width > 14) c[14] = { v: r.sku };
      return { c };
    }),
  };
}

beforeEach(() => {
  vi.resetModules();
  fetchSheetTab.mockReset();
});

describe('Internal Materials product URL / SKU columns', () => {
  it('reads the product url and sku so retail lines can resolve an ASIN', async () => {
    fetchSheetTab.mockImplementation(async (tab: string) =>
      tab === 'Internal Materials'
        ? internalTab([
            {
              id: 'blue-tape-roll',
              name: 'Blue Tape - Roll',
              price: 2.64,
              url: 'www.amazon.com/dp/B0ABCDEFGH',
              sku: 'B0ABCDEFGH',
            },
          ])
        : EMPTY
    );
    const { fetchAndParseSheet } = await import('./parse');
    const data = await fetchAndParseSheet();

    const tape = (data.internalMaterials ?? []).find((m) => m.name === 'Blue Tape - Roll')!;
    expect(tape.productUrl).toBe('www.amazon.com/dp/B0ABCDEFGH');
    expect(tape.vendorSku).toBe('B0ABCDEFGH');
  });

  it('parses rows written before the columns existed as empty, not undefined', async () => {
    fetchSheetTab.mockImplementation(async (tab: string) =>
      tab === 'Internal Materials'
        ? internalTab([{ id: 'old-row', name: 'Primer - Quart', price: 18.5, width: 13 }])
        : EMPTY
    );
    const { fetchAndParseSheet } = await import('./parse');
    const data = await fetchAndParseSheet();

    const primer = (data.internalMaterials ?? []).find((m) => m.name === 'Primer - Quart')!;
    expect(primer.productUrl).toBe('');
    expect(primer.vendorSku).toBe('');
  });
});
