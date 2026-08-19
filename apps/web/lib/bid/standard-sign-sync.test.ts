import { describe, expect, it } from 'vitest';
import { parseStandardSignsTable, literalRateCents, normalizeSheetPricingMethod, normalizeSignKey } from '@/lib/sheet-sync/parse-standard-signs';
import { qbItemFromSheetLabel, sheetSignToRow, syncStandardSignsFromSheet } from './standard-sign-sync';
import type { SheetStandardSign } from '@/lib/sheet-sync/types';

type Row = Record<string, unknown> & { id: string; signKey: string; source: string; active: boolean; nameNormalized: string; aliases: string[] };

/** Minimal in-memory stand-in for prisma.standardSign. */
function fakeDb(rows: Row[]) {
  let seq = rows.length;
  const created: Row[] = [];
  const updated: Array<{ id: string; data: Record<string, unknown> }> = [];
  return {
    rows,
    created,
    updated,
    standardSign: {
      findMany: async () => rows,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        const row = { id: `new-${seq}`, ...data } as Row;
        rows.push(row);
        created.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        updated.push({ id: where.id, data });
        return row;
      },
    },
  };
}

function sheetSign(p: Partial<SheetStandardSign> & Pick<SheetStandardSign, 'signKey' | 'name'>): SheetStandardSign {
  return {
    active: true, category: '', qbItem: '', customerDescription: '', widthIn: null, heightIn: null, unit: 'in',
    material: '', thickness: '', construction: '', mounting: '', tactile: null, braille: null, illumination: '',
    pricingMethod: 'PER_SIGN', pricingUnit: 'SIGN', rateKey: '60', rateCents: 6000, minimumChargeCents: null,
    wastePercent: null, defaultMachine: '', shopHours: null, designUnits: null, installHours: null, aliases: [],
    formulaVersion: '', notes: '', sheetRow: 2, ...p,
  };
}

const gviz = (header: string[], rows: Array<Array<string | number | boolean | null>>) => ({
  cols: header.map((label) => ({ label })),
  rows: rows.map((r) => ({ c: r.map((v) => (v === null ? null : { v })) })),
});

describe('parseStandardSignsTable', () => {
  const HEADER = ['Sign Key', 'Active', 'Category', 'Sign Name', 'QB Item', 'Customer Description', 'Width', 'Height', 'Unit', 'Material', 'Braille', 'Illumination', 'Pricing Method', 'Rate Key', 'Minimum Charge', 'Aliases', 'Notes'];

  it('reads the recommended header contract and normalizes methods, rates and aliases', () => {
    const t = parseStandardSignsTable(
      gviz(HEADER, [
        ['unit-id', 'TRUE', 'Interior ADA', 'Residential Unit ID Sign', 'Sales', 'Unit ID signs with Braille', 6, 8, 'in', 'acrylic', 'Yes', '', 'Per Sign', '$60.00', '', 'Apartment Entry Signage; Unit Number Sign', ''],
        ['halo-address', 'TRUE', 'Exterior', 'Halo-Lit Address', 'Channel Letters', '', null, 18, 'in', 'aluminum', 'No', 'halo', 'per character', '225', '450', '', 'Reverse lit'],
        ['sqft-panel', 'FALSE', 'Interior', 'Printed Wall Panel', '', '', null, null, 'in', '', '', '', 'Square Foot', 'Wall Panel Sq Ft', '', '', ''],
      ])
    );
    expect(t.status).toBe('OK');
    expect(t.signs).toHaveLength(3);
    expect(t.signs[0]).toMatchObject({ signKey: 'unit-id', name: 'Residential Unit ID Sign', qbItem: 'Sales', widthIn: 6, heightIn: 8, braille: true, pricingMethod: 'PER_SIGN', pricingUnit: 'SIGN', rateCents: 6000, aliases: ['Apartment Entry Signage', 'Unit Number Sign'] });
    expect(t.signs[1]).toMatchObject({ pricingMethod: 'PER_CHARACTER', pricingUnit: 'CHARACTER', rateCents: 22500, minimumChargeCents: 45000, braille: false, illumination: 'halo' });
    expect(t.signs[2]).toMatchObject({ active: false, pricingMethod: 'PER_SQFT', pricingUnit: 'SQ_FT', rateKey: 'Wall Panel Sq Ft', rateCents: null });
    expect(t.signs.map((s) => s.sheetRow)).toEqual([1, 2, 3]);
  });

  it('refuses an unrelated tab (gviz can answer with the wrong sheet)', () => {
    const t = parseStandardSignsTable(gviz(['Item', 'Category', 'S&F', 'Grimco'], [['Coroplast 4mm', 'Substrate', 12, 13]]));
    expect(t.status).toBe('UNRECOGNIZED');
    expect(t.signs).toEqual([]);
  });

  it('skips duplicate sign keys within the tab (first row wins)', () => {
    const t = parseStandardSignsTable(gviz(HEADER, [
      ['unit-id', 'TRUE', '', 'Residential Unit ID Sign', '', '', null, null, '', '', '', '', 'Per Sign', '60', '', '', ''],
      ['Unit ID', 'TRUE', '', 'Another Unit Sign', '', '', null, null, '', '', '', '', 'Per Sign', '99', '', '', ''],
    ]));
    expect(t.signs).toHaveLength(1);
    expect(t.duplicateKeys).toEqual(['unit-id']);
  });

  it('helpers: literal rates, method normalization, key normalization', () => {
    expect(literalRateCents('$1,250.50')).toBe(125050);
    expect(literalRateCents('Sq Ft Item')).toBeNull();
    expect(normalizeSheetPricingMethod('per square foot')).toBe('PER_SQFT');
    expect(normalizeSheetPricingMethod('Per Letter')).toBe('PER_CHARACTER');
    expect(normalizeSheetPricingMethod('')).toBe('PER_SIGN');
    expect(normalizeSignKey('Residential Unit ID Sign!')).toBe('residential-unit-id-sign');
  });
});

describe('syncStandardSignsFromSheet', () => {
  it('creates new signs, updates changed ones, and touches unchanged ones', async () => {
    const db = fakeDb([
      { id: 'a', signKey: 'unit-id', source: 'SHEET', active: true, name: 'Residential Unit ID Sign', nameNormalized: 'residential unit id sign', aliases: [], rateCents: 5000, qbItem: 'SALES', pricingMethod: 'PER_SIGN', pricingUnit: 'SIGN' } as Row,
    ]);
    const now = new Date('2026-08-19T00:00:00.000Z');
    const r = await syncStandardSignsFromSheet(db as never, 't1', [
      sheetSign({ signKey: 'unit-id', name: 'Residential Unit ID Sign', rateKey: '60', rateCents: 6000 }),
      sheetSign({ signKey: 'exit', name: 'Tactile EXIT Sign', rateKey: '50', rateCents: 5000 }),
    ], 'OK', now);
    expect(r).toMatchObject({ created: 1, updated: 1, deactivated: 0, skippedDuplicates: [] });
    expect(db.created[0]!.signKey).toBe('exit');
    expect(db.rows.find((x) => x.signKey === 'unit-id')!.rateCents).toBe(6000);
  });

  it('never creates a duplicate for a name that already belongs to a different sign', async () => {
    const db = fakeDb([
      { id: 'a', signKey: 'unit-id', source: 'SHEET', active: true, name: 'Residential Unit ID Sign', nameNormalized: 'residential unit id sign', aliases: ['Apartment Entry Signage'] } as Row,
    ]);
    const r = await syncStandardSignsFromSheet(db as never, 't1', [
      sheetSign({ signKey: 'unit-id-2', name: 'Residential Unit ID Sign' }),
      sheetSign({ signKey: 'unit-id-3', name: 'Apartment Entry Signage' }),
    ], 'OK');
    expect(r.created).toBe(0);
    expect(r.skippedDuplicates.sort()).toEqual(['unit-id-2', 'unit-id-3']);
  });

  it('deactivates Sheet rows that disappeared but never touches app-promoted signs', async () => {
    const db = fakeDb([
      { id: 'a', signKey: 'gone', source: 'SHEET', active: true, name: 'Gone Sign', nameNormalized: 'gone sign', aliases: [] } as Row,
      { id: 'b', signKey: 'promoted', source: 'APP', active: true, name: 'Promoted Sign', nameNormalized: 'promoted sign', aliases: [] } as Row,
    ]);
    const r = await syncStandardSignsFromSheet(db as never, 't1', [sheetSign({ signKey: 'kept', name: 'Kept Sign' })], 'OK');
    expect(r.deactivated).toBe(1);
    expect(db.rows.find((x) => x.signKey === 'gone')!.active).toBe(false);
    expect(db.rows.find((x) => x.signKey === 'promoted')!.active).toBe(true);
  });

  it('does nothing at all when the tab is missing or unrecognized (a fetch blip must not wipe the catalog)', async () => {
    const db = fakeDb([{ id: 'a', signKey: 'unit-id', source: 'SHEET', active: true, name: 'Unit', nameNormalized: 'unit', aliases: [] } as Row]);
    expect(await syncStandardSignsFromSheet(db as never, 't1', [], 'MISSING')).toMatchObject({ created: 0, updated: 0, deactivated: 0 });
    expect(await syncStandardSignsFromSheet(db as never, 't1', [], 'UNRECOGNIZED')).toMatchObject({ deactivated: 0 });
    expect(db.rows[0]!.active).toBe(true);
  });

  it('maps Sheet QB item labels onto the structured enum', () => {
    expect(qbItemFromSheetLabel('3D Lettering')).toBe('THREE_D_LETTERING');
    expect(qbItemFromSheetLabel('channel letters')).toBe('CHANNEL_LETTERS');
    expect(qbItemFromSheetLabel('Canopy')).toBe('CANOPY');
    expect(qbItemFromSheetLabel('vehicle wrapping')).toBe('WRAPPING');
    expect(qbItemFromSheetLabel('')).toBe('SALES');
    expect(qbItemFromSheetLabel('Nonsense')).toBe('SALES');
  });

  it('converts Sheet units into the app scales', () => {
    const row = sheetSignToRow('t1', sheetSign({ signKey: 'x', name: 'X', widthIn: 6, heightIn: 8.5, wastePercent: 12.5, shopHours: 1.5, minimumChargeCents: 4500 }), new Date());
    expect(row).toMatchObject({ widthMilli: 6000, heightMilli: 8500, wastePercentMilli: 12500, shopHoursMilli: 1500, minimumChargeCents: 4500, source: 'SHEET' });
  });
});
