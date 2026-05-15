import { EstimateLineKind } from '@bvisible/db';
import { describe, expect, it } from 'vitest';
import {
  buildLinePatchFromCatalogSelection,
  catalogKindToEstimateLineKind,
  catalogPickerSellHintCents,
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
    catalogPreferredVendorCostCents: null,
    catalogPreferredVendorName: null,
    catalogCheapestVendorCostCents: null,
    catalogCheapestVendorName: null,
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

  it('uses internal cost for INSTALL like non-machine kinds', () => {
    expect(
      resolveCatalogUnitCostCents({
        row: row({ kind: EstimateLineKind.INSTALL, internalCostCents: 4400 }),
        machinesById: new Map(),
      }),
    ).toBe(4400);
  });

  it('uses internal cost for DESIGN', () => {
    expect(
      resolveCatalogUnitCostCents({
        row: row({ kind: EstimateLineKind.DESIGN, internalCostCents: 15000 }),
        machinesById: new Map(),
      }),
    ).toBe(15000);
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

  it('INSTALL catalog row carries qty + internal hourly-style cost', () => {
    const patch = buildLinePatchFromCatalogSelection({
      row: row({
        name: 'Site install',
        kind: EstimateLineKind.INSTALL,
        defaultQtyMilli: 8000,
        internalCostCents: 15000,
      }),
      machinesById: new Map(),
    });
    expect(patch.kind).toBe(EstimateLineKind.INSTALL);
    expect(patch.qtyMilli).toBe(8000);
    expect(patch.unitCostCents).toBe(15000);
    expect(patch.machineId).toBeNull();
  });

  it('DESIGN catalog row patch', () => {
    const patch = buildLinePatchFromCatalogSelection({
      row: row({
        name: 'Creative package',
        kind: EstimateLineKind.DESIGN,
        defaultQtyMilli: 1000,
        internalCostCents: 24000,
      }),
      machinesById: new Map(),
    });
    expect(patch.kind).toBe(EstimateLineKind.DESIGN);
    expect(patch.unitCostCents).toBe(24000);
  });
});

describe('catalogPickerSellHintCents', () => {
  const machines = new Map<string, { ratePerHourCents: number }>();

  it('uses default ×3-equivalent markup when markupPercentMilli is 200000 (200% above cost)', () => {
    expect(
      catalogPickerSellHintCents({
        row: row({ internalCostCents: 10_000, markupPercentMilli: 200_000 }),
        machinesById: machines,
      }),
    ).toBe(30_000);
  });

  it('item-level markup % derives sell from resolved unit cost basis', () => {
    expect(
      catalogPickerSellHintCents({
        row: row({
          internalCostCents: 500,
          suggestedVendorCostCents: 800,
          markupPercentMilli: 50_000,
        }),
        machinesById: machines,
      }),
    ).toBe(1200);
  });

  it('explicit catalog sell override wins over markup', () => {
    expect(
      catalogPickerSellHintCents({
        row: row({
          internalCostCents: 100,
          markupPercentMilli: 200_000,
          defaultSellPriceCents: 999,
        }),
        machinesById: machines,
      }),
    ).toBe(999);
  });

  it('uses machine hourly rate as basis for MACHINE rows', () => {
    expect(
      catalogPickerSellHintCents({
        row: row({
          kind: EstimateLineKind.MACHINE,
          machineId: 'm1',
          internalCostCents: 1,
          markupPercentMilli: 0,
        }),
        machinesById: new Map([['m1', { ratePerHourCents: 12_000 }]]),
      }),
    ).toBe(12_000);
  });
});

describe('catalogKindToEstimateLineKind', () => {
  it('is stable', () => {
    expect(catalogKindToEstimateLineKind(EstimateLineKind.DESIGN)).toBe(EstimateLineKind.DESIGN);
  });
});
