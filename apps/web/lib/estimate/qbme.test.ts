import { describe, expect, it } from 'vitest';
import {
  QBME_ALLOWED_ITEMS,
  buildQbmeExport,
  formatQbmeQty,
  inferQbItem,
  parseQbmeBlock,
  qbItemFromLabel,
  qbItemLabel,
  sanitizeQbmeDescription,
  type QbmeSourceLine,
} from './qbme';

function line(partial: Partial<QbmeSourceLine> & Pick<QbmeSourceLine, 'description'>): QbmeSourceLine {
  return {
    qbItem: null,
    kind: 'MATERIAL',
    sourceKind: null,
    qtyMilli: 1000,
    rateCents: 0,
    totalCents: 0,
    ...partial,
  };
}

describe('buildQbmeExport — line by line', () => {
  it('emits one QBME line per customer line, in order, with empty AMOUNT and a trailing pipe', () => {
    const out = buildQbmeExport([
      line({ qbItem: 'SALES', description: 'Residential Unit ID Signs — 6 × 8-inch tactile acrylic', qtyMilli: 103_000, rateCents: 6000, totalCents: 618_000 }),
      line({ qbItem: 'THREE_D_LETTERING', description: 'Building ID letters — AZURA PHASE 1', qtyMilli: 11_000, rateCents: 5000, totalCents: 55_000 }),
      line({ qbItem: 'DESIGN', kind: 'DESIGN', description: 'Layout and production files', qtyMilli: 12_000, rateCents: 15_000, totalCents: 180_000 }),
      line({ qbItem: 'INSTALLATION', kind: 'INSTALL', description: 'Installation labor', qtyMilli: 4_500, rateCents: 280_000, totalCents: 1_260_000 }),
    ]);

    expect(out.lines).toHaveLength(4);
    expect(out.lines.map((l) => l.item)).toEqual(['Sales', '3D Lettering', 'Design', 'Installation']);
    expect(out.block.startsWith('QB_ESTIMATE_START\n')).toBe(true);
    expect(out.block.endsWith('\nQB_ESTIMATE_END')).toBe(true);

    const parsed = parseQbmeBlock(out.block);
    expect(parsed).not.toBeNull();
    expect(parsed).toHaveLength(4);
    for (const row of parsed!) {
      expect(row.amount).toBe(''); // AMOUNT stays empty
      expect(Number.isFinite(Number(row.qty))).toBe(true);
      expect(Number.isFinite(Number(row.rate))).toBe(true);
      expect((QBME_ALLOWED_ITEMS as readonly string[]).includes(row.item)).toBe(true);
    }
    expect(parsed![0]).toEqual({ item: 'Sales', description: 'Residential Unit ID Signs — 6 × 8-inch tactile acrylic', qty: '103', rate: '60.00', amount: '' });
    expect(parsed![3]!.qty).toBe('4.5');
    expect(parsed![3]!.rate).toBe('2800.00');
    for (const raw of out.block.split('\n').slice(1, -1)) expect(raw.endsWith('|')).toBe(true);
  });

  it('reconciles Σ(QTY × RATE) with the pre-tax subtotal and reports drift instead of hiding it', () => {
    const ok = buildQbmeExport([
      line({ qbItem: 'SALES', description: 'A', qtyMilli: 46_000, rateCents: 5000, totalCents: 230_000 }),
      line({ qbItem: 'SALES', description: 'B', qtyMilli: 10_000, rateCents: 2750, totalCents: 27_500 }),
    ]);
    expect(ok.reconciliation.ok).toBe(true);
    expect(ok.reconciliation.qbmeSubtotalCents).toBe(257_500);
    expect(ok.reconciliation.estimateSubtotalCents).toBe(257_500);

    // A legacy allocated line whose printed total is not qty × rounded rate.
    const drift = buildQbmeExport([
      line({ qbItem: 'SALES', description: 'Legacy', qtyMilli: 3_000, rateCents: 3333, totalCents: 10_000 }),
    ]);
    expect(drift.reconciliation.ok).toBe(false);
    expect(drift.reconciliation.driftCents).toBe(-1);
    expect(drift.reconciliation.lineDrift).toEqual([{ index: 0, description: 'Legacy', driftCents: -1 }]);
    // Visible QTY / RATE are untouched — no silent "fix" on a large line.
    expect(drift.lines[0]!.qty).toBe('3');
    expect(drift.lines[0]!.rate).toBe('33.33');
  });

  it('sanitizes pipes and whitespace in descriptions and never emits customer info, tax, or notes', () => {
    const out = buildQbmeExport([
      line({ qbItem: 'SALES', description: '  Sign | with pipe\nand newline  ', qtyMilli: 1000, rateCents: 100, totalCents: 100 }),
    ]);
    expect(out.lines[0]!.description).toBe('Sign / with pipe and newline');
    const parsed = parseQbmeBlock(out.block)!;
    expect(parsed).toHaveLength(1);
    expect(out.block).not.toMatch(/tax/i);
    expect(out.block.split('\n')).toHaveLength(3);
  });

  it('uses the structured item when present and only infers for legacy lines', () => {
    expect(inferQbItem({ kind: 'MATERIAL', description: 'Vehicle wrap — Chevrolet City Express (Full)', sourceKind: 'VEHICLE_WRAP' })).toBe('WRAPPING');
    expect(inferQbItem({ kind: 'MATERIAL', description: 'Illuminated channel letters, 18" reverse halo-lit' })).toBe('CHANNEL_LETTERS');
    expect(inferQbItem({ kind: 'MATERIAL', description: 'Storefront canopy with graphics' })).toBe('CANOPY');
    expect(inferQbItem({ kind: 'MATERIAL', description: 'Painted PVC dimensional lettering' })).toBe('THREE_D_LETTERING');
    expect(inferQbItem({ kind: 'DESIGN', description: 'Design' })).toBe('DESIGN');
    expect(inferQbItem({ kind: 'INSTALL', description: 'Installation' })).toBe('INSTALLATION');
    expect(inferQbItem({ kind: 'MISC', description: 'Freight to site' })).toBe('SHIPPING');
    expect(inferQbItem({ kind: 'MATERIAL', description: 'Black acrylic sheet' })).toBe('SALES');
    // Structured mapping wins over description sniffing.
    const out = buildQbmeExport([line({ qbItem: 'SALES', description: 'Illuminated channel letters', qtyMilli: 1000, rateCents: 100, totalCents: 100 })]);
    expect(out.lines[0]!.item).toBe('Sales');
  });

  it('only ever emits allowed item names, with exact spelling', () => {
    expect(QBME_ALLOWED_ITEMS).toEqual(['Wrapping', 'Sales', '3D Lettering', 'Design', 'Shipping', 'Installation', 'Channel Letters', 'Canopy']);
    for (const label of QBME_ALLOWED_ITEMS) expect(qbItemLabel(qbItemFromLabel(label)!)).toBe(label);
    expect(qbItemFromLabel('Sales Tax')).toBeNull();
  });

  it('formats quantities as plain numerics', () => {
    expect(formatQbmeQty(103_000)).toBe('103');
    expect(formatQbmeQty(4_500)).toBe('4.5');
    expect(formatQbmeQty(1_250)).toBe('1.25');
    expect(sanitizeQbmeDescription('a'.repeat(400))).toHaveLength(300);
  });
});
