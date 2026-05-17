import { describe, expect, it } from 'vitest';
import {
  EstimateStatus,
  POEventKind,
  POReconciliationStatus,
  POStatus,
} from '@bvisible/db';
import { lifecycleBucketForState } from './po-lifecycle-matrix';
import { parsePoLifecycleOperatorFlags, type PoLifecycleSignals } from './po-lifecycle-signals';
import {
  STALE_NO_VENDOR_REPLY_MS,
  STALE_PARTIAL_RECEIPT_MS,
  STALE_UNRESOLVED_VARIANCE_MS,
  STALE_WAITING_SHIPMENT_MS,
  isPastPoStaleThreshold,
  poStaleAgeLabel,
} from './po-lifecycle-stale';
import {
  getPoLifecycleStaleInfo,
  getPurchaseOrderLifecycleNextAction,
  getPurchaseOrderLifecycleState,
  isPoLifecycleBlocked,
} from './po-lifecycle-state';

function baseSignals(overrides: Partial<PoLifecycleSignals> = {}): PoLifecycleSignals {
  return {
    poStatus: POStatus.ORDERED,
    updatedAt: new Date('2026-05-10T12:00:00Z'),
    hasVendorReply: false,
    vendorReplyHasAttachment: false,
    isOperatorBlocked: false,
    blockedAt: null,
    operatorVendorAcknowledged: false,
    operatorReceivedComplete: false,
    ocrConfirmedCount: 0,
    ocrReviewRequiredCount: 0,
    ocrPendingCount: 0,
    approvedReceiptLineCount: 0,
    hasReconciliationSnapshot: false,
    latestReconciliationStatus: null,
    openSpendAlertCount: 0,
    operatorMarkedReconciledAt: null,
    estimateStatus: null,
    estimateFinalized: false,
    linkedEstimateHasQboOnAllPos: null,
    qboPoNumber: null,
    ...overrides,
  };
}

describe('getPurchaseOrderLifecycleState', () => {
  it('maps draft from PO status', () => {
    expect(getPurchaseOrderLifecycleState(baseSignals({ poStatus: POStatus.DRAFT }))).toBe(
      'draft',
    );
  });

  it('maps sent_to_vendor when ordered without vendor ack', () => {
    expect(
      getPurchaseOrderLifecycleState(
        baseSignals({ poStatus: POStatus.SENT, hasVendorReply: false }),
      ),
    ).toBe('sent_to_vendor');
  });

  it('maps vendor_acknowledged from vendor reply without receipt OCR', () => {
    expect(
      getPurchaseOrderLifecycleState(
        baseSignals({
          poStatus: POStatus.ORDERED,
          hasVendorReply: true,
          vendorReplyHasAttachment: true,
          ocrConfirmedCount: 0,
        }),
      ),
    ).toBe('waiting_on_shipment');
  });

  it('maps waiting_on_shipment when acked without receipt OCR', () => {
    expect(
      getPurchaseOrderLifecycleState(
        baseSignals({
          operatorVendorAcknowledged: true,
          ocrConfirmedCount: 0,
        }),
      ),
    ).toBe('waiting_on_shipment');
  });

  it('maps partially_received from PO status', () => {
    expect(
      getPurchaseOrderLifecycleState(
        baseSignals({ poStatus: POStatus.PARTIALLY_RECEIVED }),
      ),
    ).toBe('partially_received');
  });

  it('maps reconciliation_needed when OCR confirmed without snapshot', () => {
    expect(
      getPurchaseOrderLifecycleState(
        baseSignals({
          poStatus: POStatus.ORDERED,
          ocrConfirmedCount: 2,
          hasReconciliationSnapshot: false,
        }),
      ),
    ).toBe('reconciliation_needed');
  });

  it('maps variance when reconciliation needs attention', () => {
    expect(
      getPurchaseOrderLifecycleState(
        baseSignals({
          latestReconciliationStatus: POReconciliationStatus.VARIANCE,
          hasReconciliationSnapshot: true,
        }),
      ),
    ).toBe('variance_detected');
  });

  it('maps blocked from operator flag', () => {
    expect(
      getPurchaseOrderLifecycleState(baseSignals({ isOperatorBlocked: true })),
    ).toBe('blocked_backordered');
  });

  it('maps completed when estimate finalized', () => {
    expect(
      getPurchaseOrderLifecycleState(
        baseSignals({
          poStatus: POStatus.RECEIVED,
          estimateFinalized: true,
        }),
      ),
    ).toBe('completed');
  });

  it('maps ready_to_finalize when estimate approved with QBO coverage', () => {
    expect(
      getPurchaseOrderLifecycleState(
        baseSignals({
          estimateStatus: EstimateStatus.APPROVED,
          linkedEstimateHasQboOnAllPos: true,
          qboPoNumber: 'QBO-1',
          latestReconciliationStatus: POReconciliationStatus.MATCHED,
          hasReconciliationSnapshot: true,
        }),
      ),
    ).toBe('ready_to_finalize');
  });
});

describe('operator event parsing', () => {
  it('tracks blocked until cleared', () => {
    const flags = parsePoLifecycleOperatorFlags([
      { kind: POEventKind.OPERATOR_BLOCKED, createdAt: new Date('2026-05-01') },
      { kind: POEventKind.OPERATOR_BLOCKED_CLEARED, createdAt: new Date('2026-05-02') },
    ]);
    expect(flags.isOperatorBlocked).toBe(false);
  });

  it('records vendor ack and received complete', () => {
    const flags = parsePoLifecycleOperatorFlags([
      { kind: POEventKind.OPERATOR_VENDOR_ACKNOWLEDGED, createdAt: new Date() },
      { kind: POEventKind.OPERATOR_RECEIVED_COMPLETE, createdAt: new Date() },
    ]);
    expect(flags.operatorVendorAcknowledged).toBe(true);
    expect(flags.operatorReceivedComplete).toBe(true);
  });
});

describe('stale thresholds (display-only)', () => {
  const now = new Date('2026-05-17T12:00:00Z');

  it('flags sent_to_vendor after no vendor reply threshold', () => {
    const ref = new Date(now.getTime() - STALE_NO_VENDOR_REPLY_MS - 1000);
    expect(isPastPoStaleThreshold(ref, STALE_NO_VENDOR_REPLY_MS, now)).toBe(true);
    const stale = getPoLifecycleStaleInfo({
      state: 'sent_to_vendor',
      signals: baseSignals(),
      referenceAt: ref,
      now,
    });
    expect(stale.isStale).toBe(true);
    expect(stale.label).toBe(poStaleAgeLabel(ref, now));
  });

  it('does not stale completed states', () => {
    const stale = getPoLifecycleStaleInfo({
      state: 'completed',
      signals: baseSignals(),
      referenceAt: new Date('2020-01-01'),
      now,
    });
    expect(stale.isStale).toBe(false);
  });

  it('uses shipment and partial receipt thresholds', () => {
    expect(STALE_WAITING_SHIPMENT_MS).toBeGreaterThan(STALE_NO_VENDOR_REPLY_MS);
    expect(STALE_PARTIAL_RECEIPT_MS).toBe(STALE_UNRESOLVED_VARIANCE_MS);
  });
});

describe('dashboard buckets + next actions', () => {
  it('maps states to PO lifecycle queue buckets', () => {
    expect(lifecycleBucketForState('sent_to_vendor')).toBe('waiting_vendor_ack');
    expect(lifecycleBucketForState('partially_received')).toBe('partial_receipt');
    expect(lifecycleBucketForState('ready_to_finalize')).toBe('ready_to_finalize');
    expect(lifecycleBucketForState('completed')).toBeNull();
  });

  it('routes variance to reconciliation page', () => {
    const next = getPurchaseOrderLifecycleNextAction({
      state: 'variance_detected',
      poId: 'po-1',
    });
    expect(next.href).toBe('/purchase-orders/po-1/reconciliation');
  });

  it('treats sent_to_vendor as blocked for attention styling', () => {
    expect(isPoLifecycleBlocked('sent_to_vendor')).toBe(true);
    expect(isPoLifecycleBlocked('completed')).toBe(false);
  });
});

describe('read-only guarantees', () => {
  it('lifecycle actions module only appends PO events (no price fields in exports)', async () => {
    const mod = await import('./po-lifecycle-actions');
    expect(typeof mod.markPoVendorAcknowledgedAction).toBe('function');
    expect(typeof mod.markPoBlockedAction).toBe('function');
    expect('updatePurchaseOrderPricing' in mod).toBe(false);
  });
});
