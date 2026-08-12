import { describe, expect, it } from 'vitest';
import {
  EstimateStatus,
  OcrJobStatus,
  POReconciliationStatus,
  POStatus,
} from '@bvisible/db';
import { bucketForWorkflowState } from './operational-matrix';
import { isPastStaleThreshold, STALE_QUOTE_WAITING_MS, staleAgeLabel } from './operational-stale';
import {
  getOperationalAttentionReason,
  getOperationalNextAction,
  getOperationalWorkflowState,
  isOperationalBlocked,
  isOperationalStale,
  isOperationalUnresolved,
} from './operational-state';

describe('operational workflow state (pure)', () => {
  const now = new Date('2026-05-17T12:00:00Z');

  it('maps awaiting customer from SENT estimate', () => {
    expect(
      getOperationalWorkflowState({ estimateStatus: EstimateStatus.SENT }),
    ).toBe('awaiting_customer');
  });

  it('maps approved without PO', () => {
    expect(
      getOperationalWorkflowState({
        estimateStatus: EstimateStatus.APPROVED,
        linkedPoCount: 0,
      }),
    ).toBe('approved_waiting_po');
  });

  it('maps OCR review before vendor wait', () => {
    expect(
      getOperationalWorkflowState({
        poStatus: POStatus.ORDERED,
        hasVendorReply: false,
        ocrStatus: OcrJobStatus.REVIEW_REQUIRED,
      }),
    ).toBe('ocr_review_needed');
  });

  it('maps variance when reconciliation needs attention', () => {
    expect(
      getOperationalWorkflowState({
        reconciliationStatus: POReconciliationStatus.VARIANCE,
      }),
    ).toBe('variance_detected');
  });

  it('maps ready to finalize when QBO coverage complete', () => {
    expect(
      getOperationalWorkflowState({
        estimateStatus: EstimateStatus.APPROVED,
        linkedPoCount: 2,
        allLinkedPosHaveQbo: true,
        finalized: false,
      }),
    ).toBe('ready_to_finalize');
  });

  it('excludes finalized estimates from unresolved actionable states', () => {
    const state = getOperationalWorkflowState({
      estimateStatus: EstimateStatus.FINALIZED,
      finalized: true,
    });
    expect(state).toBe('completed');
    expect(isOperationalUnresolved(state!)).toBe(false);
  });
});

describe('operational attention + next action', () => {
  it('returns human blocker copy without financial verbs', () => {
    const reason = getOperationalAttentionReason('ocr_review_needed');
    expect(reason).toContain('operator');
    expect(reason.toLowerCase()).not.toContain('mutate');
  });

  it('routes OCR review to document detail when id present', () => {
    const next = getOperationalNextAction({
      state: 'ocr_review_needed',
      ocrDocumentId: 'doc1',
    });
    expect(next.href).toBe('/admin/ocr-review/doc1');
    expect(next.label).toBe('Review OCR');
  });

  it('routes variance to reconciliation page', () => {
    const next = getOperationalNextAction({
      state: 'variance_detected',
      poId: 'po1',
    });
    expect(next.href).toBe('/purchase-orders/po1/reconciliation');
  });
});

describe('operational stale (display-only)', () => {
  const now = new Date('2026-05-17T12:00:00Z');

  it('flags quote waiting beyond threshold', () => {
    const ref = new Date(now.getTime() - STALE_QUOTE_WAITING_MS - 1);
    expect(
      isOperationalStale({ state: 'awaiting_customer', referenceAt: ref, now }),
    ).toBe(true);
    expect(staleAgeLabel(ref, now)).toMatch(/\d+d/);
  });

  it('does not mark completed rows stale', () => {
    const ref = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(isOperationalStale({ state: 'completed', referenceAt: ref, now })).toBe(false);
  });

  it('isPastStaleThreshold is deterministic', () => {
    const ref = new Date('2026-05-10T12:00:00Z');
    expect(isPastStaleThreshold(ref, 3 * 24 * 60 * 60 * 1000, now)).toBe(true);
  });
});

describe('queue buckets', () => {
  it('maps recon snapshot into reconciliation_variance bucket', () => {
    expect(bucketForWorkflowState('recon_snapshot_needed')).toBe('reconciliation_variance');
  });

  it('marks blocked states', () => {
    expect(isOperationalBlocked('unmatched_email')).toBe(true);
    expect(isOperationalBlocked('completed')).toBe(false);
  });
});

describe('workflow queue safety (static)', () => {
  it('queue fetcher does not call write APIs', async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('./get-operational-workflow-queues.ts', import.meta.url), 'utf8'),
    );
    expect(src).not.toMatch(/\$transaction/);
    expect(src).not.toMatch(/\.create\(/);
    expect(src).not.toMatch(/\.update\(/);
    expect(src).not.toMatch(/\.delete\(/);
  });
});
