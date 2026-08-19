// Reads .xlsx / .xls / .csv bytes into per-tab cell grids for the bid
// takeoff parser. Server-only (SheetJS). Bounded so a hostile workbook
// cannot blow up memory: tabs, rows and columns are capped.

import * as XLSX from 'xlsx';
import type { CellValue, TakeoffTabInput } from './parse-bid-takeoff';

export const MAX_WORKBOOK_TABS = 12;
export const MAX_ROWS_PER_TAB = 2000;
export const MAX_COLS_PER_ROW = 40;

export function readWorkbookTabs(bytes: Uint8Array | Buffer, filename: string): TakeoffTabInput[] {
  const isCsv = /\.csv$/i.test(filename);
  const wb = XLSX.read(bytes, {
    type: 'buffer',
    raw: !isCsv,
    cellDates: false,
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
    dense: false,
  });
  const out: TakeoffTabInput[] = [];
  for (const sheetName of wb.SheetNames.slice(0, MAX_WORKBOOK_TABS)) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<Array<CellValue>>(ws, { header: 1, raw: true, defval: null, blankrows: true });
    out.push({
      sheetName: isCsv ? 'CSV' : sheetName,
      rows: rows.slice(0, MAX_ROWS_PER_TAB).map((r) => (Array.isArray(r) ? r.slice(0, MAX_COLS_PER_ROW) : [])),
    });
  }
  return out;
}
