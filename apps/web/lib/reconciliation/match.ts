import type { POLineKind } from '@prisma/client';

export interface NormPoLine {
  id: string;
  sortOrder: number;
  norm: string;
  qtyMilli: number;
  unitCostCents: number;
  kind: POLineKind;
}

export interface OcrReceiptHistoryRow {
  id: string;
  createdAtMs: number;
  norm: string;
  priceCents: number;
  quantityMilli: number | null;
}

export type DraftSegment =
  | {
      tag: 'paired';
      poLineId: string;
      historyId: string;
      norm: string;
    }
  | { tag: 'unmatched_po'; poLineId: string; norm: string }
  | { tag: 'unmatched_receipt'; historyId: string; norm: string }
  | { tag: 'ambiguous_po'; poLineId: string; norm: string }
  | { tag: 'ambiguous_receipt'; historyId: string; norm: string };

/**
 * Deterministic pairing by normalized item label within the PO / receipts batch.
 * Unequal counts per label → ambiguous segments (human review).
 */
export function buildDeterministicReceiptDrafts(
  poLines: NormPoLine[],
  receipts: OcrReceiptHistoryRow[],
): DraftSegment[] {
  const poByNorm = new Map<string, NormPoLine[]>();
  for (const pl of poLines) {
    const list = poByNorm.get(pl.norm) ?? [];
    list.push(pl);
    poByNorm.set(pl.norm, list);
  }
  for (const [, list] of poByNorm) {
    list.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  const rcByNorm = new Map<string, OcrReceiptHistoryRow[]>();
  for (const r of receipts) {
    const list = rcByNorm.get(r.norm) ?? [];
    list.push(r);
    rcByNorm.set(r.norm, list);
  }
  for (const [, list] of rcByNorm) {
    list.sort(
      (a, b) =>
        a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id),
    );
  }

  const norms = new Set<string>();
  for (const k of poByNorm.keys()) norms.add(k);
  for (const k of rcByNorm.keys()) norms.add(k);

  const out: DraftSegment[] = [];

  for (const norm of [...norms].sort()) {
    const poList = poByNorm.get(norm) ?? [];
    const rcList = rcByNorm.get(norm) ?? [];

    if (poList.length === rcList.length && poList.length > 0) {
      for (let i = 0; i < poList.length; i++) {
        const pl = poList[i]!;
        const rc = rcList[i]!;
        out.push({
          tag: 'paired',
          poLineId: pl.id,
          historyId: rc.id,
          norm,
        });
      }
      continue;
    }

    if (poList.length === 0 && rcList.length > 0) {
      for (const r of rcList) {
        out.push({ tag: 'unmatched_receipt', historyId: r.id, norm });
      }
      continue;
    }

    if (poList.length > 0 && rcList.length === 0) {
      for (const p of poList) {
        out.push({ tag: 'unmatched_po', poLineId: p.id, norm });
      }
      continue;
    }

    for (const p of poList) {
      out.push({ tag: 'ambiguous_po', poLineId: p.id, norm });
    }
    for (const r of rcList) {
      out.push({ tag: 'ambiguous_receipt', historyId: r.id, norm });
    }
  }

  return out;
}

export function withinPriceTolerance(
  expectedCents: number,
  observedCents: number,
  tolBps: number,
  absoluteTolCents: number,
): boolean {
  const delta = Math.abs(observedCents - expectedCents);
  const scaled =
    expectedCents <= 0
      ? absoluteTolCents
      : Math.max(
          absoluteTolCents,
          Math.floor((Math.abs(expectedCents) * tolBps) / 10000),
        );
  return delta <= scaled;
}

export function withinQtyTolerance(
  expectedMilli: number,
  observedMilli: number,
  tolBps: number,
): boolean {
  const delta = Math.abs(observedMilli - expectedMilli);
  const scaled = Math.max(
    1000,
    Math.floor((Math.abs(expectedMilli) * tolBps) / 10000),
  );
  return delta <= scaled;
}

export function classifyPairedLine(args: {
  expectedQtyMilli: number;
  expectedUnitCostCents: number;
  observedQtyMilli: number | null;
  observedUnitPriceCents: number;
  priceTolBps: number;
  absolutePriceTolCents: number;
  qtyTolBps: number;
}): {
  match:
    | 'MATCHED'
    | 'PRICE_VARIANCE'
    | 'QTY_VARIANCE'
    | 'PRICE_AND_QTY_VARIANCE';
  priceVarianceCents: number;
  qtyVarianceMilli: number | null;
  missingReceiptQty: boolean;
  priceBeyondTolerance: boolean;
  qtyBeyondTolerance: boolean;
} {
  const priceVarianceCents =
    args.observedUnitPriceCents - args.expectedUnitCostCents;
  const missingReceiptQty = args.observedQtyMilli === null;
  const qtyVarianceMilli =
    args.observedQtyMilli === null
      ? null
      : args.observedQtyMilli - args.expectedQtyMilli;

  const priceBeyondTolerance = !withinPriceTolerance(
    args.expectedUnitCostCents,
    args.observedUnitPriceCents,
    args.priceTolBps,
    args.absolutePriceTolCents,
  );

  const qtyBeyondTolerance =
    args.observedQtyMilli !== null &&
    !withinQtyTolerance(
      args.expectedQtyMilli,
      args.observedQtyMilli,
      args.qtyTolBps,
    );

  let match:
    | 'MATCHED'
    | 'PRICE_VARIANCE'
    | 'QTY_VARIANCE'
    | 'PRICE_AND_QTY_VARIANCE';
  if (!priceBeyondTolerance && !qtyBeyondTolerance && !missingReceiptQty) {
    match = 'MATCHED';
  } else if (priceBeyondTolerance && (qtyBeyondTolerance || missingReceiptQty)) {
    match = 'PRICE_AND_QTY_VARIANCE';
  } else if (priceBeyondTolerance) {
    match = 'PRICE_VARIANCE';
  } else {
    match = 'QTY_VARIANCE';
  }

  return {
    match,
    priceVarianceCents,
    qtyVarianceMilli,
    missingReceiptQty,
    priceBeyondTolerance,
    qtyBeyondTolerance,
  };
}

export type AggregateDerived =
  | 'PENDING'
  | 'PARTIAL'
  | 'MATCHED'
  | 'VARIANCE'
  | 'REVIEW_REQUIRED';

export function deriveAggregateStatus(
  lineSummaries: ReadonlyArray<{
    match: string;
    missingReceiptQty?: boolean;
  }>,
): AggregateDerived {
  const hasAmbiguous = lineSummaries.some((s) =>
    s.match.startsWith('AMBIGUOUS'),
  );
  if (hasAmbiguous) return 'REVIEW_REQUIRED';

  const missingQty = lineSummaries.some((s) => s.missingReceiptQty);
  if (missingQty) return 'REVIEW_REQUIRED';

  const hasUnmatched = lineSummaries.some(
    (s) =>
      s.match === 'UNMATCHED_PO_LINE' ||
      s.match === 'UNMATCHED_RECEIPT_LINE',
  );
  const hasVariance = lineSummaries.some(
    (s) =>
      s.match === 'PRICE_VARIANCE' ||
      s.match === 'QTY_VARIANCE' ||
      s.match === 'PRICE_AND_QTY_VARIANCE',
  );

  if (hasVariance) return 'VARIANCE';
  if (hasUnmatched) return 'PARTIAL';
  if (lineSummaries.length === 0) return 'PENDING';
  const allMatched = lineSummaries.every((s) => s.match === 'MATCHED');
  if (allMatched) return 'MATCHED';
  return 'PARTIAL';
}
