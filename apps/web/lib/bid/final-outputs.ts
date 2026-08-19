// Step 7 outputs: the customer-ready estimate document and the QBME block,
// both built from the SAME saved lines as the PDF and the public quote
// (loadEstimatePdfData). Shared by the server page and by the client
// refresh action so Step 7 can never show a stale estimate after an edit.

import { estimatePdfCss, loadEstimatePdfData, qbmeSourceLinesFromPdfData, renderEstimatePdfBody } from '@/lib/estimate/estimate-pdf';
import { buildQbmeExport } from '@/lib/estimate/qbme';

export interface BidFinalOutputs {
  estimateHtml: string;
  estimateCss: string;
  lineCount: number;
  subtotalCents: number;
  taxCents: number;
  taxPercentMilli: number;
  taxLabel: string;
  totalCents: number;
  qbmeBlock: string;
  qbmeLines: Array<{ item: string; description: string; qty: string; rate: string; amountCents: number }>;
  qbmeReconciled: boolean;
  qbmeSubtotalCents: number;
  qbmeDriftCents: number;
}

export async function buildBidFinalOutputs(tenantId: string, estimateId: string): Promise<BidFinalOutputs | null> {
  const data = await loadEstimatePdfData(tenantId, estimateId);
  if (!data) return null;
  const qbme = buildQbmeExport(qbmeSourceLinesFromPdfData(data));
  return {
    estimateHtml: renderEstimatePdfBody(data),
    estimateCss: estimatePdfCss(),
    lineCount: data.lines.length,
    subtotalCents: data.subtotalCents,
    taxCents: data.taxCents,
    taxPercentMilli: data.taxPercentMilli,
    taxLabel: data.taxLabel,
    totalCents: data.totalCents,
    qbmeBlock: qbme.block,
    qbmeLines: qbme.lines.map((l) => ({ item: l.item, description: l.description, qty: l.qty, rate: l.rate, amountCents: l.amountCents })),
    qbmeReconciled: qbme.reconciliation.ok,
    qbmeSubtotalCents: qbme.reconciliation.qbmeSubtotalCents,
    qbmeDriftCents: qbme.reconciliation.driftCents,
  };
}
