import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GvizTable } from './gviz';

/**
 * Items added to the Sheet before their price is known used to vanish: both
 * parsers dropped any row computing to a zero price, with no error anywhere.
 * That silently hid 77 real rows ("Banner Grommets", "Clear Acrylic Sheet",
 * "BIG RED Tape", …).
 *
 * They are now carried through flagged `unpriced` so the Catalog can show them
 * as "Price not set" — which makes the flag load-bearing for safety: anything
 * that produces money must filter on it, or an unpriced item gets quoted or
 * ordered at $0.00.
 */

const fetchSheetTab = vi.hoisted(() => vi.fn());
vi.mock('./gviz', async () => {
  const actual = await vi.importActual<typeof import('./gviz')>('./gviz');
  return { ...actual, fetchSheetTab };
});

const EMPTY: GvizTable = { cols: [], rows: [] };

/** "Meterial price": 0 name · 1 category · 10 cheapest price · 11 cheapest vendor. */
function materialsTab(rows: Array<{ name: string; category: string; cheapest?: number }>): GvizTable {
  const labels = [
    'Item', 'Category', 'Item', 'S&F', 'Grimco', '', 'Letra lit', '', '', '',
    'Cheapest price', 'Cheapest vendor',
  ];
  return {
    cols: labels.map((label) => ({ label })),
    rows: rows.map((r) => {
      const c: Array<{ v?: string | number | boolean | null } | null> = new Array(12).fill(null);
      c[0] = { v: r.name };
      c[1] = { v: r.category };
      if (r.cheapest !== undefined) {
        c[10] = { v: r.cheapest };
        c[11] = { v: 'S&F' };
      }
      return { c };
    }),
  };
}

/** "Internal Materials": 0 id · 3 name · 6 price · 12 active. */
function internalTab(rows: Array<{ id: string; name: string; price?: number; active: boolean }>): GvizTable {
  return {
    cols: new Array(13).fill(null).map(() => ({ label: '' })),
    rows: rows.map((r) => {
      const c: Array<{ v?: string | number | boolean | null } | null> = new Array(13).fill(null);
      c[0] = { v: r.id };
      c[3] = { v: r.name };
      if (r.price !== undefined) c[6] = { v: r.price };
      c[12] = { v: r.active ? 'TRUE' : 'FALSE' };
      return { c };
    }),
  };
}

function stubTabs(overrides: Record<string, GvizTable>) {
  fetchSheetTab.mockImplementation(async (tab: string) => overrides[tab] ?? EMPTY);
}

beforeEach(() => {
  vi.resetModules();
  fetchSheetTab.mockReset();
});

describe('unpriced Sheet rows survive the import', () => {
  it('keeps a material with no price, flagged, instead of dropping it', async () => {
    stubTabs({
      'Meterial price': materialsTab([
        { name: 'Grommets - Box', category: 'Hardware', cheapest: 59.44 },
        { name: 'Banner Grommets - Adhesive - 30-piece pack', category: 'Hardware' },
      ]),
    });
    const { fetchAndParseSheet } = await import('./parse');
    const data = await fetchAndParseSheet();

    expect(data.materials.map((m) => m.name)).toEqual([
      'Grommets - Box',
      'Banner Grommets - Adhesive - 30-piece pack',
    ]);

    const priced = data.materials[0]!;
    expect(priced.unpriced).toBe(false);
    expect(priced.priceCents).toBe(5944);

    const unpriced = data.materials[1]!;
    expect(unpriced.unpriced).toBe(true);
    expect(unpriced.priceCents).toBe(0);
    // Still carries enough identity to upsert and display.
    expect(unpriced.key).toBeTruthy();
    expect(unpriced.category).toBe('Hardware');
  });

  it('keeps an unpriced shop supply but still skips ones marked inactive', async () => {
    stubTabs({
      'Internal Materials': internalTab([
        { id: 'blue-tape-roll', name: 'Blue Tape - Roll', price: 2.64, active: true },
        { id: 'banner-grommets-adhesive-30-pack', name: 'Banner Grommets', active: true },
        { id: 'retired-thing', name: 'Retired Thing', price: 9.99, active: false },
      ]),
    });
    const { fetchAndParseSheet } = await import('./parse');
    const data = await fetchAndParseSheet();

    const names = (data.internalMaterials ?? []).map((m) => m.name);
    expect(names).toContain('Blue Tape - Roll');
    expect(names).toContain('Banner Grommets'); // unpriced, kept
    expect(names).not.toContain('Retired Thing'); // inactive is a different rule

    const grommets = (data.internalMaterials ?? []).find((m) => m.name === 'Banner Grommets')!;
    expect(grommets.unpriced).toBe(true);
    expect(grommets.priceCents).toBe(0);
  });

  it('flags nothing as unpriced when every row has a price', async () => {
    stubTabs({
      'Meterial price': materialsTab([
        { name: 'A', category: 'X', cheapest: 1 },
        { name: 'B', category: 'X', cheapest: 2 },
      ]),
    });
    const { fetchAndParseSheet } = await import('./parse');
    const data = await fetchAndParseSheet();
    expect(data.materials.every((m) => m.unpriced === false)).toBe(true);
  });
});
