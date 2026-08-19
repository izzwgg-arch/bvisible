import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { detectBidColumns, parseBidTab, parseBidWorkbook, summarizeRowRef, type SheetRows } from './parse-bid-takeoff';
import { readWorkbookTabs } from './read-workbook';

const H = ['Name', 'Description', 'Qty', 'Units', 'Cost Each', 'Markup %', 'Price Each', 'Price Total'];

const estimatingTab: SheetRows = [
  ['AZURA PHASE 1', null, null, null, null, null, null, null],
  ['23 Main Street, Holmdel, NJ', null, null, null, null, null, null, null],
  ['SIGNAGE QUANTITY TAKEOFF', null, null, null, null, null, null, null],
  ['Status Legend:', null, null, null, null, null, null, null],
  H,
  ['Building A', null, null, null, null, null, null, 0],
  ['Interior Signage', null, null, null, null, null, null, 0],
  ['Residential Unit ID Sign', '6" x 8" tactile acrylic with Braille', 40, 'EA', null, null, null, null],
  ['Reserved EV Charging Sign', '12" x 18" reflective aluminum', 20, 'EA', null, null, null, null],
  ['Second Floor', null, null, null, null, null, null, null],
  ['Residential Unit ID Sign', null, 63, 'EA', null, null, null, null],
  ['Reserved EV Charging Sign', null, 26, 'EA', null, null, null, null],
  H, // repeated header (printed page break)
  ['Pod B', null, null, null, null, null, null, null],
  ['Building ID', 'Exterior building ID reading "AZURA PHASE 1", 1/2" acrylic letters 7"–12" high, stud mounted', 1, 'SET', null, null, null, null],
  ['Subtotal — Interior Signage', null, null, null, null, null, null, 12345],
  [null, null, null, null, null, null, null, null],
  ['Design & Layout / File Setup', 'Project file setup', 1, 'EA', 800, null, null, 800],
  ['Installation Labor', 'Installation labor priced per crew-hour', 2, 'DAY', 2800, null, null, 5600],
  ['Sales Tax Rate', null, null, null, null, null, null, 0.08875],
  ['Sales Tax', null, null, null, null, null, null, 3010.84],
  ['TOTAL INVESTMENT', null, null, null, null, null, null, 36935.84],
];

describe('detectBidColumns', () => {
  it('finds a header with only name + qty (prices optional)', () => {
    const cols = detectBidColumns([['Job'], ['Sign Type', 'Qty', 'Notes'], ['Unit ID', 3, '']]);
    expect(cols).toMatchObject({ headerRow: 1, name: 0, qty: 1, costEach: null, priceEach: null });
  });
  it('accepts a description-only layout and maps price / extended columns by name', () => {
    const cols = detectBidColumns([['Description', 'Quantity', 'Unit Price', 'Amount']]);
    expect(cols).toMatchObject({ name: null, description: 0, qty: 1, priceEach: 2, extended: 3 });
  });
  it('rejects tabs without a quantity column (rate catalogs, notes)', () => {
    expect(detectBidColumns([['Item ID', 'Category', 'Unit Price']])).toBeNull();
  });
});

describe('parseBidTab', () => {
  const tab = parseBidTab({ sheetName: 'Estimating Sheet', rows: estimatingTab });

  it('classifies every row and keeps row numbers', () => {
    expect(tab.rows).toHaveLength(estimatingTab.length);
    expect(tab.headerRow).toBe(5);
    const kinds = tab.rows.map((r) => `${r.rowNumber}:${r.rowKind}`);
    expect(kinds).toEqual([
      '1:NOTE', '2:NOTE', '3:NOTE', '4:LEGEND', '5:HEADER',
      '6:HEADING', '7:HEADING', '8:PRODUCT', '9:PRODUCT', '10:HEADING', '11:PRODUCT', '12:PRODUCT',
      '13:HEADER', '14:HEADING', '15:PRODUCT', '16:SUBTOTAL', '17:BLANK', '18:PRODUCT', '19:PRODUCT',
      '20:TAX', '21:TAX', '22:TOTAL',
    ]);
    expect(tab.title).toBe('AZURA PHASE 1');
  });

  it('never turns headings, subtotals, tax or totals into products', () => {
    const products = tab.rows.filter((r) => r.rowKind === 'PRODUCT').map((r) => r.rawItem);
    expect(products).not.toContain('Building A');
    expect(products).not.toContain('Interior Signage');
    expect(products).not.toContain('Subtotal — Interior Signage');
    expect(products).not.toContain('Sales Tax');
    expect(products).not.toContain('TOTAL INVESTMENT');
    expect(tab.counts.headings).toBe(4);
    expect(tab.counts.headers).toBe(2);
    expect(tab.counts.subtotals).toBe(1);
    expect(tab.counts.tax).toBe(2);
    expect(tab.counts.totals).toBe(1);
  });

  it('tracks the section heading for each product row', () => {
    const unitId = tab.rows.filter((r) => r.rawItem === 'Residential Unit ID Sign');
    expect(unitId.map((r) => r.sectionHeading)).toEqual(['Interior Signage', 'Second Floor']);
  });

  it('aggregates repeated sign types across floors into one candidate and keeps every source row', () => {
    const unit = tab.products.find((p) => p.name === 'Residential Unit ID Sign')!;
    expect(unit.qty).toBe(103);
    expect(unit.rowNumbers).toEqual([8, 11]);
    expect(unit.description).toBe('6" x 8" tactile acrylic with Braille');
    expect(unit.sectionHeadings).toEqual(['Interior Signage', 'Second Floor']);
    const ev = tab.products.find((p) => p.name === 'Reserved EV Charging Sign')!;
    expect(ev.qty).toBe(46);
    expect(tab.counts.takeoffQty).toBe(103 + 46 + 1);
    expect(summarizeRowRef('Estimating Sheet', unit.rowNumbers)).toBe('Estimating Sheet rows 8, 11');
  });

  it('flags design / installation rows as services deferred to their own steps', () => {
    const design = tab.products.find((p) => p.service === 'DESIGN')!;
    const install = tab.products.find((p) => p.service === 'INSTALL')!;
    expect(design.name).toBe('Design & Layout / File Setup');
    expect(design.costCents).toBe(80000);
    expect(install.qty).toBe(2);
    expect(tab.counts.serviceRows).toBe(2);
    expect(tab.counts.productLines).toBe(3);
  });

  it('retains source cost / price / extended values without inventing any', () => {
    const buildingId = tab.products.find((p) => p.name === 'Building ID')!;
    expect(buildingId.costCents).toBeNull();
    expect(buildingId.priceCents).toBeNull();
    expect(buildingId.unit).toBe('SET');
  });

  it('parses money given as strings and records price conflicts', () => {
    const rows: SheetRows = [
      ['Name', 'Qty', 'Price Each', 'Extended'],
      ['Sign A', 2, '$50.00', '$100.00'],
      ['Sign A', 3, '55', 165],
      ['Sign B', '4', '$1,200.50', '$4,802.00'],
      ['Sign C', 'n/a', 10, null],
    ];
    const t = parseBidTab({ sheetName: 'S', rows });
    const a = t.products.find((p) => p.name === 'Sign A')!;
    expect(a.qty).toBe(5);
    expect(a.priceCents).toBeNull();
    expect(a.priceConflict).toBe(true);
    const b = t.products.find((p) => p.name === 'Sign B')!;
    expect(b.priceCents).toBe(120050);
    expect(b.extendedCents).toBe(480200);
    // "n/a" quantity with a price is not a product line.
    expect(t.rows[4]!.rowKind).toBe('IGNORED');
  });

  it('returns no columns for an unsupported tab but still echoes rows as notes', () => {
    const t = parseBidTab({ sheetName: 'Rate Catalog', rows: [['Item ID', 'Unit Price'], ['x', 5]] });
    expect(t.columns).toBeNull();
    expect(t.products).toHaveLength(0);
    expect(t.rows.map((r) => r.rowKind)).toEqual(['NOTE', 'NOTE']);
  });
});

describe('parseBidWorkbook', () => {
  it('picks the tab with the most product rows as primary and keeps the others', () => {
    const wb = parseBidWorkbook([
      { sheetName: 'Rate Catalog', rows: [['Item ID', 'Unit Price'], ['x', 5]] },
      { sheetName: 'Summary', rows: [['Name', 'Qty', 'Price Each'], ['Unit ID', 103, 60], ['EV', 46, 50]] },
      { sheetName: 'Estimating Sheet', rows: estimatingTab },
    ]);
    expect(wb.primaryTabName).toBe('Estimating Sheet');
    expect(wb.tabs.map((t) => t.sheetName)).toEqual(['Rate Catalog', 'Summary', 'Estimating Sheet']);
  });

  it('parses the real 234 Clarkson fixture workbook end to end', () => {
    const file = path.join(process.cwd(), 'smoke/fixtures/takeoff-234-clark.xlsx');
    const tabs = readWorkbookTabs(readFileSync(file), 'takeoff-234-clark.xlsx');
    const wb = parseBidWorkbook(tabs);
    expect(wb.primaryTabName).toBe('Estimating Sheet');
    const est = wb.tabs.find((t) => t.sheetName === 'Estimating Sheet')!;
    const apt = est.products.find((p) => p.name === 'Apartment Entry Signage')!;
    expect(apt.qty).toBe(98); // combined across floors
    expect(apt.rowNumbers.length).toBeGreaterThan(5);
    expect(est.counts.headings).toBeGreaterThan(10);
    // No heading became a product.
    expect(est.products.map((p) => p.name)).not.toContain('Interior Signage');
    expect(est.products.map((p) => p.name)).not.toContain('2nd Floor');
    const schedule = wb.tabs.find((t) => t.sheetName === 'Signage Schedule')!;
    expect(schedule.counts.subtotals).toBe(4);
    expect(schedule.counts.tax).toBe(2);
    expect(schedule.counts.totals).toBeGreaterThanOrEqual(2);
    expect(schedule.counts.legends).toBe(1);
  });
});
