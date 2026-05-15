import { describe, expect, it } from 'vitest';
import { VendorPriceExtractionMethod } from '@bvisible/db';
import {
  cheapestAmongLatest,
  latestObservationPerVendor,
  observationInstant,
  suggestedUnitCostCents,
  type PriceObservationRow,
} from './pricing-aggregate';

function row(p: Partial<PriceObservationRow> & Pick<PriceObservationRow, 'vendorId' | 'priceCents'>): PriceObservationRow {
  return {
    vendorName: 'V',
    vendorCatalogItemId: 'c',
    createdAt: new Date('2026-01-01T12:00:00Z'),
    effectiveAt: null,
    extractionMethod: VendorPriceExtractionMethod.MANUAL,
    ...p,
  };
}

describe('pricing-aggregate', () => {
  it('observationInstant prefers effectiveAt over createdAt', () => {
    const t = observationInstant({
      effectiveAt: new Date('2025-06-01T00:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    expect(t).toBe(new Date('2025-06-01T00:00:00Z').getTime());
  });

  it('latestObservationPerVendor picks newest observation per vendor', () => {
    const rows: PriceObservationRow[] = [
      row({ vendorId: 'a', priceCents: 100, createdAt: new Date('2026-01-01') }),
      row({ vendorId: 'a', priceCents: 90, createdAt: new Date('2026-02-01') }),
      row({ vendorId: 'b', priceCents: 80, createdAt: new Date('2026-01-15') }),
    ];
    const m = latestObservationPerVendor(rows);
    expect(m.get('a')!.priceCents).toBe(90);
    expect(m.get('b')!.priceCents).toBe(80);
  });

  it('cheapestAmongLatest finds minimum latest price', () => {
    const m = latestObservationPerVendor([
      row({ vendorId: 'a', vendorName: 'A', priceCents: 120 }),
      row({ vendorId: 'b', vendorName: 'B', priceCents: 95 }),
    ]);
    const c = cheapestAmongLatest(m);
    expect(c?.vendorId).toBe('b');
    expect(c?.priceCents).toBe(95);
  });

  it('suggestedUnitCostCents prefers preferred vendor latest when present', () => {
    const m = latestObservationPerVendor([
      row({ vendorId: 'p', priceCents: 200 }),
      row({ vendorId: 'q', priceCents: 50 }),
    ]);
    expect(
      suggestedUnitCostCents({
        preferredVendorId: 'p',
        latestByVendor: m,
      }),
    ).toBe(200);
    expect(
      suggestedUnitCostCents({
        preferredVendorId: null,
        latestByVendor: m,
      }),
    ).toBe(50);
  });
});
