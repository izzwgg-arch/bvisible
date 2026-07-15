// QBME (QuickBooks Manual Estimate) export block. Allocates the
// estimate's FINAL sell price into the allowed QuickBooks item buckets
// using B Visible pricing rules (multiplier on cost-up lines; R-EST-05
// markup-exempt Sheet prices pass through at face value).
//
// Exact format (every line ends with a trailing pipe; AMOUNT stays empty):
//   QB_ESTIMATE_START
//   Line=ITEM|DESCRIPTION|QTY|RATE|
//   QB_ESTIMATE_END

import { roundCents } from '@bvisible/pricing';

export const QBME_ALLOWED_ITEMS = [
  'Wrapping',
  'Sales',
  '3D Lettering',
  'Design',
  'Shipping',
  'Installation',
] as const;

export type QbmeItem = (typeof QBME_ALLOWED_ITEMS)[number];

export interface QbmeLineInput {
  kind: 'MATERIAL' | 'MACHINE' | 'LABOR' | 'DESIGN' | 'INSTALL' | 'MISC';
  description: string;
  computedCostCents: number;
  markupExempt: boolean;
  sourceKind: string | null;
}

export interface QbmeEstimateInput {
  title: string;
  multiplierMilli: number;
  designFlatCents: number;
  finalPriceCents: number;
  lines: QbmeLineInput[];
}

export interface QbmeExportLine {
  item: QbmeItem;
  description: string;
  qty: number;
  rateCents: number;
}

export interface QbmeExport {
  lines: QbmeExportLine[];
  totalCents: number;
  block: string;
}

function sellCents(line: QbmeLineInput, multiplierMilli: number): number {
  if (line.markupExempt) return line.computedCostCents;
  return roundCents((line.computedCostCents * multiplierMilli) / 1000);
}

function bucketFor(line: QbmeLineInput): QbmeItem {
  const desc = line.description.toLowerCase();
  if (line.sourceKind === 'VEHICLE_WRAP' || /vehicle wrap|\bwrap\b/.test(desc)) return 'Wrapping';
  if (/channel letter|3d letter|dimensional letter/.test(desc)) return '3D Lettering';
  if (line.kind === 'DESIGN') return 'Design';
  if (line.kind === 'INSTALL') return 'Installation';
  if (line.kind === 'MISC' && /ship|freight|delivery/.test(desc)) return 'Shipping';
  return 'Sales';
}

function sanitizeDescription(input: string): string {
  // Customer-facing, single line, no pipes (pipe is the field separator).
  return input.replace(/\|/g, '/').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function formatRate(cents: number): string {
  return (cents / 100).toFixed(2);
}

const BUCKET_DESCRIPTIONS: Record<QbmeItem, (title: string) => string> = {
  Wrapping: (t) => `Vehicle wrap — ${t}`,
  Sales: (t) => `${t} — materials, machine production, and shop fabrication`,
  '3D Lettering': (t) => `Dimensional lettering for ${t}`,
  Design: (t) => `Design and production setup for ${t}`,
  Shipping: (t) => `Shipping and delivery for ${t}`,
  Installation: (t) => `Installation and round-trip travel for ${t}`,
};

export function buildQbmeExport(estimate: QbmeEstimateInput): QbmeExport {
  const multiplier = Math.max(0, Math.trunc(estimate.multiplierMilli));
  const buckets = new Map<QbmeItem, number>();

  for (const line of estimate.lines) {
    const bucket = bucketFor(line);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + sellCents(line, multiplier));
  }
  // The per-estimate design flat fee is part of the marked-up base.
  const designFlat = Math.max(0, Math.trunc(estimate.designFlatCents));
  if (designFlat > 0) {
    buckets.set('Design', (buckets.get('Design') ?? 0) + roundCents((designFlat * multiplier) / 1000));
  }

  // Rounding drift vs. the cached final price lands in the largest bucket
  // so the QB total always equals the estimate total.
  const allocated = Array.from(buckets.values()).reduce((s, v) => s + v, 0);
  const drift = estimate.finalPriceCents - allocated;
  if (drift !== 0 && buckets.size > 0) {
    const largest = Array.from(buckets.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (largest) buckets.set(largest, (buckets.get(largest) ?? 0) + drift);
  }

  const title = sanitizeDescription(estimate.title) || 'Custom sign fabrication';
  const lines: QbmeExportLine[] = QBME_ALLOWED_ITEMS.filter(
    (item) => (buckets.get(item) ?? 0) !== 0
  ).map((item) => ({
    item,
    description: sanitizeDescription(BUCKET_DESCRIPTIONS[item](title)),
    qty: 1,
    rateCents: buckets.get(item)!,
  }));

  const body = lines
    .map((l) => `Line=${l.item}|${l.description}|${l.qty}|${formatRate(l.rateCents)}|`)
    .join('\n');
  const block = `QB_ESTIMATE_START\n${body}\nQB_ESTIMATE_END`;
  const totalCents = lines.reduce((s, l) => s + l.rateCents, 0);

  return { lines, totalCents, block };
}
