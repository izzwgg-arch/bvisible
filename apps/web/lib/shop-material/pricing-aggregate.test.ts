import { VendorPriceExtractionMethod } from '@bvisible/db';
import { describe, expect, it } from 'vitest';
import {
  cheapestAmongLatest,
  latestObservationCompare,
  latestObservationPerVendor,
  suggestedUnitCostCents,
  type PriceObservationRow,
} from './pricing-aggregate';

function obs(
  patch: Partial<PriceObservationRow> & Pick<PriceObservationRow, 'vendorId'>,
): PriceObservationRow {
  return {
    vendorName: 'Vendor',
    vendorCatalogItemId: 'cat-a',
    priceCents: 100,
    createdAt: new Date('2026-01-01T12:00:00Z'),
    effectiveAt: null,
    extractionMethod: VendorPriceExtractionMethod.LINE_REGEX,
    ...patch,
  };
}

describe('latestObservationPerVendor', () => {
  it('picks the row with the later observation instant', () => {
    const map = latestObservationPerVendor([
      obs({
        vendorId: 'v1',
        effectiveAt: new Date('2026-02-01'),
        createdAt: new Date('2026-01-01'),
        priceCents: 500,
      }),
      obs({
        vendorId: 'v1',
        effectiveAt: new Date('2026-01-15'),
        createdAt: new Date('2026-03-01'),
        priceCents: 400,
      }),
    ]);
    expect(map.get('v1')?.priceCents).toBe(500);
  });

  it('when instant ties, prefers newer createdAt', () => {
    const t = new Date('2026-02-01T00:00:00Z');
    const map = latestObservationPerVendor([
      obs({
        vendorId: 'v1',
        effectiveAt: t,
        createdAt: new Date('2026-01-02'),
        vendorCatalogItemId: 'c2',
        extractionMethod: VendorPriceExtractionMethod.MANUAL,
        priceCents: 1,
      }),
      obs({
        vendorId: 'v1',
        effectiveAt: t,
        createdAt: new Date('2026-01-03'),
        vendorCatalogItemId: 'c1',
        extractionMethod: VendorPriceExtractionMethod.MANUAL,
        priceCents: 2,
      }),
    ]);
    expect(map.get('v1')?.priceCents).toBe(2);
  });

  it('when instant + createdAt tie, prefers MANUAL over OCR_APPROVED', () => {
    const inst = new Date('2026-02-01T00:00:00Z');
    const created = new Date('2026-01-05T00:00:00Z');
    const map = latestObservationPerVendor([
      obs({
        vendorId: 'v1',
        effectiveAt: inst,
        createdAt: created,
        vendorCatalogItemId: 'c-high',
        extractionMethod: VendorPriceExtractionMethod.OCR_APPROVED,
        priceCents: 11,
      }),
      obs({
        vendorId: 'v1',
        effectiveAt: inst,
        createdAt: created,
        vendorCatalogItemId: 'c-low',
        extractionMethod: VendorPriceExtractionMethod.MANUAL,
        priceCents: 22,
      }),
    ]);
    expect(map.get('v1')?.extractionMethod).toBe(VendorPriceExtractionMethod.MANUAL);
    expect(map.get('v1')?.vendorCatalogItemId).toBe('c-low');
  });

  it('when instant + createdAt + method tie, breaks ties by vendorCatalogItemId lexicographic', () => {
    const inst = new Date('2026-02-01T00:00:00Z');
    const created = new Date('2026-01-05T00:00:00Z');
    const map = latestObservationPerVendor([
      obs({
        vendorId: 'v1',
        effectiveAt: inst,
        createdAt: created,
        vendorCatalogItemId: 'z-item',
        extractionMethod: VendorPriceExtractionMethod.MANUAL,
        priceCents: 50,
      }),
      obs({
        vendorId: 'v1',
        effectiveAt: inst,
        createdAt: created,
        vendorCatalogItemId: 'a-item',
        extractionMethod: VendorPriceExtractionMethod.MANUAL,
        priceCents: 99,
      }),
    ]);
    expect(map.get('v1')?.vendorCatalogItemId).toBe('a-item');
  });
});

describe('latestObservationCompare', () => {
  it('is deterministic for identical economics rows', () => {
    const inst = new Date('2026-02-01T00:00:00Z');
    const created = new Date('2026-01-05T00:00:00Z');
    const a = obs({
      vendorId: 'v1',
      effectiveAt: inst,
      createdAt: created,
      vendorCatalogItemId: 'same',
      extractionMethod: VendorPriceExtractionMethod.MANUAL,
      priceCents: 10,
    });
    const b = { ...a };
    expect(latestObservationCompare(a, b)).toBe(false);
    expect(latestObservationCompare(b, a)).toBe(false);
  });
});

describe('cheapestAmongLatest', () => {
  it('picks lowest latest price', () => {
    const map = new Map<string, PriceObservationRow>([
      ['v1', obs({ vendorId: 'v1', priceCents: 300 })],
      ['v2', obs({ vendorId: 'v2', vendorName: 'CheapCo', priceCents: 100 })],
    ]);
    const c = cheapestAmongLatest(map);
    expect(c?.vendorId).toBe('v2');
    expect(c?.priceCents).toBe(100);
  });

  it('when prices tie, prefers lexicographically smaller vendorId', () => {
    const map = new Map<string, PriceObservationRow>([
      ['zz', obs({ vendorId: 'zz', priceCents: 50 })],
      ['aa', obs({ vendorId: 'aa', priceCents: 50 })],
    ]);
    expect(cheapestAmongLatest(map)?.vendorId).toBe('aa');
  });
});

describe('suggestedUnitCostCents', () => {
  it('uses preferred vendor latest even when another vendor is cheaper', () => {
    const latestByVendor = latestObservationPerVendor([
      obs({
        vendorId: 'preferred',
        priceCents: 500,
        vendorCatalogItemId: 'c1',
      }),
      obs({
        vendorId: 'cheap',
        priceCents: 100,
        vendorCatalogItemId: 'c2',
      }),
    ]);
    expect(
      suggestedUnitCostCents({
        preferredVendorId: 'preferred',
        latestByVendor,
      }),
    ).toBe(500);
  });

  it('falls back to cheapest latest when no preferred snapshot exists', () => {
    const latestByVendor = latestObservationPerVendor([
      obs({
        vendorId: 'a',
        priceCents: 400,
        vendorCatalogItemId: 'c1',
      }),
      obs({
        vendorId: 'b',
        priceCents: 200,
        vendorCatalogItemId: 'c2',
      }),
    ]);
    expect(
      suggestedUnitCostCents({
        preferredVendorId: 'ghost',
        latestByVendor,
      }),
    ).toBe(200);
  });
});
