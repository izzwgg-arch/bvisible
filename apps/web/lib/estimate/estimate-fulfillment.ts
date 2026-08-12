import type {
  EstimateStatus,
  OcrJobStatus,
  POReconciliationStatus,
  POStatus,
} from '@bvisible/db';
import {
  EstimateStatus as ES,
  OcrJobStatus as OJS,
  POReconciliationStatus as PRS,
} from '@bvisible/db';

/** Accepted (approved) estimate with zero linked non-deleted POs — DB predicate mirrors dashboard / gates staff attention. */
export function isApprovedEstimateAwaitingPurchaseOrder(
  status: EstimateStatus,
  linkedPoCount: number
): boolean {
  return status === ES.APPROVED && linkedPoCount === 0;
}

export function reconciliationNeedsAttention(
  status: POReconciliationStatus | null | undefined
): boolean {
  if (status == null) return false;
  return status !== PRS.MATCHED && status !== PRS.RESOLVED;
}

export function reconciliationGuidanceLabel(
  status: POReconciliationStatus | null | undefined
): string | null {
  if (status == null) return null;
  switch (status) {
    case PRS.PENDING:
      return 'Reconciliation pending';
    case PRS.PARTIAL:
      return 'PO partially reconciled';
    case PRS.VARIANCE:
      return 'Reconciliation has variances';
    case PRS.REVIEW_REQUIRED:
      return 'Reconciliation needs review';
    case PRS.MATCHED:
    case PRS.RESOLVED:
      return null;
    default:
      return null;
  }
}

export type LinkedPoFulfillmentSnapshot = {
  id: string;
  number: string;
  status: POStatus;
  qboPoNumber: string | null;
  subtotalCents: number;
  createdAt: Date;
  vendor: { id: string; name: string } | null;
  latestReconciliationStatus: POReconciliationStatus | null;
  receiptishAttachmentCount: number;
  ocrPendingOrProcessingCount: number;
  ocrNeedsReviewCount: number;
};

export type EstimateLinkedPoBootstrap = {
  id: string;
  number: string;
  status: POStatus;
  qboPoNumber: string | null;
  subtotalCents: number;
  createdAtIso: string;
  vendor: { id: string; name: string } | null;
  latestReconciliationStatus: POReconciliationStatus | null;
  receiptishAttachmentCount: number;
  ocrPendingOrProcessingCount: number;
  ocrNeedsReviewCount: number;
  reconciliationNeedsAttention: boolean;
};

export function dedupeLinkedPosById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/** Maps a Prisma PO row with nested reconciliation + receipt-ish OCR attachment snippet into bootstrap fields. */
export function mapLinkedPoToEstimateBootstrap(
  po: LinkedPoFulfillmentSnapshot
): EstimateLinkedPoBootstrap {
  const recon = po.latestReconciliationStatus;

  return {
    id: po.id,
    number: po.number,
    status: po.status,
    qboPoNumber: po.qboPoNumber,
    subtotalCents: po.subtotalCents,
    createdAtIso: po.createdAt.toISOString(),
    vendor: po.vendor,
    latestReconciliationStatus: recon,
    receiptishAttachmentCount: po.receiptishAttachmentCount,
    ocrPendingOrProcessingCount: po.ocrPendingOrProcessingCount,
    ocrNeedsReviewCount: po.ocrNeedsReviewCount,
    reconciliationNeedsAttention: reconciliationNeedsAttention(recon),
  };
}

/** Roll up OCR states for receipt-ish attachments only (caller filters attachment kinds). */
export function countReceiptOcrBuckets(
  attachmentOcrStatuses: ReadonlyArray<OcrJobStatus | null | undefined>
): {
  pendingOrProcessing: number;
  needsReview: number;
} {
  let pendingOrProcessing = 0;
  let needsReview = 0;
  for (const raw of attachmentOcrStatuses) {
    if (raw == null) continue;
    if (raw === OJS.PENDING || raw === OJS.PROCESSING) pendingOrProcessing++;
    else if (raw === OJS.REVIEW_REQUIRED || raw === OJS.FAILED || raw === OJS.REJECTED)
      needsReview++;
  }
  return { pendingOrProcessing, needsReview };
}

export function receiptOcrOperationalHint(input: {
  receiptishAttachmentCount: number;
  ocrPendingOrProcessingCount: number;
  ocrNeedsReviewCount: number;
}): string | null {
  if (input.receiptishAttachmentCount === 0) return null;
  const parts: string[] = [];
  if (input.ocrPendingOrProcessingCount > 0) {
    parts.push(
      `${input.ocrPendingOrProcessingCount} receipt OCR job${input.ocrPendingOrProcessingCount === 1 ? '' : 's'} still processing`
    );
  }
  if (input.ocrNeedsReviewCount > 0) {
    parts.push(
      `${input.ocrNeedsReviewCount} receipt OCR ${input.ocrNeedsReviewCount === 1 ? 'job needs' : 'jobs need'} operator review`
    );
  }
  if (parts.length === 0 && input.receiptishAttachmentCount > 0) {
    return `${input.receiptishAttachmentCount} vendor receipt${input.receiptishAttachmentCount === 1 ? '' : 's'} on file`;
  }
  return parts.join(' · ');
}

/** Plain-language relative time from an acceptance timestamp (deterministic; no LLM). */
export function formatApprovalRecencyPhrase(
  quoteAcceptedAt: Date | null,
  now: Date
): string | null {
  if (!quoteAcceptedAt) return null;
  const ms = now.getTime() - quoteAcceptedAt.getTime();
  if (ms < 0) return 'Customer approval recorded.';
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days === 0) return 'Customer approved this quote today.';
  if (days === 1) return 'Customer approved this quote yesterday.';
  return `Customer approved this quote ${days} days ago.`;
}

export type FulfillmentHeadline = {
  title: string;
  subtitle: string | null;
  muted: boolean;
};

export function fulfillmentHeadlineForEstimateStatus(status: EstimateStatus): FulfillmentHeadline {
  switch (status) {
    case ES.DRAFT:
      return {
        title: 'Fulfillment',
        subtitle: 'Send quote to customer.',
        muted: false,
      };
    case ES.SENT:
      return {
        title: 'Next steps',
        subtitle: 'Awaiting customer — public quote outstanding.',
        muted: false,
      };
    case ES.APPROVED:
      return {
        title: 'Fulfillment',
        subtitle: null,
        muted: false,
      };
    case ES.REJECTED:
      return {
        title: 'Fulfillment',
        subtitle: 'This estimate was declined — the PO workflow does not apply.',
        muted: true,
      };
    case ES.FINALIZED:
      return {
        title: 'Fulfillment complete',
        subtitle:
          'Estimate finalized — linked POs remain active operational records.',
        muted: false,
      };
    default:
      return { title: 'Fulfillment', subtitle: null, muted: false };
  }
}

export function fulfillmentOperationalHints(input: {
  estimateStatus: EstimateStatus;
  linkedPoCount: number;
  quoteAcceptedAt: Date | null;
  linkedPos: ReadonlyArray<EstimateLinkedPoBootstrap>;
  now: Date;
}): string[] {
  const hints: string[] = [];
  const approval = formatApprovalRecencyPhrase(input.quoteAcceptedAt, input.now);
  if (
    input.estimateStatus === ES.APPROVED ||
    input.estimateStatus === ES.FINALIZED
  ) {
    if (approval) hints.push(approval);
  }

  if (input.estimateStatus === ES.APPROVED && input.linkedPoCount === 0) {
    hints.push('No purchase order has been created yet.');
  }

  for (const p of input.linkedPos) {
    const reconLabel = reconciliationGuidanceLabel(p.latestReconciliationStatus);
    if (reconLabel && reconciliationNeedsAttention(p.latestReconciliationStatus)) {
      hints.push(`${p.number}: ${reconLabel}.`);
    }
    const ocrHint = receiptOcrOperationalHint({
      receiptishAttachmentCount: p.receiptishAttachmentCount,
      ocrPendingOrProcessingCount: p.ocrPendingOrProcessingCount,
      ocrNeedsReviewCount: p.ocrNeedsReviewCount,
    });
    if (ocrHint) {
      hints.push(`${p.number}: ${ocrHint}.`);
    }
  }

  return hints;
}
