import { describe, expect, it, vi } from 'vitest';
import {
  EstimateStatus,
  OcrJobStatus,
  POReconciliationStatus,
  POStatus,
} from '@bvisible/db';

import {
  countReceiptOcrBuckets,
  dedupeLinkedPosById,
  formatApprovalRecencyPhrase,
  fulfillmentHeadlineForEstimateStatus,
  fulfillmentOperationalHints,
  isApprovedEstimateAwaitingPurchaseOrder,
  mapLinkedPoToEstimateBootstrap,
  receiptOcrOperationalHint,
  reconciliationNeedsAttention,
} from '@/lib/estimate/estimate-fulfillment';

describe('estimate fulfillment derivation', () => {
  it('isApprovedEstimateAwaitingPurchaseOrder is exactly APPROVED + zero PO links', () => {
    expect(
      isApprovedEstimateAwaitingPurchaseOrder(EstimateStatus.APPROVED, 0)
    ).toBe(true);
    expect(
      isApprovedEstimateAwaitingPurchaseOrder(EstimateStatus.APPROVED, 1)
    ).toBe(false);
    expect(
      isApprovedEstimateAwaitingPurchaseOrder(EstimateStatus.SENT, 0)
    ).toBe(false);
  });

  it('reconciliationNeedsAttention mirrors terminal MATCHED / RESOLVED', () => {
    expect(reconciliationNeedsAttention(null)).toBe(false);
    expect(reconciliationNeedsAttention(POReconciliationStatus.MATCHED)).toBe(false);
    expect(reconciliationNeedsAttention(POReconciliationStatus.RESOLVED)).toBe(false);
    expect(reconciliationNeedsAttention(POReconciliationStatus.PARTIAL)).toBe(true);
  });

  it('countReceiptOcrBuckets classifies OCR job buckets without inventing rows', () => {
    expect(
      countReceiptOcrBuckets([
        OcrJobStatus.PENDING,
        OcrJobStatus.PROCESSING,
        OcrJobStatus.REVIEW_REQUIRED,
        null,
        undefined,
      ])
    ).toEqual({ pendingOrProcessing: 2, needsReview: 1 });
  });

  it('receiptOcrOperationalHint summarizes uploads deterministically', () => {
    expect(
      receiptOcrOperationalHint({
        receiptishAttachmentCount: 0,
        ocrPendingOrProcessingCount: 0,
        ocrNeedsReviewCount: 0,
      })
    ).toBe(null);

    expect(
      receiptOcrOperationalHint({
        receiptishAttachmentCount: 2,
        ocrPendingOrProcessingCount: 1,
        ocrNeedsReviewCount: 0,
      })
    ).toContain('still processing');

    expect(
      receiptOcrOperationalHint({
        receiptishAttachmentCount: 1,
        ocrPendingOrProcessingCount: 0,
        ocrNeedsReviewCount: 0,
      })
    ).toContain('vendor receipt');
  });

  it('formatApprovalRecencyPhrase is deterministic by calendar day delta', () => {
    const now = new Date('2026-05-14T12:00:00Z');
    expect(formatApprovalRecencyPhrase(null, now)).toBe(null);
    expect(
      formatApprovalRecencyPhrase(new Date('2026-05-14T08:00:00Z'), now)
    ).toContain('today');
    expect(
      formatApprovalRecencyPhrase(new Date('2026-05-13T08:00:00Z'), now)
    ).toContain('yesterday');
    expect(
      formatApprovalRecencyPhrase(new Date('2026-05-11T08:00:00Z'), now)
    ).toContain('3 days ago');
  });

  it('fulfillmentHeadlineForEstimateStatus follows UX rails', () => {
    expect(
      fulfillmentHeadlineForEstimateStatus(EstimateStatus.DRAFT).subtitle
    ).toContain('Send quote');
    expect(
      fulfillmentHeadlineForEstimateStatus(EstimateStatus.REJECTED).muted
    ).toBe(true);
  });

  it('dedupeLinkedPosById preserves first occurrence order', () => {
    expect(dedupeLinkedPosById([{ id: 'a', x: 1 }, { id: 'b', x: 2 }, { id: 'a', x: 9 }])).toEqual([
      { id: 'a', x: 1 },
      { id: 'b', x: 2 },
    ]);
  });

  it('mapLinkedPoToEstimateBootstrap reflects recon + OCR snapshots', () => {
    const mapped = mapLinkedPoToEstimateBootstrap({
      id: 'po1',
      number: 'PO-0001',
      status: POStatus.DRAFT,
      qboPoNumber: null,
      subtotalCents: 120_00,
      createdAt: new Date('2026-05-01T12:00:00Z'),
      vendor: { id: 'v', name: 'Vendor Co' },
      latestReconciliationStatus: POReconciliationStatus.REVIEW_REQUIRED,
      receiptishAttachmentCount: 1,
      ocrPendingOrProcessingCount: 1,
      ocrNeedsReviewCount: 0,
    });

    expect(mapped.reconciliationNeedsAttention).toBe(true);
    expect(mapped.createdAtIso.startsWith('2026-05-01')).toBe(true);
  });

  it('fulfillmentOperationalHints does not claim fulfillment from APPROVED status alone when PO missing', () => {
    const now = new Date('2026-05-14T12:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const hints = fulfillmentOperationalHints({
      estimateStatus: EstimateStatus.APPROVED,
      linkedPoCount: 0,
      quoteAcceptedAt: new Date('2026-05-11T12:00:00Z'),
      linkedPos: [],
      now,
    });

    expect(hints.some((h) => h.includes('No purchase order'))).toBe(true);

    vi.useRealTimers();
  });
});
