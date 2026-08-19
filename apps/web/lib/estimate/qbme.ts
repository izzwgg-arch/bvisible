// QBME (QuickBooks Magic Estimator) export block.
//
// The block mirrors the CUSTOMER estimate line by line: one QBME line per
// customer-facing estimate line, same order, same description, numeric
// QTY, per-unit RATE, and an EMPTY AMOUNT (QuickBooks multiplies). Nothing
// is bucketed or aggregated — a 16-line estimate produces 16 QBME lines.
//
// Exact format (every line ends with a trailing pipe; AMOUNT stays empty):
//   QB_ESTIMATE_START
//   Line=ITEM|DESCRIPTION|QTY|RATE|
//   QB_ESTIMATE_END
//
// ITEM comes from the structured EstimateLineItem.qbItem when the line
// has one (Bid Estimator lines always do). Legacy grid lines without a
// stored item fall back to `inferQbItem` (kind + description heuristics),
// exactly the routing the old bucketed exporter used.

import type { QbItem } from '@bvisible/db';

/** Display strings — exact capitalization and spelling QuickBooks expects. */
export const QBME_ALLOWED_ITEMS = [
  'Wrapping',
  'Sales',
  '3D Lettering',
  'Design',
  'Shipping',
  'Installation',
  'Channel Letters',
  'Canopy',
] as const;

export type QbmeItemLabel = (typeof QBME_ALLOWED_ITEMS)[number];

const QB_ITEM_LABEL: Record<QbItem, QbmeItemLabel> = {
  WRAPPING: 'Wrapping',
  SALES: 'Sales',
  THREE_D_LETTERING: '3D Lettering',
  DESIGN: 'Design',
  SHIPPING: 'Shipping',
  INSTALLATION: 'Installation',
  CHANNEL_LETTERS: 'Channel Letters',
  CANOPY: 'Canopy',
};

const QB_ITEM_BY_LABEL: Record<QbmeItemLabel, QbItem> = {
  Wrapping: 'WRAPPING',
  Sales: 'SALES',
  '3D Lettering': 'THREE_D_LETTERING',
  Design: 'DESIGN',
  Shipping: 'SHIPPING',
  Installation: 'INSTALLATION',
  'Channel Letters': 'CHANNEL_LETTERS',
  Canopy: 'CANOPY',
};

export const QB_ITEM_VALUES = Object.keys(QB_ITEM_LABEL) as QbItem[];

export function qbItemLabel(item: QbItem): QbmeItemLabel {
  return QB_ITEM_LABEL[item];
}

export function qbItemFromLabel(label: string): QbItem | null {
  return (QB_ITEM_BY_LABEL as Record<string, QbItem | undefined>)[label] ?? null;
}

export function isQbItem(value: unknown): value is QbItem {
  return typeof value === 'string' && value in QB_ITEM_LABEL;
}

export interface InferQbItemInput {
  kind: 'MATERIAL' | 'MACHINE' | 'LABOR' | 'DESIGN' | 'INSTALL' | 'MISC';
  description: string;
  sourceKind?: string | null;
}

/**
 * Deterministic fallback mapping for lines that were authored before
 * `qbItem` existed. Structured mapping (line.qbItem) always wins — this is
 * only consulted when it is null.
 */
export function inferQbItem(line: InferQbItemInput): QbItem {
  const desc = line.description.toLowerCase();
  if (line.sourceKind === 'VEHICLE_WRAP' || /vehicle wrap|\bwrap(ped|ping)?\b/.test(desc)) {
    return 'WRAPPING';
  }
  if (/channel letter|halo[- ]?lit|reverse[- ]?lit|face[- ]?lit|illuminated letter/.test(desc)) {
    return 'CHANNEL_LETTERS';
  }
  if (/\bcanop(y|ies)\b|\bawning/.test(desc)) return 'CANOPY';
  if (/3d letter|dimensional letter|dimensional lettering|3-d letter/.test(desc)) {
    return 'THREE_D_LETTERING';
  }
  if (line.kind === 'DESIGN') return 'DESIGN';
  if (line.kind === 'INSTALL') return 'INSTALLATION';
  if (line.kind === 'MISC' && /ship|freight|delivery/.test(desc)) return 'SHIPPING';
  return 'SALES';
}

/** Customer-facing, single line, no pipes (pipe is the field separator). */
export function sanitizeQbmeDescription(input: string): string {
  return input
    .replace(/\|/g, '/')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** QTY as QuickBooks expects — plain number, no trailing zeros ("103", "4.5"). */
export function formatQbmeQty(qtyMilli: number): string {
  const q = Math.max(0, Math.trunc(qtyMilli)) / 1000;
  return String(Number(q.toFixed(3)));
}

/** RATE with two decimals ("60.00"). */
export function formatQbmeRate(rateCents: number): string {
  return (Math.trunc(rateCents) / 100).toFixed(2);
}

export interface QbmeSourceLine {
  /** Structured item when the line stores one; null → inferred. */
  qbItem: QbItem | null;
  kind: InferQbItemInput['kind'];
  sourceKind?: string | null;
  /** Customer-facing description (customerDescription ?? description). */
  description: string;
  qtyMilli: number;
  /** Per-unit customer selling rate in cents. */
  rateCents: number;
  /** Line total as printed on the customer estimate, in cents. */
  totalCents: number;
}

export interface QbmeExportLine {
  item: QbmeItemLabel;
  qbItem: QbItem;
  description: string;
  qty: string;
  rate: string;
  qtyMilli: number;
  rateCents: number;
  /** QTY × RATE as QuickBooks will compute it (cents, rounded). */
  amountCents: number;
  /** Customer-estimate line total this QBME line mirrors. */
  estimateTotalCents: number;
}

export interface QbmeReconciliation {
  /** Σ(QTY × RATE) over all QBME lines. */
  qbmeSubtotalCents: number;
  /** Customer estimate pre-tax subtotal (Σ line totals). */
  estimateSubtotalCents: number;
  driftCents: number;
  /** True when the two subtotals agree to the cent. */
  ok: boolean;
  /** Lines whose QTY × RATE differs from the printed line total. */
  lineDrift: Array<{ index: number; description: string; driftCents: number }>;
}

export interface QbmeExport {
  lines: QbmeExportLine[];
  block: string;
  reconciliation: QbmeReconciliation;
}

export function buildQbmeLine(src: QbmeSourceLine): QbmeExportLine {
  const qbItem = src.qbItem ?? inferQbItem(src);
  const qtyMilli = Math.max(0, Math.trunc(src.qtyMilli));
  const rateCents = Math.max(0, Math.trunc(src.rateCents));
  const amountCents = Math.round((qtyMilli * rateCents) / 1000);
  return {
    item: qbItemLabel(qbItem),
    qbItem,
    description: sanitizeQbmeDescription(src.description) || 'Estimate line',
    qty: formatQbmeQty(qtyMilli),
    rate: formatQbmeRate(rateCents),
    qtyMilli,
    rateCents,
    amountCents,
    estimateTotalCents: Math.trunc(src.totalCents),
  };
}

export function serializeQbmeBlock(lines: ReadonlyArray<Pick<QbmeExportLine, 'item' | 'description' | 'qty' | 'rate'>>): string {
  const body = lines.map((l) => `Line=${l.item}|${l.description}|${l.qty}|${l.rate}|`);
  return ['QB_ESTIMATE_START', ...body, 'QB_ESTIMATE_END'].join('\n');
}

/**
 * Deterministic reconciliation. We never "fix" a drift by silently
 * rewriting one line: the visible QTY and RATE must equal what the
 * customer estimate prints. Any cent-level difference (possible only for
 * legacy proportional-allocation estimates with fractional quantities) is
 * reported so the operator sees it before pasting into QuickBooks.
 */
export function reconcileQbme(lines: ReadonlyArray<QbmeExportLine>): QbmeReconciliation {
  const qbmeSubtotalCents = lines.reduce((s, l) => s + l.amountCents, 0);
  const estimateSubtotalCents = lines.reduce((s, l) => s + l.estimateTotalCents, 0);
  const lineDrift = lines
    .map((l, index) => ({ index, description: l.description, driftCents: l.amountCents - l.estimateTotalCents }))
    .filter((d) => d.driftCents !== 0);
  const driftCents = qbmeSubtotalCents - estimateSubtotalCents;
  return { qbmeSubtotalCents, estimateSubtotalCents, driftCents, ok: driftCents === 0 && lineDrift.length === 0, lineDrift };
}

/** One QBME line per customer estimate line, in the same order. */
export function buildQbmeExport(lines: ReadonlyArray<QbmeSourceLine>): QbmeExport {
  const out = lines.map(buildQbmeLine);
  return { lines: out, block: serializeQbmeBlock(out), reconciliation: reconcileQbme(out) };
}

/** Parse a block back into fields — used by tests and the copy/download proof. */
export function parseQbmeBlock(block: string): Array<{ item: string; description: string; qty: string; rate: string; amount: string }> | null {
  const rows = block.split('\n');
  if (rows[0] !== 'QB_ESTIMATE_START' || rows[rows.length - 1] !== 'QB_ESTIMATE_END') return null;
  const out: Array<{ item: string; description: string; qty: string; rate: string; amount: string }> = [];
  for (const row of rows.slice(1, -1)) {
    if (!row.startsWith('Line=')) return null;
    const fields = row.slice('Line='.length).split('|');
    if (fields.length !== 5) return null;
    out.push({ item: fields[0]!, description: fields[1]!, qty: fields[2]!, rate: fields[3]!, amount: fields[4]! });
  }
  return out;
}
