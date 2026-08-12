import { describe, expect, it } from 'vitest';
import { detectColumns, parseTakeoffRows, type SheetRows } from './parse-takeoff';

// Fixtures modeled on a real employee takeoff workbook
// ("234 Clark Avenue - Signage Takeoff"): a client-facing schedule tab
// (sell prices) and a floor-by-floor estimating tab (costs), both with
// title rows above the header and subtotal/tax/total rows mixed in.

const scheduleTab: SheetRows = [
  ['234 CLARKSON AVENUE — DIVISION 10 14 00 SIGNAGE SCHEDULE'],
  ['Brooklyn, NY 11222'],
  [],
  ['Status Legend:'],
  [],
  ['Name', 'Description', 'Qty', 'Price Each', 'Extended Price', 'Status', 'Basis / Notes'],
  ['Exterior & Building Identification'],
  ['Building ID', 'Three dimensional numerals reading “234”.', 3, 100, 300, 'Confirmed'],
  ['Standpipe / FDC Sign', 'Approved metal STANDPIPE sign.', 1, 25, 25, 'Confirmed'],
  ['Subtotal — Exterior & Building Identification', null, null, null, 325],
  [],
  ['Interior Signage'],
  ['Apartment Entry Signage', 'Raised unit number + Braille.', 98, 60, 5880, 'Confirmed'],
  ['Subtotal — Interior Signage', null, null, null, 5880],
  ['GRAND TOTAL (Priced Items Only)', null, null, null, 6205],
  [],
  ['Design, Installation & Sales Tax'],
  ['Design & Layout / File Setup', 'Project file setup across 18 sign types.', 1, 800, 800, 'Estimated'],
  ['Installation Labor', 'Priced per crew-hour across all signs.', 2, 2800, 5600, 'Estimated'],
  [null, null, null, null, 12605],
  ['Sales Tax Rate', null, null, null, 0.08875],
  ['Sales Tax', null, null, null, 1118.69],
  ['TOTAL INVESTMENT', null, null, null, 13723.69],
];

const estimatingTab: SheetRows = [
  [null, '234 CLARKSON AVE.'],
  [null, 'BROOKLYN, NY 11222'],
  [null, 'SIGNAGES QUANTITY TAKEOFF'],
  [null, 'Division 10 — Specialties | Section 10 14 00 — Signage'],
  [null, 'Name', 'Description', 'Qty', 'Units', 'Cost Each', 'Markup %', 'Price Each', 'Price Total'],
  [null, 'Exterior & Building Identification'],
  [null, 'Building ID', null, 1, 'EA', 100, null, null, 100],
  [null, 'Cellar Level', null, null, null, null, null, null, 0],
  [null, 'Interior Signage', null, null, null, null, null, null, 0],
  [null, 'Elevator Evacuation Map', null, 1, 'EA', 85, null, null, 85],
  [null, 'Elevator Lobby Floor Directory Signage', null, 2, 'EA', 50, null, null, 100],
];

// A tab that is data but not a takeoff (rate catalog): no Qty column.
const catalogTab: SheetRows = [
  ['Item ID', 'Category', 'Sign Type', 'Unit', 'Unit Price', 'Minimum Price'],
  ['fdc-sign', 'Site & Roadway', 'FDC Sign', 'Each', 25, 0],
];

describe('detectColumns', () => {
  it('finds a header row below title rows and maps columns by name', () => {
    const cols = detectColumns(scheduleTab);
    expect(cols).toMatchObject({ headerRow: 5, name: 0, description: 1, qty: 2, priceEach: 3, extended: 4 });
    expect(cols?.costEach).toBeNull();
  });

  it('maps an offset layout with both cost and price columns', () => {
    const cols = detectColumns(estimatingTab);
    expect(cols).toMatchObject({ headerRow: 4, name: 1, description: 2, qty: 3, costEach: 5, priceEach: 7, extended: 8 });
  });

  it('rejects a sheet with no qty column', () => {
    expect(detectColumns(catalogTab)).toBeNull();
  });
});

describe('parseTakeoffRows — schedule tab (sell prices)', () => {
  const parsed = parseTakeoffRows(scheduleTab)!;

  it('parses line rows and skips subtotal/total/tax rows', () => {
    expect(parsed.lines.map((l) => l.name)).toEqual([
      'Building ID',
      'Standpipe / FDC Sign',
      'Apartment Entry Signage',
      'Design & Layout / File Setup',
      'Installation Labor',
    ]);
  });

  it('treats lone Price Each as a final sell price (markup-exempt)', () => {
    expect(parsed.priceBasis).toBe('sell');
    expect(parsed.lines.every((l) => l.markupExempt)).toBe(true);
    expect(parsed.lines[0]).toMatchObject({ qty: 3, unitCents: 10000 });
  });

  it('tracks section headers and classifies service rows', () => {
    expect(parsed.lines[0]!.section).toBe('Exterior & Building Identification');
    expect(parsed.lines[2]!.section).toBe('Interior Signage');
    const byName = Object.fromEntries(parsed.lines.map((l) => [l.name, l.kind]));
    expect(byName['Design & Layout / File Setup']).toBe('DESIGN');
    expect(byName['Installation Labor']).toBe('INSTALL');
    expect(byName['Building ID']).toBe('MATERIAL');
  });

  it('keeps the long description as notes and finds a title', () => {
    expect(parsed.lines[0]!.notes).toContain('dimensional numerals');
    expect(parsed.title).toContain('234 CLARKSON AVENUE');
  });

  it('reports the dropped sales-tax rows', () => {
    expect(parsed.skipped.some((s) => s.includes('Sales Tax'))).toBe(true);
  });
});

describe('parseTakeoffRows — estimating tab (costs)', () => {
  const parsed = parseTakeoffRows(estimatingTab)!;

  it('uses Cost Each and keeps markup applicable', () => {
    expect(parsed.priceBasis).toBe('cost');
    expect(parsed.lines.every((l) => !l.markupExempt)).toBe(true);
    expect(parsed.lines[2]).toMatchObject({ name: 'Elevator Lobby Floor Directory Signage', qty: 2, unitCents: 5000 });
  });

  it('treats label rows as sections even when a totals column shows 0', () => {
    // "Cellar Level" and "Interior Signage" have Price Total = 0 but no
    // qty/unit — they are group labels, not $0 lines.
    expect(parsed.lines.map((l) => l.section)).toEqual([
      'Exterior & Building Identification',
      'Interior Signage',
      'Interior Signage',
    ]);
  });
});

describe('parseTakeoffRows — edge cases', () => {
  it('returns null for a non-takeoff sheet', () => {
    expect(parseTakeoffRows(catalogTab)).toBeNull();
  });

  it('returns null when a header exists but no lines follow', () => {
    expect(parseTakeoffRows([['Name', 'Qty', 'Price Each']])).toBeNull();
  });

  it('parses money given as strings and derives unit price from extended totals', () => {
    const rows: SheetRows = [
      ['Name', 'Qty', 'Price Each', 'Extended Price'],
      ['Banner', '2', '$1,250.50', null],
      ['Decals', 4, null, 100],
      ['Mystery item', 1, null, null],
    ];
    const parsed = parseTakeoffRows(rows)!;
    expect(parsed.lines[0]).toMatchObject({ qty: 2, unitCents: 125050 });
    expect(parsed.lines[1]).toMatchObject({ qty: 4, unitCents: 2500, markupExempt: true });
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.skipped.some((s) => s.includes('Mystery item'))).toBe(true);
  });
});
