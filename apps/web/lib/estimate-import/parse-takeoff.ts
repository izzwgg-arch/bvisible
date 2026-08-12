// Excel takeoff → estimate lines. Employees build signage takeoffs as
// spreadsheets (title rows on top, a header row like
// "Name | Description | Qty | Cost Each | Price Each | …", section rows,
// line rows, subtotal/tax/total rows). This module turns one sheet's raw
// cell grid into clean line items; reading the .xlsx itself happens in
// the browser (SheetJS) so this stays pure and unit-testable.
//
// Pricing semantics (R-EST-05): a "Cost Each" number is a cost — the
// estimate's markup applies. A "Price Each" number with no cost next to
// it is a final sell price — imported markup-exempt so it is never
// marked up again. Subtotals, grand totals, and sales tax rows are
// skipped: the app recomputes totals itself and has no tax concept.

export type CellValue = string | number | boolean | null | undefined;
export type SheetRows = ReadonlyArray<ReadonlyArray<CellValue>>;

export type TakeoffKind = 'MATERIAL' | 'LABOR' | 'DESIGN' | 'INSTALL' | 'MISC';

export interface TakeoffLine {
  kind: TakeoffKind;
  /** Short name — becomes the estimate line description. */
  name: string;
  /** Long description text — becomes the line's notes. */
  notes: string | null;
  section: string | null;
  qty: number;
  unitCents: number;
  /** True when the sheet gave a sell price rather than a cost. */
  markupExempt: boolean;
}

export interface TakeoffParse {
  /** Best guess at a job title from the rows above the header. */
  title: string | null;
  lines: TakeoffLine[];
  /** Human-readable notes about rows that were intentionally ignored. */
  skipped: string[];
  /** What the sheet's unit numbers mean overall (drives the preview copy). */
  priceBasis: 'cost' | 'sell';
}

const MAX_HEADER_SCAN_ROWS = 30;
const MAX_QTY = 1_000_000;
const MAX_UNIT_CENTS = 1_000_000_000;

function cellText(v: CellValue): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function cellNumber(v: CellValue): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$,\s]/g, '');
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normHeader(v: CellValue): string {
  return cellText(v)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface ColumnMap {
  headerRow: number;
  name: number;
  description: number | null;
  qty: number;
  costEach: number | null;
  priceEach: number | null;
  extended: number | null;
}

/// Find the header row and map columns by name, not position, so the
/// import survives layout drift between employees' spreadsheets.
export function detectColumns(rows: SheetRows): ColumnMap | null {
  const scan = Math.min(rows.length, MAX_HEADER_SCAN_ROWS);
  for (let r = 0; r < scan; r += 1) {
    const row = rows[r] ?? [];
    let name: number | null = null;
    let description: number | null = null;
    let qty: number | null = null;
    let costEach: number | null = null;
    let priceEach: number | null = null;
    let extended: number | null = null;
    for (let c = 0; c < row.length; c += 1) {
      const h = normHeader(row[c]);
      if (!h) continue;
      if (name === null && (h === 'name' || h === 'item' || h === 'item name')) name = c;
      else if (description === null && h.startsWith('description')) description = c;
      else if (qty === null && (h === 'qty' || h === 'quantity')) qty = c;
      else if (costEach === null && /(^|\s)cost( each| per unit)?$/.test(h)) costEach = c;
      else if (priceEach === null && (h === 'price each' || h === 'unit price' || h === 'price'))
        priceEach = c;
      else if (extended === null && (h.includes('extended') || h.includes('total'))) extended = c;
    }
    if (name !== null && qty !== null && (costEach !== null || priceEach !== null)) {
      return { headerRow: r, name, description, qty, costEach, priceEach, extended };
    }
  }
  return null;
}

const SKIP_ROW_RE = /^(sub\s*total|grand\s*total|total\b|totals\b|sales\s*tax|tax\b|status\s*legend)/i;
const DESIGN_RE = /^design\b|design\s*&\s*layout|file\s*set\s*-?\s*up|\bartwork\b/i;
const INSTALL_RE = /^install/i;
const LABOR_RE = /^(shop\s*)?labor\b/i;

function classifyKind(name: string): TakeoffKind {
  if (DESIGN_RE.test(name)) return 'DESIGN';
  if (INSTALL_RE.test(name)) return 'INSTALL';
  if (LABOR_RE.test(name)) return 'LABOR';
  return 'MATERIAL';
}

/// Parse one sheet's cell grid. Returns null when no takeoff-shaped
/// header row exists (e.g. a rate-catalog or notes tab).
export function parseTakeoffRows(rows: SheetRows): TakeoffParse | null {
  const cols = detectColumns(rows);
  if (!cols) return null;

  // Title: first non-empty text above the header row.
  let title: string | null = null;
  for (let r = 0; r < cols.headerRow; r += 1) {
    for (const cell of rows[r] ?? []) {
      const t = cellText(cell);
      if (t) {
        title = t.slice(0, 200);
        break;
      }
    }
    if (title) break;
  }

  const lines: TakeoffLine[] = [];
  const skipped: string[] = [];
  let section: string | null = null;
  let sawCost = false;
  let sawSell = false;

  for (let r = cols.headerRow + 1; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    const name = cellText(row[cols.name]);
    const description = cols.description !== null ? cellText(row[cols.description]) : '';
    const qty = cellNumber(row[cols.qty]);
    const cost = cols.costEach !== null ? cellNumber(row[cols.costEach]) : null;
    const sell = cols.priceEach !== null ? cellNumber(row[cols.priceEach]) : null;
    const extended = cols.extended !== null ? cellNumber(row[cols.extended]) : null;

    if (!name) continue; // blank / spacer / total-only rows
    if (SKIP_ROW_RE.test(name)) {
      // Totals are recomputed by the app; tax has no estimate field yet.
      if (/tax/i.test(name) && !/^sub/i.test(name)) {
        skipped.push(`"${name}" — the estimate has no sales-tax field; totals are pre-tax.`);
      }
      continue;
    }

    const hasUnit = cost !== null || sell !== null;
    if (qty === null && !hasUnit) {
      // A bare label row starts a new section.
      section = name;
      continue;
    }

    // Unit price: a cost wins; a lone sell price imports markup-exempt.
    // Last resort: derive the unit from the extended total.
    let unit: number | null = null;
    let markupExempt = false;
    if (cost !== null) {
      unit = cost;
    } else if (sell !== null) {
      unit = sell;
      markupExempt = true;
    } else if (extended !== null && qty !== null && qty > 0) {
      unit = extended / qty;
      markupExempt = true;
    }
    if (unit === null) {
      skipped.push(`"${name}" — no cost or price on the row.`);
      continue;
    }

    const qtyFinal = qty ?? 1;
    if (qtyFinal < 0 || qtyFinal > MAX_QTY || unit < 0) {
      skipped.push(`"${name}" — quantity or price out of range.`);
      continue;
    }
    const unitCents = Math.round(unit * 100);
    if (unitCents > MAX_UNIT_CENTS) {
      skipped.push(`"${name}" — price out of range.`);
      continue;
    }

    if (markupExempt) sawSell = true;
    else sawCost = true;

    lines.push({
      kind: classifyKind(name),
      name: name.slice(0, 400),
      notes: description ? description.slice(0, 2000) : null,
      section,
      qty: qtyFinal,
      unitCents,
      markupExempt,
    });
  }

  if (lines.length === 0) return null;
  return {
    title,
    lines,
    skipped,
    priceBasis: sawCost && !sawSell ? 'cost' : 'sell',
  };
}
