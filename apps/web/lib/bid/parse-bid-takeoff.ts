// Bid takeoff parser — turns spreadsheet tabs into classified source rows
// and aggregated product candidates. Pure and unit-tested; reading the
// .xlsx / .csv bytes happens in lib/bid/read-workbook.ts.
//
// Differences from lib/estimate-import/parse-takeoff.ts (the classic Excel
// importer, which is left untouched):
//   * price columns are OPTIONAL — a takeoff usually carries only names
//     and quantities; pricing comes from standard-sign rules;
//   * EVERY row is classified and kept (PRODUCT / HEADING / HEADER / BLANK
//     / SUBTOTAL / TAX / TOTAL / NOTE / LEGEND / IGNORED) with its row
//     number, so a line can point back at "Estimating Sheet row 28";
//   * product rows with the same normalized name are aggregated into ONE
//     candidate line (quantities combined across floors / pods) while the
//     contributing rows stay linked.

import type { BidSourceRowKind } from '@bvisible/db';
import { normalizeSignText } from './text-extract';

export type CellValue = string | number | boolean | null | undefined;
export type SheetRows = ReadonlyArray<ReadonlyArray<CellValue>>;

export interface TakeoffTabInput {
  sheetName: string;
  rows: SheetRows;
}

export interface ParsedSourceRow {
  sheetName: string;
  /** 1-based spreadsheet row number. */
  rowNumber: number;
  rowKind: BidSourceRowKind;
  rawItem: string | null;
  rawDescription: string | null;
  rawQtyText: string | null;
  rawQty: number | null;
  rawUnit: string | null;
  rawCostCents: number | null;
  rawPriceCents: number | null;
  rawExtendedCents: number | null;
  sectionHeading: string | null;
  /** DESIGN / INSTALL / SHIPPING rows are products in the sheet but are
   *  handled by dedicated steps; the importer defers them. */
  service: 'DESIGN' | 'INSTALL' | 'SHIPPING' | null;
  /** Why a row was ignored / skipped (import summary copy). */
  note: string | null;
}

export interface ProductCandidate {
  /** Stable key within one import (normalized name). */
  key: string;
  name: string;
  description: string | null;
  qty: number;
  unit: string | null;
  sectionHeading: string | null;
  /** All headings this item appeared under (e.g. "Interior Signage", "Pod B"). */
  sectionHeadings: string[];
  rowNumbers: number[];
  sheetName: string;
  /** Distinct unit costs / prices seen on the contributing rows. */
  costCents: number | null;
  priceCents: number | null;
  priceConflict: boolean;
  extendedCents: number | null;
  service: 'DESIGN' | 'INSTALL' | 'SHIPPING' | null;
}

export interface ParsedTab {
  sheetName: string;
  title: string | null;
  headerRow: number | null;
  columns: ColumnMap | null;
  rows: ParsedSourceRow[];
  products: ProductCandidate[];
  counts: TabCounts;
}

export interface TabCounts {
  rowsRead: number;
  productRows: number;
  productLines: number;
  headings: number;
  headers: number;
  blank: number;
  subtotals: number;
  totals: number;
  tax: number;
  notes: number;
  legends: number;
  ignored: number;
  serviceRows: number;
  takeoffQty: number;
}

export interface ParsedWorkbook {
  tabs: ParsedTab[];
  /** Tab whose product rows drive the estimate (most product rows), or null. */
  primaryTabName: string | null;
}

export interface ColumnMap {
  headerRow: number; // 0-based index into rows
  name: number | null;
  description: number | null;
  qty: number;
  unit: number | null;
  costEach: number | null;
  priceEach: number | null;
  extended: number | null;
  status: number | null;
}

const MAX_HEADER_SCAN_ROWS = 40;
const MAX_QTY = 1_000_000;
const MAX_MONEY_CENTS = 1_000_000_000;

export function cellText(v: CellValue): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return '';
}

export function cellNumber(v: CellValue): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$,\s]/g, '');
    if (!cleaned) return null;
    if (!/^-?\d*\.?\d+%?$/.test(cleaned)) return null;
    const n = Number(cleaned.replace(/%$/, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normHeader(v: CellValue): string {
  return cellText(v)
    .toLowerCase()
    .replace(/[^a-z0-9 /]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NAME_HEADERS = new Set(['name', 'item', 'item name', 'sign', 'sign type', 'sign name', 'type', 'sign id', 'id', 'mark', 'tag', 'symbol']);
const QTY_HEADERS = new Set(['qty', 'quantity', 'count', 'qty.', 'no.', 'number', 'total qty', 'total quantity', 'ea']);
const UNIT_HEADERS = new Set(['unit', 'units', 'uom', 'u/m', 'unit of measure']);
const STATUS_HEADERS = new Set(['status', 'basis / notes', 'basis', 'notes', 'note', 'comments', 'remarks']);

/// Header row + column map. Name/description + qty are enough; price
/// columns are optional (a bid takeoff usually has none).
export function detectBidColumns(rows: SheetRows): ColumnMap | null {
  const scan = Math.min(rows.length, MAX_HEADER_SCAN_ROWS);
  for (let r = 0; r < scan; r += 1) {
    const row = rows[r] ?? [];
    let name: number | null = null;
    let description: number | null = null;
    let qty: number | null = null;
    let unit: number | null = null;
    let costEach: number | null = null;
    let priceEach: number | null = null;
    let extended: number | null = null;
    let status: number | null = null;
    for (let c = 0; c < row.length; c += 1) {
      const h = normHeader(row[c]);
      if (!h) continue;
      if (name === null && NAME_HEADERS.has(h)) name = c;
      else if (description === null && (h.startsWith('description') || h === 'desc' || h === 'scope' || h === 'copy')) description = c;
      else if (qty === null && QTY_HEADERS.has(h)) qty = c;
      else if (unit === null && UNIT_HEADERS.has(h)) unit = c;
      else if (costEach === null && /(^|\s)cost( each| per unit| ea)?$/.test(h)) costEach = c;
      else if (priceEach === null && (h === 'price each' || h === 'unit price' || h === 'price' || h === 'sell' || h === 'sell each' || h === 'rate' || h === 'unit sell')) priceEach = c;
      else if (extended === null && (h.includes('extended') || h.startsWith('total') || h === 'amount' || h === 'price total' || h === 'line total' || h === 'ext')) extended = c;
      else if (status === null && STATUS_HEADERS.has(h)) status = c;
    }
    if (qty !== null && (name !== null || description !== null)) {
      return { headerRow: r, name, description, qty, unit, costEach, priceEach, extended, status };
    }
  }
  return null;
}

const SUBTOTAL_RE = /^(sub\s*-?\s*total|subtotals?)\b/i;
const TOTAL_RE = /^(grand\s*total|total\b|totals\b|total\s+investment|estimated\s+total|project\s+total|sum\b)/i;
const TAX_RE = /^(sales\s*tax|tax\b|tax\s+rate|sales\s+tax\s+rate|vat\b)/i;
const LEGEND_RE = /^(status\s*legend|legend\b|key\s*:)/i;
const NOTE_RE = /^(note|notes|assumption|assumptions|exclusion|exclusions|clarification|prepared by|revised|revision|date\b)/i;
const DESIGN_RE = /^design\b|design\s*(&|and)\s*layout|file\s*set\s*-?\s*up|\bartwork\b|layout\s*(&|and)\s*proof/i;
const INSTALL_RE = /^install/i;
const SHIPPING_RE = /^(shipping|freight|delivery)\b/i;
const HEADING_ONLY_RE = /^(exterior|interior|site|egress|life safety|building|floor|level|pod|wing|phase|zone|area|parking|amenity|amenities|signage|signs|section|division|scope|package|option|alternate|add)\b/i;

function moneyToCents(n: number | null): number | null {
  if (n === null) return null;
  const c = Math.round(n * 100);
  if (c < 0 || c > MAX_MONEY_CENTS) return null;
  return c;
}

function serviceKind(name: string): ParsedSourceRow['service'] {
  if (DESIGN_RE.test(name)) return 'DESIGN';
  if (INSTALL_RE.test(name)) return 'INSTALL';
  if (SHIPPING_RE.test(name)) return 'SHIPPING';
  return null;
}

/// Parse one tab. Every input row is echoed back classified.
export function parseBidTab(input: TakeoffTabInput): ParsedTab {
  const rows = input.rows;
  const cols = detectBidColumns(rows);
  const parsed: ParsedSourceRow[] = [];
  const counts: TabCounts = {
    rowsRead: rows.length,
    productRows: 0,
    productLines: 0,
    headings: 0,
    headers: 0,
    blank: 0,
    subtotals: 0,
    totals: 0,
    tax: 0,
    notes: 0,
    legends: 0,
    ignored: 0,
    serviceRows: 0,
    takeoffQty: 0,
  };

  let title: string | null = null;
  const headerTexts = new Set<string>();
  const headerRowIndex = cols?.headerRow ?? -1;
  if (cols) {
    for (const cell of rows[cols.headerRow] ?? []) {
      const h = normHeader(cell);
      if (h) headerTexts.add(h);
    }
  }

  const push = (row: ParsedSourceRow) => {
    parsed.push(row);
    switch (row.rowKind) {
      case 'PRODUCT':
        counts.productRows += 1;
        if (row.service) counts.serviceRows += 1;
        else counts.takeoffQty += row.rawQty ?? 0;
        break;
      case 'HEADING':
        counts.headings += 1;
        break;
      case 'HEADER':
        counts.headers += 1;
        break;
      case 'BLANK':
        counts.blank += 1;
        break;
      case 'SUBTOTAL':
        counts.subtotals += 1;
        break;
      case 'TOTAL':
        counts.totals += 1;
        break;
      case 'TAX':
        counts.tax += 1;
        break;
      case 'NOTE':
        counts.notes += 1;
        break;
      case 'LEGEND':
        counts.legends += 1;
        break;
      default:
        counts.ignored += 1;
    }
  };

  let sectionHeading: string | null = null;

  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    const rowNumber = r + 1;
    const texts = row.map(cellText);
    const firstText = texts.find((t) => t.length > 0) ?? '';
    const base = {
      sheetName: input.sheetName,
      rowNumber,
      rawItem: null as string | null,
      rawDescription: null as string | null,
      rawQtyText: null as string | null,
      rawQty: null as number | null,
      rawUnit: null as string | null,
      rawCostCents: null as number | null,
      rawPriceCents: null as number | null,
      rawExtendedCents: null as number | null,
      sectionHeading,
      service: null as ParsedSourceRow['service'],
      note: null as string | null,
    };

    if (!firstText) {
      push({ ...base, rowKind: 'BLANK' });
      continue;
    }

    // Rows above the header: title, legends, notes.
    if (!cols || r < headerRowIndex) {
      if (LEGEND_RE.test(firstText)) {
        push({ ...base, rowKind: 'LEGEND', rawItem: firstText });
      } else if (!title && cols) {
        title = firstText.slice(0, 200);
        push({ ...base, rowKind: 'NOTE', rawItem: firstText, note: 'Title row' });
      } else {
        push({ ...base, rowKind: 'NOTE', rawItem: firstText });
      }
      continue;
    }

    if (r === headerRowIndex) {
      push({ ...base, rowKind: 'HEADER', rawItem: firstText });
      continue;
    }

    const nameCell = cols.name !== null ? texts[cols.name] ?? '' : '';
    const descCell = cols.description !== null ? texts[cols.description] ?? '' : '';
    const name = nameCell || descCell;
    const description = nameCell ? descCell : '';
    const qtyRaw = row[cols.qty];
    const qtyText = cellText(qtyRaw);
    const qty = cellNumber(qtyRaw);
    const unit = cols.unit !== null ? texts[cols.unit] || null : null;
    const cost = cols.costEach !== null ? moneyToCents(cellNumber(row[cols.costEach])) : null;
    const price = cols.priceEach !== null ? moneyToCents(cellNumber(row[cols.priceEach])) : null;
    const extended = cols.extended !== null ? moneyToCents(cellNumber(row[cols.extended])) : null;

    // Repeated header row (multi-page prints paste the header again).
    const normalizedCells = texts.map(normHeader).filter(Boolean);
    if (normalizedCells.length >= 2 && normalizedCells.every((t) => headerTexts.has(t))) {
      push({ ...base, rowKind: 'HEADER', rawItem: firstText });
      continue;
    }

    const label = name || firstText;
    if (SUBTOTAL_RE.test(label)) {
      push({ ...base, rowKind: 'SUBTOTAL', rawItem: label, rawExtendedCents: extended, note: 'Subtotal row — totals are recomputed by the estimate.' });
      continue;
    }
    if (TAX_RE.test(label)) {
      push({ ...base, rowKind: 'TAX', rawItem: label, rawExtendedCents: extended, note: 'Tax row — sales tax comes from the company setting, never from the takeoff.' });
      continue;
    }
    if (TOTAL_RE.test(label)) {
      push({ ...base, rowKind: 'TOTAL', rawItem: label, rawExtendedCents: extended, note: 'Total row — totals are recomputed by the estimate.' });
      continue;
    }
    if (LEGEND_RE.test(label)) {
      push({ ...base, rowKind: 'LEGEND', rawItem: label });
      continue;
    }

    const hasQty = qty !== null;
    const hasMoney = cost !== null || price !== null;
    if (!name) {
      // Numbers with no label — e.g. a bare running total in the extended column.
      push({ ...base, rowKind: extended !== null && !hasQty ? 'TOTAL' : 'IGNORED', rawExtendedCents: extended, note: 'No item name on the row.' });
      continue;
    }

    if (!hasQty && !hasMoney) {
      if (NOTE_RE.test(label) && !HEADING_ONLY_RE.test(label)) {
        push({ ...base, rowKind: 'NOTE', rawItem: label, rawDescription: description || null });
        continue;
      }
      // A label with no quantity and no price is an organizational heading
      // (building, floor, pod, category). Zero-only extended columns count.
      sectionHeading = label.slice(0, 200);
      push({ ...base, rowKind: 'HEADING', rawItem: label, sectionHeading });
      continue;
    }

    if (!hasQty) {
      // Money but no quantity → probably a lump-sum row; keep for review.
      push({
        ...base,
        rowKind: 'IGNORED',
        rawItem: label,
        rawDescription: description || null,
        rawCostCents: cost,
        rawPriceCents: price,
        rawExtendedCents: extended,
        note: 'Priced row with no quantity — not imported as a sign line.',
      });
      continue;
    }

    if (qty! < 0 || qty! > MAX_QTY) {
      push({ ...base, rowKind: 'IGNORED', rawItem: label, rawQtyText: qtyText, note: 'Quantity out of range.' });
      continue;
    }

    push({
      ...base,
      rowKind: 'PRODUCT',
      rawItem: label.slice(0, 400),
      rawDescription: description ? description.slice(0, 4000) : null,
      rawQtyText: qtyText || null,
      rawQty: qty,
      rawUnit: unit ? unit.slice(0, 40) : null,
      rawCostCents: cost,
      rawPriceCents: price,
      rawExtendedCents: extended,
      service: serviceKind(label),
    });
  }

  const products = aggregateProducts(input.sheetName, parsed);
  counts.productLines = products.filter((p) => !p.service).length;

  return { sheetName: input.sheetName, title, headerRow: cols ? cols.headerRow + 1 : null, columns: cols, rows: parsed, products, counts };
}

/// Combine PRODUCT rows with the same normalized name into one candidate.
export function aggregateProducts(sheetName: string, rows: ReadonlyArray<ParsedSourceRow>): ProductCandidate[] {
  const byKey = new Map<string, ProductCandidate>();
  const costs = new Map<string, Set<number>>();
  const prices = new Map<string, Set<number>>();
  for (const row of rows) {
    if (row.rowKind !== 'PRODUCT' || !row.rawItem) continue;
    const key = normalizeSignText(row.rawItem);
    if (!key) continue;
    const qty = row.rawQty ?? 0;
    let cand = byKey.get(key);
    if (!cand) {
      cand = {
        key,
        name: row.rawItem,
        description: row.rawDescription,
        qty: 0,
        unit: row.rawUnit,
        sectionHeading: row.sectionHeading,
        sectionHeadings: [],
        rowNumbers: [],
        sheetName,
        costCents: null,
        priceCents: null,
        priceConflict: false,
        extendedCents: null,
        service: row.service,
      };
      byKey.set(key, cand);
      costs.set(key, new Set());
      prices.set(key, new Set());
    }
    cand.qty += qty;
    cand.rowNumbers.push(row.rowNumber);
    if (!cand.description && row.rawDescription) cand.description = row.rawDescription;
    if (!cand.unit && row.rawUnit) cand.unit = row.rawUnit;
    if (row.sectionHeading && !cand.sectionHeadings.includes(row.sectionHeading)) cand.sectionHeadings.push(row.sectionHeading);
    if (row.rawCostCents !== null) costs.get(key)!.add(row.rawCostCents);
    if (row.rawPriceCents !== null) prices.get(key)!.add(row.rawPriceCents);
    if (row.rawExtendedCents !== null) cand.extendedCents = (cand.extendedCents ?? 0) + row.rawExtendedCents;
  }
  for (const [key, cand] of byKey) {
    const c = costs.get(key)!;
    const p = prices.get(key)!;
    cand.costCents = c.size === 1 ? [...c][0]! : null;
    cand.priceCents = p.size === 1 ? [...p][0]! : null;
    cand.priceConflict = c.size > 1 || p.size > 1;
    cand.qty = Math.round(cand.qty * 1000) / 1000;
  }
  return [...byKey.values()];
}

/// Parse every tab; the tab with the most (non-service) product rows drives
/// the estimate. Other tabs are still returned with their rows so the
/// operator can pick a different one.
export function parseBidWorkbook(tabs: ReadonlyArray<TakeoffTabInput>): ParsedWorkbook {
  const parsedTabs = tabs.map(parseBidTab);
  // The most DETAILED tab wins: more product rows means the per-floor /
  // per-pod takeoff rather than a summary of the same sign types.
  const score = (tab: ParsedTab) => tab.counts.productRows - tab.counts.serviceRows;
  let primary: ParsedTab | null = null;
  for (const tab of parsedTabs) {
    if (!tab.columns || tab.products.filter((p) => !p.service).length === 0) continue;
    if (!primary || score(tab) > score(primary) || (score(tab) === score(primary) && tab.counts.takeoffQty > primary.counts.takeoffQty)) {
      primary = tab;
    }
  }
  return { tabs: parsedTabs, primaryTabName: primary?.sheetName ?? null };
}

export function summarizeRowRef(sheetName: string, rowNumbers: ReadonlyArray<number>): string {
  const sorted = [...rowNumbers].sort((a, b) => a - b);
  if (sorted.length === 0) return sheetName;
  if (sorted.length === 1) return `${sheetName} row ${sorted[0]}`;
  if (sorted.length <= 4) return `${sheetName} rows ${sorted.join(', ')}`;
  return `${sheetName} rows ${sorted.slice(0, 3).join(', ')} +${sorted.length - 3} more`;
}
