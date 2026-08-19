// "Standard Signs" tab parser (Bid Estimator standard-sign catalog).
//
// The tab is OPTIONAL and columns are matched by header name so the owner
// can add columns or reorder without breaking sync. Recognition requires a
// "Sign Key" header (plus "Sign Name" or "Pricing Method"): gviz can hand
// back an unrelated tab for an unknown sheet name, and we must never read
// "Meterial price" rows as signs.
//
// Recommended headers (see docs/ai-context/ESTIMATE_ENGINE.md):
//   Sign Key | Active | Category | Sign Name | QB Item | Customer Description |
//   Width | Height | Unit | Material | Thickness | Construction | Mounting |
//   Tactile | Braille | Illumination | Pricing Method | Pricing Unit |
//   Rate Key | Minimum Charge | Waste Percent | Default Machine | Shop Hours |
//   Design Units | Install Hours | Aliases | Formula Version | Notes

import type { GvizTable } from './gviz';
import type { SheetStandardSign, StandardSignsTabStatus } from './types';

type Cell = { v?: string | number | boolean | null; f?: string } | null;
type Row = { c?: Cell[] };

const HEADER_KEYS = {
  signKey: ['sign key', 'key', 'sign code', 'code'],
  active: ['active'],
  category: ['category'],
  name: ['sign name', 'name', 'sign'],
  qbItem: ['qb item', 'quickbooks item', 'qb'],
  customerDescription: ['customer description', 'description'],
  width: ['width'],
  height: ['height'],
  unit: ['unit', 'units', 'size unit'],
  material: ['material'],
  thickness: ['thickness'],
  construction: ['construction'],
  mounting: ['mounting', 'mount'],
  tactile: ['tactile'],
  braille: ['braille'],
  illumination: ['illumination', 'illuminated'],
  pricingMethod: ['pricing method', 'method'],
  pricingUnit: ['pricing unit', 'price unit', 'billable unit'],
  rateKey: ['rate key', 'rate', 'price key', 'price'],
  minimumCharge: ['minimum charge', 'minimum', 'min charge'],
  wastePercent: ['waste percent', 'waste %', 'waste'],
  defaultMachine: ['default machine', 'machine'],
  shopHours: ['shop hours'],
  designUnits: ['design units', 'design'],
  installHours: ['install hours', 'installation hours', 'install'],
  aliases: ['aliases', 'alias'],
  formulaVersion: ['formula version', 'version'],
  notes: ['notes', 'note'],
} as const;

type HeaderKey = keyof typeof HEADER_KEYS;

function norm(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9%/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cellValue(row: Row, index: number | undefined): string | number | boolean | null {
  if (index === undefined) return null;
  const c = row.c?.[index];
  if (!c) return null;
  return c.v ?? null;
}

function str(row: Row, index: number | undefined): string {
  const v = cellValue(row, index);
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function num(row: Row, index: number | undefined): number | null {
  const v = cellValue(row, index);
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$,%\s"']/g, '').replace(/in(ch(es)?)?$/i, '');
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function bool(row: Row, index: number | undefined): boolean | null {
  const v = cellValue(row, index);
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (!t) return null;
    if (['true', 'yes', 'y', '1', 'x', 'required', 'active'].includes(t)) return true;
    if (['false', 'no', 'n', '0', 'none', 'inactive', 'n/a', 'na'].includes(t)) return false;
  }
  return null;
}

export function normalizeSheetPricingMethod(raw: string): string {
  const t = norm(raw).replace(/\bsquare\s*(foot|feet|ft)\b/, 'sqft').replace(/\bsq\s*ft\b/, 'sqft').replace(/\blinear\s*(foot|feet|ft)\b/, 'linear ft');
  if (!t) return 'PER_SIGN';
  if (/set/.test(t)) return 'PER_SET';
  if (/sqft/.test(t)) return 'PER_SQFT';
  if (/character|letter|char/.test(t)) return 'PER_CHARACTER';
  if (/linear/.test(t)) return 'PER_LINEAR_FT';
  if (/hour|hr/.test(t)) return 'PER_HOUR';
  if (/day/.test(t)) return 'PER_DAY';
  if (/sign|each|ea|unit|fixed|per piece|piece/.test(t)) return 'PER_SIGN';
  return 'PER_SIGN';
}

export function pricingUnitForMethod(method: string): string {
  switch (method) {
    case 'PER_SET':
      return 'SET';
    case 'PER_SQFT':
      return 'SQ_FT';
    case 'PER_CHARACTER':
      return 'CHARACTER';
    case 'PER_LINEAR_FT':
      return 'LINEAR_FT';
    case 'PER_HOUR':
      return 'HOUR';
    case 'PER_DAY':
      return 'DAY';
    default:
      return 'SIGN';
  }
}

/** "$60", "60.00", "60" → cents; anything else → null (it's a Sheet item key). */
export function literalRateCents(rateKey: string): number | null {
  const t = rateKey.trim();
  if (!t) return null;
  if (!/^\$?\s*\d[\d,]*(\.\d{1,4})?$/.test(t)) return null;
  const n = Number(t.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function normalizeSignKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export interface ParsedStandardSignsTab {
  status: StandardSignsTabStatus;
  signs: SheetStandardSign[];
  /** Sign keys that appeared more than once — first row wins. */
  duplicateKeys: string[];
}

function resolveHeader(labels: string[]): Partial<Record<HeaderKey, number>> | null {
  const map: Partial<Record<HeaderKey, number>> = {};
  const normalized = labels.map(norm);
  for (const key of Object.keys(HEADER_KEYS) as HeaderKey[]) {
    for (const candidate of HEADER_KEYS[key]) {
      const idx = normalized.findIndex((l, i) => l === candidate && !Object.values(map).includes(i));
      if (idx >= 0) {
        map[key] = idx;
        break;
      }
    }
  }
  if (map.signKey === undefined) return null;
  if (map.name === undefined && map.pricingMethod === undefined) return null;
  return map;
}

/// Parse the gviz table. Header may arrive as `cols[].label` (gviz detected
/// a header) or as the first data row.
export function parseStandardSignsTable(table: GvizTable): ParsedStandardSignsTab {
  const rows: Row[] = (table.rows ?? []) as Row[];
  const colLabels = (table.cols ?? []).map((c) => c.label ?? '');
  let header = resolveHeader(colLabels);
  let dataRows = rows;
  if (!header && rows.length > 0) {
    const first = rows[0]!;
    const labels = (first.c ?? []).map((c) => String(c?.v ?? ''));
    header = resolveHeader(labels);
    if (header) dataRows = rows.slice(1);
  }
  if (!header) return { status: 'UNRECOGNIZED', signs: [], duplicateKeys: [] };
  const headerOffset = dataRows === rows ? 1 : 2; // 1-based Sheet row of the first data row

  const seen = new Set<string>();
  const duplicateKeys: string[] = [];
  const signs: SheetStandardSign[] = [];
  dataRows.forEach((row, i) => {
    const rawKey = str(row, header!.signKey);
    const name = str(row, header!.name);
    if (!rawKey && !name) return;
    const signKey = normalizeSignKey(rawKey || name);
    if (!signKey) return;
    if (seen.has(signKey)) {
      duplicateKeys.push(signKey);
      return;
    }
    seen.add(signKey);
    const activeCell = bool(row, header!.active);
    const method = normalizeSheetPricingMethod(str(row, header!.pricingMethod));
    const rateKey = str(row, header!.rateKey);
    const unitRaw = str(row, header!.pricingUnit);
    const aliases = str(row, header!.aliases)
      .split(/[;,|\n]/)
      .map((a) => a.trim())
      .filter((a) => a.length > 0)
      .slice(0, 50);
    signs.push({
      signKey,
      active: activeCell ?? true,
      category: str(row, header!.category),
      name: name || rawKey,
      qbItem: str(row, header!.qbItem),
      customerDescription: str(row, header!.customerDescription),
      widthIn: num(row, header!.width),
      heightIn: num(row, header!.height),
      unit: str(row, header!.unit) || 'in',
      material: str(row, header!.material),
      thickness: str(row, header!.thickness),
      construction: str(row, header!.construction),
      mounting: str(row, header!.mounting),
      tactile: bool(row, header!.tactile),
      braille: bool(row, header!.braille),
      illumination: str(row, header!.illumination),
      pricingMethod: method,
      pricingUnit: unitRaw ? pricingUnitForMethod(normalizeSheetPricingMethod(unitRaw)) : pricingUnitForMethod(method),
      rateKey,
      rateCents: literalRateCents(rateKey),
      minimumChargeCents: (() => {
        const n = num(row, header!.minimumCharge);
        return n === null ? null : Math.round(n * 100);
      })(),
      wastePercent: num(row, header!.wastePercent),
      defaultMachine: str(row, header!.defaultMachine),
      shopHours: num(row, header!.shopHours),
      designUnits: num(row, header!.designUnits),
      installHours: num(row, header!.installHours),
      aliases,
      formulaVersion: str(row, header!.formulaVersion),
      notes: str(row, header!.notes),
      sheetRow: i + headerOffset,
    });
  });
  return { status: 'OK', signs, duplicateKeys };
}
