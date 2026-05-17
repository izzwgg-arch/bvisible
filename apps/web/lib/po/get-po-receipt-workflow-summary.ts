import {
  OcrJobStatus,
  POReconciliationLineMatch,
  POReconciliationStatus,
  prisma,
  SpendAlertStatus,
  VendorPriceExtractionMethod,
} from '@bvisible/db';

const VARIANCE_MATCHES = new Set<POReconciliationLineMatch>([
  POReconciliationLineMatch.PRICE_VARIANCE,
  POReconciliationLineMatch.QTY_VARIANCE,
  POReconciliationLineMatch.PRICE_AND_QTY_VARIANCE,
  POReconciliationLineMatch.UNMATCHED_PO_LINE,
  POReconciliationLineMatch.UNMATCHED_RECEIPT_LINE,
  POReconciliationLineMatch.AMBIGUOUS_PO_LINE,
  POReconciliationLineMatch.AMBIGUOUS_RECEIPT_LINE,
]);

const RECON_NEEDS_ATTENTION = new Set<POReconciliationStatus>([
  POReconciliationStatus.VARIANCE,
  POReconciliationStatus.REVIEW_REQUIRED,
  POReconciliationStatus.PARTIAL,
]);

export type PoReceiptWorkflowSummary = {
  latestOcrStatus: OcrJobStatus | null;
  ocrDocumentsTotal: number;
  ocrNeedsReviewCount: number;
  approvedReceiptLineCount: number;
  latestReconciliationStatus: POReconciliationStatus | null;
  latestReconciliationAt: Date | null;
  varianceLineCount: number;
  openSpendAlertCount: number;
  hasReconciliationSnapshot: boolean;
  reconciliationNeedsAttention: boolean;
  operatorMarkedReconciledAt: Date | null;
};

export async function getPoReceiptWorkflowSummary(
  tenantId: string,
  purchaseOrderId: string,
): Promise<PoReceiptWorkflowSummary> {
  const [
    ocrDocs,
    approvedReceiptLineCount,
    latestReconciliation,
    openSpendAlertCount,
    po,
  ] = await Promise.all([
    prisma.ocrDocument.findMany({
      where: {
        tenantId,
        poAttachment: { purchaseOrderId },
      },
      select: { id: true, status: true },
    }),
    prisma.vendorPriceHistory.count({
      where: {
        tenantId,
        extractionMethod: VendorPriceExtractionMethod.OCR_APPROVED,
        sourcePoAttachment: { purchaseOrderId },
      },
    }),
    prisma.pOReconciliation.findFirst({
      where: { tenantId, purchaseOrderId },
      orderBy: { createdAt: 'desc' },
      select: {
        status: true,
        createdAt: true,
        lines: { select: { match: true } },
      },
    }),
    prisma.spendAlert.count({
      where: {
        tenantId,
        purchaseOrderId,
        status: SpendAlertStatus.OPEN,
      },
    }),
    prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, tenantId },
      select: { operatorMarkedReconciledAt: true },
    }),
  ]);

  const ocrNeedsReviewCount = ocrDocs.filter(
    (d) => d.status === OcrJobStatus.REVIEW_REQUIRED,
  ).length;

  const latestOcrStatus = pickLatestOcrStatus(ocrDocs.map((d) => d.status));

  const varianceLineCount =
    latestReconciliation?.lines.filter((l) => VARIANCE_MATCHES.has(l.match)).length ?? 0;

  const status = latestReconciliation?.status ?? null;

  return {
    latestOcrStatus,
    ocrDocumentsTotal: ocrDocs.length,
    ocrNeedsReviewCount,
    approvedReceiptLineCount,
    latestReconciliationStatus: status,
    latestReconciliationAt: latestReconciliation?.createdAt ?? null,
    varianceLineCount,
    openSpendAlertCount,
    hasReconciliationSnapshot: latestReconciliation != null,
    reconciliationNeedsAttention: status != null && RECON_NEEDS_ATTENTION.has(status),
    operatorMarkedReconciledAt: po?.operatorMarkedReconciledAt ?? null,
  };
}

function pickLatestOcrStatus(statuses: OcrJobStatus[]): OcrJobStatus | null {
  if (statuses.length === 0) return null;
  const priority: OcrJobStatus[] = [
    OcrJobStatus.REVIEW_REQUIRED,
    OcrJobStatus.FAILED,
    OcrJobStatus.PROCESSING,
    OcrJobStatus.PENDING,
    OcrJobStatus.CONFIRMED,
    OcrJobStatus.REJECTED,
  ];
  for (const p of priority) {
    if (statuses.includes(p)) return p;
  }
  return statuses[0] ?? null;
}
