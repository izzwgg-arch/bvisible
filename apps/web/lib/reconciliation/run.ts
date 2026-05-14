import {
  prisma,
  POReconciliationLineMatch,
  POReconciliationStatus,
  Prisma,
  SpendAlertKind,
  SpendAlertStatus,
  VendorPriceExtractionMethod,
} from '@bvisible/db';
import { writeAuditLog } from '@/lib/auth/audit';
import { normalizeVendorItemName } from '@/lib/vendor-pricing/normalize';
import { reconciliationDedupeKey } from './dedupe';
import {
  buildDeterministicReceiptDrafts,
  classifyPairedLine,
  deriveAggregateStatus,
  type NormPoLine,
  type OcrReceiptHistoryRow,
} from './match';
import { readReconciliationThresholds } from './thresholds';
import { reconciliationAlertIdentityKey } from './alert-identity';
import { spendAlertSupersedeWhereForNewPoReconciliationSnapshot } from './supersede-open-recon-alerts';

function fmtMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function extendedObservationCents(
  priceCents: number,
  qtyMilli: number | null,
): number {
  const q = qtyMilli ?? 1000;
  return Math.round((priceCents * q) / 1000);
}

export function buildOcrApproveTriggerDedupeKey(args: {
  tenantId: string;
  purchaseOrderId: string;
  ocrDocumentId: string;
  includedOcrLineItemIds: readonly string[];
}): string {
  const sorted = [...args.includedOcrLineItemIds].sort();
  return reconciliationDedupeKey({
    trigger: 'ocr_approve',
    tenantId: args.tenantId,
    purchaseOrderId: args.purchaseOrderId,
    ocrDocumentId: args.ocrDocumentId,
    lineIds: sorted,
  });
}

export function buildManualRefreshTriggerDedupeKey(args: {
  tenantId: string;
  purchaseOrderId: string;
  nonce: string;
}): string {
  return reconciliationDedupeKey({
    trigger: 'manual_refresh',
    tenantId: args.tenantId,
    purchaseOrderId: args.purchaseOrderId,
    nonce: args.nonce,
  });
}

export async function runPoReconciliationSnapshot(args: {
  tenantId: string;
  purchaseOrderId: string;
  actorId: string;
  triggerDedupeKey: string;
}): Promise<{ skipped: boolean; reconciliationId?: string }> {
  const thresholds = readReconciliationThresholds();

  const existing = await prisma.pOReconciliation.findUnique({
    where: {
      tenantId_triggerDedupeKey: {
        tenantId: args.tenantId,
        triggerDedupeKey: args.triggerDedupeKey,
      },
    },
    select: { id: true },
  });
  if (existing) {
    return { skipped: true, reconciliationId: existing.id };
  }

  const po = await prisma.purchaseOrder.findFirst({
    where: {
      id: args.purchaseOrderId,
      tenantId: args.tenantId,
      deletedAt: null,
    },
    select: {
      id: true,
      subtotalCents: true,
      vendorId: true,
      lines: {
        orderBy: [{ sortOrder: 'asc' }],
        select: {
          id: true,
          sortOrder: true,
          description: true,
          qtyMilli: true,
          unitCostCents: true,
          kind: true,
        },
      },
    },
  });

  if (!po) {
    return { skipped: true };
  }

  const histories = await prisma.vendorPriceHistory.findMany({
    where: {
      tenantId: args.tenantId,
      extractionMethod: VendorPriceExtractionMethod.OCR_APPROVED,
      sourcePoAttachment: { purchaseOrderId: args.purchaseOrderId },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      createdAt: true,
      itemNameNormalized: true,
      priceCents: true,
      quantityMilli: true,
    },
  });

  const normPoLines: NormPoLine[] = po.lines.map((l) => ({
    id: l.id,
    sortOrder: l.sortOrder,
    norm: normalizeVendorItemName(l.description),
    qtyMilli: l.qtyMilli,
    unitCostCents: l.unitCostCents,
    kind: l.kind,
  }));

  const normReceipts: OcrReceiptHistoryRow[] = histories.map((h) => ({
    id: h.id,
    createdAtMs: h.createdAt.getTime(),
    norm: h.itemNameNormalized,
    priceCents: h.priceCents,
    quantityMilli: h.quantityMilli,
  }));

  const drafts = buildDeterministicReceiptDrafts(normPoLines, normReceipts);

  type LineInsert = {
    sortOrder: number;
    poLineItemId: string | null;
    vendorPriceHistoryId: string | null;
    match: POReconciliationLineMatch;
    expectedQtyMilli: number | null;
    expectedUnitCostCents: number | null;
    observedQtyMilli: number | null;
    observedUnitPriceCents: number | null;
    priceVarianceCents: number | null;
    qtyVarianceMilli: number | null;
  };

  const lines: LineInsert[] = [];
  let sortOrder = 0;

  const poById = new Map(po.lines.map((l) => [l.id, l]));
  const histById = new Map(histories.map((h) => [h.id, h]));

  const summariesForAgg: { match: string; missingReceiptQty?: boolean }[] =
    [];

  for (const seg of drafts) {
    if (seg.tag === 'paired') {
      const pl = poById.get(seg.poLineId)!;
      const hist = histById.get(seg.historyId)!;
      const classified = classifyPairedLine({
        expectedQtyMilli: pl.qtyMilli,
        expectedUnitCostCents: pl.unitCostCents,
        observedQtyMilli: hist.quantityMilli,
        observedUnitPriceCents: hist.priceCents,
        priceTolBps: thresholds.priceTolBps,
        absolutePriceTolCents: thresholds.absolutePriceTolCents,
        qtyTolBps: thresholds.qtyTolBps,
      });

      const enumMatch =
        classified.match === 'MATCHED'
          ? POReconciliationLineMatch.MATCHED
          : classified.match === 'PRICE_VARIANCE'
            ? POReconciliationLineMatch.PRICE_VARIANCE
            : classified.match === 'QTY_VARIANCE'
              ? POReconciliationLineMatch.QTY_VARIANCE
              : POReconciliationLineMatch.PRICE_AND_QTY_VARIANCE;

      lines.push({
        sortOrder: sortOrder++,
        poLineItemId: pl.id,
        vendorPriceHistoryId: hist.id,
        match: enumMatch,
        expectedQtyMilli: pl.qtyMilli,
        expectedUnitCostCents: pl.unitCostCents,
        observedQtyMilli: hist.quantityMilli,
        observedUnitPriceCents: hist.priceCents,
        priceVarianceCents: classified.priceVarianceCents,
        qtyVarianceMilli: classified.qtyVarianceMilli,
      });

      summariesForAgg.push({
        match: enumMatch,
        missingReceiptQty: classified.missingReceiptQty,
      });
      continue;
    }

    if (seg.tag === 'unmatched_po') {
      const pl = poById.get(seg.poLineId)!;
      lines.push({
        sortOrder: sortOrder++,
        poLineItemId: pl.id,
        vendorPriceHistoryId: null,
        match: POReconciliationLineMatch.UNMATCHED_PO_LINE,
        expectedQtyMilli: pl.qtyMilli,
        expectedUnitCostCents: pl.unitCostCents,
        observedQtyMilli: null,
        observedUnitPriceCents: null,
        priceVarianceCents: null,
        qtyVarianceMilli: null,
      });
      summariesForAgg.push({
        match: POReconciliationLineMatch.UNMATCHED_PO_LINE,
      });
      continue;
    }

    if (seg.tag === 'unmatched_receipt') {
      const hist = histById.get(seg.historyId)!;
      lines.push({
        sortOrder: sortOrder++,
        poLineItemId: null,
        vendorPriceHistoryId: hist.id,
        match: POReconciliationLineMatch.UNMATCHED_RECEIPT_LINE,
        expectedQtyMilli: null,
        expectedUnitCostCents: null,
        observedQtyMilli: hist.quantityMilli,
        observedUnitPriceCents: hist.priceCents,
        priceVarianceCents: null,
        qtyVarianceMilli: null,
      });
      summariesForAgg.push({
        match: POReconciliationLineMatch.UNMATCHED_RECEIPT_LINE,
      });
      continue;
    }

    if (seg.tag === 'ambiguous_po') {
      const pl = poById.get(seg.poLineId)!;
      lines.push({
        sortOrder: sortOrder++,
        poLineItemId: pl.id,
        vendorPriceHistoryId: null,
        match: POReconciliationLineMatch.AMBIGUOUS_PO_LINE,
        expectedQtyMilli: pl.qtyMilli,
        expectedUnitCostCents: pl.unitCostCents,
        observedQtyMilli: null,
        observedUnitPriceCents: null,
        priceVarianceCents: null,
        qtyVarianceMilli: null,
      });
      summariesForAgg.push({
        match: POReconciliationLineMatch.AMBIGUOUS_PO_LINE,
      });
      continue;
    }

    if (seg.tag === 'ambiguous_receipt') {
      const hist = histById.get(seg.historyId)!;
      lines.push({
        sortOrder: sortOrder++,
        poLineItemId: null,
        vendorPriceHistoryId: hist.id,
        match: POReconciliationLineMatch.AMBIGUOUS_RECEIPT_LINE,
        expectedQtyMilli: null,
        expectedUnitCostCents: null,
        observedQtyMilli: hist.quantityMilli,
        observedUnitPriceCents: hist.priceCents,
        priceVarianceCents: null,
        qtyVarianceMilli: null,
      });
      summariesForAgg.push({
        match: POReconciliationLineMatch.AMBIGUOUS_RECEIPT_LINE,
      });
    }
  }

  const agg = deriveAggregateStatus(summariesForAgg);

  const reconStatus =
    agg === 'MATCHED'
      ? POReconciliationStatus.MATCHED
      : agg === 'PARTIAL'
        ? POReconciliationStatus.PARTIAL
        : agg === 'VARIANCE'
          ? POReconciliationStatus.VARIANCE
          : agg === 'REVIEW_REQUIRED'
            ? POReconciliationStatus.REVIEW_REQUIRED
            : POReconciliationStatus.PENDING;

  const receiptExtendedSum = histories.reduce(
    (acc, h) => acc + extendedObservationCents(h.priceCents, h.quantityMilli),
    0,
  );

  const summary = {
    aggregate: agg,
    poSubtotalCents: po.subtotalCents,
    receiptExtendedSumCents: receiptExtendedSum,
    poLineCount: po.lines.length,
    ocrApprovedObservationCount: histories.length,
    pairedCount: drafts.filter((d) => d.tag === 'paired').length,
    ambiguousCount: drafts.filter(
      (d) => d.tag === 'ambiguous_po' || d.tag === 'ambiguous_receipt',
    ).length,
  };

  const txResult = await prisma.$transaction(
    async (
      tx,
    ): Promise<{ created: false } | { created: true; id: string }> => {
      const dup = await tx.pOReconciliation.findUnique({
        where: {
          tenantId_triggerDedupeKey: {
            tenantId: args.tenantId,
            triggerDedupeKey: args.triggerDedupeKey,
          },
        },
        select: { id: true },
      });
      if (dup) return { created: false };

      const recon = await tx.pOReconciliation.create({
        data: {
          tenantId: args.tenantId,
          purchaseOrderId: args.purchaseOrderId,
          status: reconStatus,
          triggerDedupeKey: args.triggerDedupeKey,
          summary,
        },
        select: { id: true },
      });

      if (lines.length > 0) {
        await tx.pOReconciliationLine.createMany({
          data: lines.map((l) => ({
            tenantId: args.tenantId,
            poReconciliationId: recon.id,
            sortOrder: l.sortOrder,
            poLineItemId: l.poLineItemId,
            vendorPriceHistoryId: l.vendorPriceHistoryId,
            match: l.match,
            expectedQtyMilli: l.expectedQtyMilli,
            expectedUnitCostCents: l.expectedUnitCostCents,
            observedQtyMilli: l.observedQtyMilli,
            observedUnitPriceCents: l.observedUnitPriceCents,
            priceVarianceCents: l.priceVarianceCents,
            qtyVarianceMilli: l.qtyVarianceMilli,
          })),
        });
      }

      const alertCreates: Prisma.SpendAlertCreateManyInput[] = [];

      const ambDedupe = reconciliationDedupeKey({
        kind: 'ambiguous_po',
        tenantId: args.tenantId,
        purchaseOrderId: args.purchaseOrderId,
        reconciliationId: recon.id,
      });

      if (
        drafts.some(
          (d) => d.tag === 'ambiguous_po' || d.tag === 'ambiguous_receipt',
        )
      ) {
        alertCreates.push({
          tenantId: args.tenantId,
          purchaseOrderId: args.purchaseOrderId,
          vendorId: po.vendorId,
          poReconciliationId: recon.id,
          kind: SpendAlertKind.RECONCILIATION_AMBIGUOUS,
          status: SpendAlertStatus.OPEN,
          identityKey: reconciliationAlertIdentityKey({
            tenantId: args.tenantId,
            kind: SpendAlertKind.RECONCILIATION_AMBIGUOUS,
            purchaseOrderId: args.purchaseOrderId,
          }),
          title: 'Receipt ↔ PO mapping ambiguous',
          body:
            'Normalized item labels repeat unevenly between this PO and approved receipt lines. Map manually or adjust descriptions.',
          dedupeKey: ambDedupe,
          metadata: { purchaseOrderId: args.purchaseOrderId },
        });
      }

      for (const seg of drafts) {
        if (seg.tag === 'paired') {
          const pl = poById.get(seg.poLineId)!;
          const hist = histById.get(seg.historyId)!;
          const classified = classifyPairedLine({
            expectedQtyMilli: pl.qtyMilli,
            expectedUnitCostCents: pl.unitCostCents,
            observedQtyMilli: hist.quantityMilli,
            observedUnitPriceCents: hist.priceCents,
            priceTolBps: thresholds.priceTolBps,
            absolutePriceTolCents: thresholds.absolutePriceTolCents,
            qtyTolBps: thresholds.qtyTolBps,
          });

          if (classified.priceBeyondTolerance) {
            alertCreates.push({
              tenantId: args.tenantId,
              purchaseOrderId: args.purchaseOrderId,
              vendorId: po.vendorId,
              poReconciliationId: recon.id,
              kind: SpendAlertKind.PRICE_OVER_PO_EXPECTED,
              status: SpendAlertStatus.OPEN,
              identityKey: reconciliationAlertIdentityKey({
                tenantId: args.tenantId,
                kind: SpendAlertKind.PRICE_OVER_PO_EXPECTED,
                purchaseOrderId: args.purchaseOrderId,
                poLineItemId: pl.id,
                vendorPriceHistoryId: hist.id,
              }),
              title: `Unit price above PO expectation (${hist.itemNameNormalized})`,
              body: `PO ${fmtMoney(pl.unitCostCents)} vs receipt ${fmtMoney(hist.priceCents)} (+${fmtMoney(classified.priceVarianceCents)}).`,
              dedupeKey: reconciliationDedupeKey({
                kind: 'price_over',
                tenantId: args.tenantId,
                purchaseOrderId: args.purchaseOrderId,
                reconciliationId: recon.id,
                poLineId: pl.id,
                historyId: hist.id,
              }),
              metadata: {
                purchaseOrderId: args.purchaseOrderId,
                poLineItemId: pl.id,
                vendorPriceHistoryId: hist.id,
                itemNameNormalized: hist.itemNameNormalized,
              },
            });
          }

          if (
            classified.qtyBeyondTolerance ||
            classified.missingReceiptQty
          ) {
            alertCreates.push({
              tenantId: args.tenantId,
              purchaseOrderId: args.purchaseOrderId,
              vendorId: po.vendorId,
              poReconciliationId: recon.id,
              kind: SpendAlertKind.QTY_MISMATCH,
              status: SpendAlertStatus.OPEN,
              identityKey: reconciliationAlertIdentityKey({
                tenantId: args.tenantId,
                kind: SpendAlertKind.QTY_MISMATCH,
                purchaseOrderId: args.purchaseOrderId,
                poLineItemId: pl.id,
                vendorPriceHistoryId: hist.id,
              }),
              title: `Quantity mismatch (${hist.itemNameNormalized})`,
              body: classified.missingReceiptQty
                ? `Receipt line omitted quantity — PO expects ${pl.qtyMilli / 1000} units.`
                : `PO qty milli ${pl.qtyMilli} vs receipt ${hist.quantityMilli}.`,
              dedupeKey: reconciliationDedupeKey({
                kind: 'qty',
                tenantId: args.tenantId,
                purchaseOrderId: args.purchaseOrderId,
                reconciliationId: recon.id,
                poLineId: pl.id,
                historyId: hist.id,
              }),
              metadata: {
                purchaseOrderId: args.purchaseOrderId,
                poLineItemId: pl.id,
                vendorPriceHistoryId: hist.id,
                itemNameNormalized: hist.itemNameNormalized,
              },
            });
          }
        }

        if (seg.tag === 'unmatched_receipt') {
          const hist = histById.get(seg.historyId)!;
          alertCreates.push({
            tenantId: args.tenantId,
            purchaseOrderId: args.purchaseOrderId,
            vendorId: po.vendorId,
            poReconciliationId: recon.id,
            kind: SpendAlertKind.UNMATCHED_RECEIPT_LINE,
            status: SpendAlertStatus.OPEN,
            identityKey: reconciliationAlertIdentityKey({
              tenantId: args.tenantId,
              kind: SpendAlertKind.UNMATCHED_RECEIPT_LINE,
              purchaseOrderId: args.purchaseOrderId,
              vendorPriceHistoryId: hist.id,
            }),
            title: `Receipt item not on PO (${hist.itemNameNormalized})`,
            body:
              'Approved OCR observation does not pair with a PO line using normalized descriptions.',
            dedupeKey: reconciliationDedupeKey({
              kind: 'unmatched_rcpt',
              tenantId: args.tenantId,
              purchaseOrderId: args.purchaseOrderId,
              reconciliationId: recon.id,
              historyId: hist.id,
            }),
            metadata: {
              purchaseOrderId: args.purchaseOrderId,
              vendorPriceHistoryId: hist.id,
              itemNameNormalized: hist.itemNameNormalized,
            },
          });
        }

        if (seg.tag === 'unmatched_po') {
          const pl = poById.get(seg.poLineId)!;
          const norm = normalizeVendorItemName(pl.description);
          alertCreates.push({
            tenantId: args.tenantId,
            purchaseOrderId: args.purchaseOrderId,
            vendorId: po.vendorId,
            poReconciliationId: recon.id,
            kind: SpendAlertKind.MISSING_PO_RECEIPT_LINE,
            status: SpendAlertStatus.OPEN,
            identityKey: reconciliationAlertIdentityKey({
              tenantId: args.tenantId,
              kind: SpendAlertKind.MISSING_PO_RECEIPT_LINE,
              purchaseOrderId: args.purchaseOrderId,
              poLineItemId: pl.id,
            }),
            title: `Missing receipt coverage (${norm})`,
            body:
              'PO line has no OCR-approved receipt observation paired by normalized description.',
            dedupeKey: reconciliationDedupeKey({
              kind: 'missing_po_line',
              tenantId: args.tenantId,
              purchaseOrderId: args.purchaseOrderId,
              reconciliationId: recon.id,
              poLineId: pl.id,
            }),
            metadata: {
              purchaseOrderId: args.purchaseOrderId,
              poLineItemId: pl.id,
              itemNameNormalized: norm,
            },
          });
        }
      }

      const poTol = Math.max(
        thresholds.absolutePriceTolCents,
        Math.floor(
          (Math.abs(po.subtotalCents) * thresholds.priceTolBps) / 10000,
        ),
      );
      if (receiptExtendedSum > po.subtotalCents + poTol) {
        alertCreates.push({
          tenantId: args.tenantId,
          purchaseOrderId: args.purchaseOrderId,
          vendorId: po.vendorId,
          poReconciliationId: recon.id,
          kind: SpendAlertKind.PO_TOTAL_OVER_EXPECTED,
          status: SpendAlertStatus.OPEN,
          identityKey: reconciliationAlertIdentityKey({
            tenantId: args.tenantId,
            kind: SpendAlertKind.PO_TOTAL_OVER_EXPECTED,
            purchaseOrderId: args.purchaseOrderId,
          }),
          title: 'Receipt totals exceed PO subtotal',
          body: `Summed receipt extensions ${fmtMoney(receiptExtendedSum)} vs PO subtotal ${fmtMoney(po.subtotalCents)}.`,
          dedupeKey: reconciliationDedupeKey({
            kind: 'po_over_total',
            tenantId: args.tenantId,
            purchaseOrderId: args.purchaseOrderId,
            reconciliationId: recon.id,
          }),
          metadata: {
            purchaseOrderId: args.purchaseOrderId,
            receiptExtendedSumCents: receiptExtendedSum,
            poSubtotalCents: po.subtotalCents,
          },
        });
      }

      await tx.spendAlert.updateMany({
        where: spendAlertSupersedeWhereForNewPoReconciliationSnapshot({
          tenantId: args.tenantId,
          purchaseOrderId: args.purchaseOrderId,
        }),
        data: {
          status: SpendAlertStatus.SUPERSEDED,
          supersededAt: new Date(),
          supersededByReconciliationId: recon.id,
        },
      });

      if (alertCreates.length > 0) {
        await tx.spendAlert.createMany({
          data: alertCreates,
          skipDuplicates: true,
        });
      }

      return { created: true, id: recon.id };
    },
  );

  if (!txResult.created) {
    return { skipped: true };
  }

  await writeAuditLog({
    action: 'po_reconciliation_run',
    tenantId: args.tenantId,
    userId: args.actorId,
    targetType: 'purchase_order',
    targetId: args.purchaseOrderId,
    metadata: {
      reconciliationId: txResult.id,
      triggerDedupeKey: args.triggerDedupeKey,
      status: reconStatus,
    },
  });

  return { skipped: false, reconciliationId: txResult.id };
}
