import { POLineKind, POReconciliationLineMatch } from '@bvisible/db';
import { describe, expect, it } from 'vitest';
import {
  buildDeterministicReceiptDrafts,
  classifyPairedLine,
  deriveAggregateStatus,
  withinPriceTolerance,
  withinQtyTolerance,
} from './match';

describe('buildDeterministicReceiptDrafts', () => {
  const po = (
    id: string,
    sortOrder: number,
    norm: string,
  ): import('./match').NormPoLine => ({
    id,
    sortOrder,
    norm,
    qtyMilli: 2000,
    unitCostCents: 100,
    kind: POLineKind.MATERIAL,
  });

  const rc = (
    id: string,
    ms: number,
    norm: string,
    price = 100,
    qty: number | null = 2000,
  ): import('./match').OcrReceiptHistoryRow => ({
    id,
    createdAtMs: ms,
    norm,
    priceCents: price,
    quantityMilli: qty,
  });

  it('pairs 1:1 when counts match per normalized label', () => {
    const drafts = buildDeterministicReceiptDrafts(
      [po('p1', 1, 'ACM WHITE')],
      [rc('h1', 10, 'ACM WHITE')],
    );
    expect(drafts).toEqual([
      { tag: 'paired', poLineId: 'p1', historyId: 'h1', norm: 'ACM WHITE' },
    ]);
  });

  it('marks unmatched PO lines when no receipt shares label', () => {
    const drafts = buildDeterministicReceiptDrafts(
      [po('p1', 1, 'ACM WHITE')],
      [],
    );
    expect(drafts).toEqual([
      { tag: 'unmatched_po', poLineId: 'p1', norm: 'ACM WHITE' },
    ]);
  });

  it('marks unmatched receipt rows when no PO shares label', () => {
    const drafts = buildDeterministicReceiptDrafts(
      [],
      [rc('h1', 10, 'PVC SHEET')],
    );
    expect(drafts).toEqual([
      { tag: 'unmatched_receipt', historyId: 'h1', norm: 'PVC SHEET' },
    ]);
  });

  it('emits ambiguous segments when counts diverge for same label', () => {
    const drafts = buildDeterministicReceiptDrafts(
      [po('p1', 1, 'ACM'), po('p2', 2, 'ACM')],
      [rc('h1', 10, 'ACM')],
    );
    expect(drafts).toContainEqual({
      tag: 'ambiguous_po',
      poLineId: 'p1',
      norm: 'ACM',
    });
    expect(drafts).toContainEqual({
      tag: 'ambiguous_po',
      poLineId: 'p2',
      norm: 'ACM',
    });
    expect(drafts).toContainEqual({
      tag: 'ambiguous_receipt',
      historyId: 'h1',
      norm: 'ACM',
    });
  });

  it('zips deterministically by PO sortOrder and receipt createdAt', () => {
    const drafts = buildDeterministicReceiptDrafts(
      [po('p2', 2, 'X'), po('p1', 1, 'X')],
      [rc('h2', 20, 'X'), rc('h1', 10, 'X')],
    );
    expect(drafts).toEqual([
      { tag: 'paired', poLineId: 'p1', historyId: 'h1', norm: 'X' },
      { tag: 'paired', poLineId: 'p2', historyId: 'h2', norm: 'X' },
    ]);
  });
});

describe('tolerance helpers', () => {
  it('withinPriceTolerance respects absolute floor', () => {
    expect(withinPriceTolerance(100, 160, 100, 50)).toBe(false);
    expect(withinPriceTolerance(100, 149, 100, 50)).toBe(true);
  });

  it('withinQtyTolerance uses minimum milli slack', () => {
    expect(withinQtyTolerance(10_000, 10_500, 0)).toBe(true);
    expect(withinQtyTolerance(10_000, 12_000, 0)).toBe(false);
  });
});

describe('classifyPairedLine', () => {
  it('flags missing receipt qty as qty variance path', () => {
    const r = classifyPairedLine({
      expectedQtyMilli: 1000,
      expectedUnitCostCents: 100,
      observedQtyMilli: null,
      observedUnitPriceCents: 100,
      priceTolBps: 100,
      absolutePriceTolCents: 50,
      qtyTolBps: 100,
    });
    expect(r.match).toBe('QTY_VARIANCE');
    expect(r.missingReceiptQty).toBe(true);
  });

  it('detects price drift beyond tolerance', () => {
    const r = classifyPairedLine({
      expectedQtyMilli: 1000,
      expectedUnitCostCents: 100,
      observedQtyMilli: 1000,
      observedUnitPriceCents: 250,
      priceTolBps: 100,
      absolutePriceTolCents: 50,
      qtyTolBps: 100,
    });
    expect(r.match).toBe('PRICE_VARIANCE');
    expect(r.priceBeyondTolerance).toBe(true);
  });
});

describe('deriveAggregateStatus', () => {
  it('prioritizes review required for ambiguous rows', () => {
    expect(
      deriveAggregateStatus([
        { match: POReconciliationLineMatch.MATCHED },
        { match: POReconciliationLineMatch.AMBIGUOUS_PO_LINE },
      ]),
    ).toBe('REVIEW_REQUIRED');
  });

  it('flags variance before partial unmatched', () => {
    expect(
      deriveAggregateStatus([
        { match: POReconciliationLineMatch.UNMATCHED_PO_LINE },
        { match: POReconciliationLineMatch.PRICE_VARIANCE },
      ]),
    ).toBe('VARIANCE');
  });

  it('requires review when paired qty missing on receipt', () => {
    expect(
      deriveAggregateStatus([
        {
          match: POReconciliationLineMatch.MATCHED,
          missingReceiptQty: true,
        },
      ]),
    ).toBe('REVIEW_REQUIRED');
  });

  it('returns MATCHED when all lines matched', () => {
    expect(
      deriveAggregateStatus([
        { match: POReconciliationLineMatch.MATCHED },
        { match: POReconciliationLineMatch.MATCHED },
      ]),
    ).toBe('MATCHED');
  });
});
