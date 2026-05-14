import { describe, expect, it } from 'vitest';
import { mergeOrderedCatalogItemIds } from './catalog-lookup';

describe('mergeOrderedCatalogItemIds', () => {
  it('prefers exact catalog name over aliases and prefixes', () => {
    const r = mergeOrderedCatalogItemIds({
      queryNormalized: 'VINYL',
      exactNames: [{ id: 'c1', nameNormalized: 'VINYL RED' }],
      prefixNames: [{ id: 'c2', nameNormalized: 'VINYL BLUE' }],
      exactAliasCatalogIds: ['c9'],
      prefixAliasCatalogIds: ['c8'],
      maxItems: 10,
    });
    expect(r.matchKind).toBe('exact_name');
    expect(r.orderedIds).toEqual(['c1']);
  });

  it('uses exact alias when no exact catalog name', () => {
    const r = mergeOrderedCatalogItemIds({
      queryNormalized: 'IJ180',
      exactNames: [],
      prefixNames: [{ id: 'c2', nameNormalized: 'IJ180CV3 WRAP' }],
      exactAliasCatalogIds: ['alias-target'],
      prefixAliasCatalogIds: [],
      maxItems: 10,
    });
    expect(r.matchKind).toBe('exact_alias');
    expect(r.orderedIds).toEqual(['alias-target']);
  });

  it('prefix merge is deterministic (sorted name, then sorted alias ids)', () => {
    const r = mergeOrderedCatalogItemIds({
      queryNormalized: 'BAN',
      exactNames: [],
      prefixNames: [
        { id: 'b', nameNormalized: 'BANNER Z' },
        { id: 'a', nameNormalized: 'BANNER A' },
      ],
      exactAliasCatalogIds: [],
      prefixAliasCatalogIds: ['zid', 'aid'],
      maxItems: 10,
    });
    expect(r.matchKind).toBe('prefix');
    expect(r.orderedIds).toEqual(['a', 'b', 'aid', 'zid']);
  });

  it('respects maxItems cap without fuzzy reordering', () => {
    const r = mergeOrderedCatalogItemIds({
      queryNormalized: 'X',
      exactNames: [],
      prefixNames: [
        { id: '1', nameNormalized: 'XA' },
        { id: '2', nameNormalized: 'XB' },
        { id: '3', nameNormalized: 'XC' },
      ],
      exactAliasCatalogIds: [],
      prefixAliasCatalogIds: ['4', '5'],
      maxItems: 3,
    });
    expect(r.orderedIds).toEqual(['1', '2', '3']);
  });

  it('returns none when nothing matches', () => {
    const r = mergeOrderedCatalogItemIds({
      queryNormalized: 'ZZ',
      exactNames: [],
      prefixNames: [],
      exactAliasCatalogIds: [],
      prefixAliasCatalogIds: [],
      maxItems: 5,
    });
    expect(r.matchKind).toBe('none');
    expect(r.orderedIds).toEqual([]);
  });
});
