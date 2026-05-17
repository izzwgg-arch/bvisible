import { describe, expect, it } from 'vitest';
import { mergeOrderedCatalogItemIds } from './catalog-lookup';

describe('mergeOrderedCatalogItemIds', () => {
  const base = {
    shopItemHit: false,
    shopAliasHit: false,
    skuCatalogRows: [] as { id: string; nameNormalized: string }[],
    shopNameExactCatalogRows: [] as { id: string; nameNormalized: string }[],
    shopAliasExactCatalogRows: [] as { id: string; nameNormalized: string }[],
    maxItems: 10,
  };

  it('prefers exact vendor alias over exact name and prefix', () => {
    const r = mergeOrderedCatalogItemIds({
      ...base,
      queryNormalized: 'VINYL',
      exactNames: [{ id: 'c1', nameNormalized: 'VINYL RED' }],
      prefixNames: [{ id: 'c2', nameNormalized: 'VINYL BLUE' }],
      exactAliasCatalogIds: ['c9'],
      prefixAliasCatalogIds: ['c8'],
    });
    expect(r.matchKind).toBe('exact_alias');
    expect(r.orderedIds).toEqual(['c9']);
  });

  it('uses exact name when no alias', () => {
    const r = mergeOrderedCatalogItemIds({
      ...base,
      queryNormalized: 'IJ180',
      exactNames: [{ id: 'c1', nameNormalized: 'IJ180' }],
      prefixNames: [],
      exactAliasCatalogIds: [],
      prefixAliasCatalogIds: [],
    });
    expect(r.matchKind).toBe('exact_name');
    expect(r.orderedIds).toEqual(['c1']);
  });

  it('uses vendor SKU before prefix buckets', () => {
    const r = mergeOrderedCatalogItemIds({
      ...base,
      queryNormalized: 'SKU123',
      exactNames: [],
      prefixNames: [{ id: 'pre', nameNormalized: 'SKU123X' }],
      exactAliasCatalogIds: [],
      prefixAliasCatalogIds: [],
      skuCatalogRows: [{ id: 'sku-row', nameNormalized: 'WIDGET' }],
    });
    expect(r.matchKind).toBe('vendor_sku');
    expect(r.orderedIds).toEqual(['sku-row']);
  });

  it('prefix alias before prefix name', () => {
    const r = mergeOrderedCatalogItemIds({
      ...base,
      queryNormalized: 'BAN',
      exactNames: [],
      prefixNames: [{ id: 'a', nameNormalized: 'BANNER A' }],
      exactAliasCatalogIds: [],
      prefixAliasCatalogIds: ['aid'],
    });
    expect(r.matchKind).toBe('prefix_alias');
    expect(r.orderedIds).toEqual(['aid']);
  });

  it('prefix name when only name prefix matches', () => {
    const r = mergeOrderedCatalogItemIds({
      ...base,
      queryNormalized: 'BAN',
      exactNames: [],
      prefixNames: [
        { id: 'b', nameNormalized: 'BANNER Z' },
        { id: 'a', nameNormalized: 'BANNER A' },
      ],
      exactAliasCatalogIds: [],
      prefixAliasCatalogIds: [],
    });
    expect(r.matchKind).toBe('prefix_name');
    expect(r.orderedIds).toEqual(['a', 'b']);
  });
});
