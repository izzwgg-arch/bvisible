import { EstimateLineKind } from '@bvisible/db';
import { describe, expect, it } from 'vitest';
import {
  buildLinePatchFromCatalogSelection,
  catalogKindToEstimateLineKind,
  resolveCatalogUnitCostCents,
  type EstimateCatalogPickerRow,
} from './apply-catalog-to-estimate-line';

function row(partial: Partial<EstimateCatalogPickerRow>): EstimateCatalogPickerRow {
  return {
    id: 'i1',
    name: 'Test',
    nameNormalized: 'test',
    kind: EstimateLineKind.MATERIAL,
    catalogUnit: 'EACH',
    customUnitLabel: null,
    internalCostCents: 1000,
    markupPercentMilli: 0,
    defaultSellPriceCents: null,
    defaultQtyMilli: 2000,
    machineId: null,
    preferredVendorId: null,
    suggestedVendorCostCents: null,
    ...partial,
  };
}

describe('resolveCatalogUnitCostCents', () => {
  it('prefers vendor suggestion for MATERIAL when present', () => {
    const cents = resolveCatalogUnitCostCents({
      row: row({
        kind: EstimateLineKind.MATERIAL,
        internalCostCents: 500,
        suggestedVendorCostCents: 13250,
      }),
      machinesById: new Map(),
    });
    expect(cents).toBe(13250);
  });

  it('falls back to internal cost for MATERIAL without vendor suggestion', () => {
    expect(
      resolveCatalogUnitCostCents({
        row: row({ kind: EstimateLineKind.MATERIAL, internalCostCents: 8800 }),
        machinesById: new Map(),
      }),
    ).toBe(8800);
  });

  it('uses machine rate when MACHINE row has machineId', () => {
    expect(
      resolveCatalogUnitCostCents({
        row: row({
          kind: EstimateLineKind.MACHINE,
          machineId: 'm1',
          internalCostCents: 1,
        }),
        machinesById: new Map([['m1', { ratePerHourCents: 9500 }]]),
      }),
    ).toBe(9500);
  });

  it('uses internal cost for LABOR', () => {
    expect(
      resolveCatalogUnitCostCents({
        row: row({ kind: EstimateLineKind.LABOR, internalCostCents: 7500 }),
        machinesById: new Map(),
      }),
    ).toBe(7500);
  });
});

describe('buildLinePatchFromCatalogSelection', () => {
  it('fills description, kind, qty, unit cost; clears machine when not MACHINE kind', () => {
    const patch = buildLinePatchFromCatalogSelection({
      row: row({
        name: 'ACM WHITE',
        kind: EstimateLineKind.MISC,
        defaultQtyMilli: 3000,
        internalCostCents: 250,
      }),
      machinesById: new Map(),
    });
    expect(patch).toEqual({
      description: 'ACM WHITE',
      kind: EstimateLineKind.MISC,
      qtyMilli: 3000,
      unitCostCents: 250,
      machineId: null,
    });
  });
});

describe('catalogKindToEstimateLineKind', () => {
  it('is stable', () => {
    expect(catalogKindToEstimateLineKind(EstimateLineKind.DESIGN)).toBe(EstimateLineKind.DESIGN);
  });
});
