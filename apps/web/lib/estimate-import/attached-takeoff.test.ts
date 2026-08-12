import { describe, expect, it } from 'vitest';
import {
  sanitizeAttachedTakeoff,
  selectTakeoffTab,
  takeoffTabToEstimateRows,
  takeoffTabTotalCents,
  type AttachedTakeoffTab,
} from './attached-takeoff';

const tab = (over: Partial<AttachedTakeoffTab>): AttachedTakeoffTab => ({
  sheetName: 'Sheet1',
  title: null,
  lines: [],
  skipped: [],
  priceBasis: 'sell',
  ...over,
});

const line = (name: string, section: string | null, qty = 1, unitCents = 100) => ({
  kind: 'MATERIAL' as const,
  name,
  notes: null,
  section,
  qty,
  unitCents,
  markupExempt: true,
});

describe('sanitizeAttachedTakeoff', () => {
  it('rebuilds a clean payload and drops junk lines', () => {
    const out = sanitizeAttachedTakeoff({
      fileName: 'takeoff.xlsx',
      tabs: [
        {
          sheetName: 'Schedule',
          title: 'Job',
          priceBasis: 'sell',
          skipped: ['tax dropped'],
          lines: [
            { kind: 'MATERIAL', name: 'Sign A', qty: 2, unitCents: 5000, markupExempt: true },
            { kind: 'EVIL', name: 'Sign B', qty: 1, unitCents: 100 },
            { name: '', qty: 1, unitCents: 100 },
            { name: 'NaN qty', qty: 'x', unitCents: 100 },
            { name: 'negative', qty: -2, unitCents: 100 },
          ],
        },
        { sheetName: 'Empty', lines: [] },
      ],
    });
    expect(out).not.toBeNull();
    expect(out!.tabs).toHaveLength(1);
    expect(out!.tabs[0]!.lines.map((l) => l.name)).toEqual(['Sign A', 'Sign B']);
    expect(out!.tabs[0]!.lines[1]!.kind).toBe('MATERIAL');
  });

  it('returns null when nothing importable remains', () => {
    expect(sanitizeAttachedTakeoff(null)).toBeNull();
    expect(sanitizeAttachedTakeoff({ fileName: 'x', tabs: [] })).toBeNull();
    expect(sanitizeAttachedTakeoff({ tabs: [{ sheetName: 'a', lines: [{}] }] })).toBeNull();
  });
});

describe('selectTakeoffTab', () => {
  const takeoff = {
    fileName: 'f.xlsx',
    tabs: [
      tab({ sheetName: 'Signage Schedule', lines: [line('a', null)] }),
      tab({ sheetName: 'Estimating Sheet', lines: [line('a', null), line('b', null)] }),
    ],
  };
  it('prefers the named tab (exact or partial, case-insensitive)', () => {
    expect(selectTakeoffTab(takeoff, 'signage schedule').sheetName).toBe('Signage Schedule');
    expect(selectTakeoffTab(takeoff, 'schedule').sheetName).toBe('Signage Schedule');
  });
  it('defaults to the tab with the most lines', () => {
    expect(selectTakeoffTab(takeoff, null).sheetName).toBe('Estimating Sheet');
    expect(selectTakeoffTab(takeoff, 'no such tab').sheetName).toBe('Estimating Sheet');
  });
});

describe('takeoffTabToEstimateRows', () => {
  it('groups consecutive section runs and leaves singles loose', () => {
    const rows = takeoffTabToEstimateRows(
      tab({
        lines: [
          line('a1', 'Interior'),
          line('a2', 'Interior'),
          line('b1', 'Site'),
          line('c1', 'Interior'), // second Interior run — its own bundle
          line('c2', 'Interior'),
          line('d1', null),
        ],
      })
    );
    expect(rows.map((r) => r.groupKey)).toEqual(['run-0', 'run-0', null, 'run-2', 'run-2', null]);
    expect(rows[0]!.groupLabel).toBe('Interior');
    expect(rows[2]!.groupLabel).toBeNull(); // single-line run stays loose
    expect(rows[3]!.groupKey).not.toBe(rows[0]!.groupKey);
  });

  it('converts qty to milli-units and keeps pricing semantics', () => {
    const rows = takeoffTabToEstimateRows(tab({ lines: [line('a', null, 2.5, 12345)] }));
    expect(rows[0]).toMatchObject({ qtyMilli: 2500, unitCostCents: 12345, markupExempt: true });
  });

  it('totals the tab in cents', () => {
    expect(takeoffTabTotalCents(tab({ lines: [line('a', null, 3, 100), line('b', null, 1, 25)] }))).toBe(325);
  });
});
