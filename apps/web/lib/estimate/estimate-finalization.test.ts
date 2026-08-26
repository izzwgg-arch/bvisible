import { describe, expect, it } from 'vitest';
import { EstimateStatus, POReconciliationStatus } from '@bvisible/db';
import {
  evaluateEstimateFinalizeGates,
  isPotentiallyReadyToFinalizeHeuristic,
  POTENTIALLY_READY_LABEL,
} from './estimate-finalization';

const po = (
  overrides: Partial<{
    id: string;
    number: string;
    qboPoNumber: string | null;
    latestReconciliationStatus: POReconciliationStatus | null;
  }> = {},
) => ({
  id: 'po-1',
  number: 'PO-100',
  qboPoNumber: 'QBO-55',
  latestReconciliationStatus: POReconciliationStatus.MATCHED as POReconciliationStatus | null,
  ...overrides,
});

describe('evaluateEstimateFinalizeGates', () => {
  it('ready when approved, PO linked, all QBO, recon clean', () => {
    const r = evaluateEstimateFinalizeGates({
      estimateStatus: EstimateStatus.APPROVED,
      linkedPos: [po()],
    });
    expect(r.canFinalize).toBe(true);
    expect(r.kind).toBe('ready');
    expect(r.blockedReason).toBeNull();
  });

  it('blocks when no linked PO', () => {
    const r = evaluateEstimateFinalizeGates({
      estimateStatus: EstimateStatus.APPROVED,
      linkedPos: [],
    });
    expect(r.canFinalize).toBe(false);
    expect(r.kind).toBe('no_linked_po');
  });

  it('blocks when any linked PO is missing QBO', () => {
    const r = evaluateEstimateFinalizeGates({
      estimateStatus: EstimateStatus.APPROVED,
      linkedPos: [po({ qboPoNumber: 'QBO-1' }), po({ id: 'po-2', number: 'PO-200', qboPoNumber: null })],
    });
    expect(r.canFinalize).toBe(false);
    expect(r.kind).toBe('missing_qbo');
    expect(r.blockedReason).toMatch(/PO-200/);
  });

  it('blocks when reconciliation has unresolved variance', () => {
    const r = evaluateEstimateFinalizeGates({
      estimateStatus: EstimateStatus.APPROVED,
      linkedPos: [
        po({ latestReconciliationStatus: POReconciliationStatus.VARIANCE }),
      ],
    });
    expect(r.canFinalize).toBe(false);
    expect(r.kind).toBe('reconciliation_unresolved');
  });

  it('blocks when estimate is not approved', () => {
    const r = evaluateEstimateFinalizeGates({
      estimateStatus: EstimateStatus.SENT,
      linkedPos: [po()],
    });
    expect(r.canFinalize).toBe(false);
    expect(r.kind).toBe('not_approved');
  });

  it('blocks double finalize', () => {
    const r = evaluateEstimateFinalizeGates({
      estimateStatus: EstimateStatus.FINALIZED,
      linkedPos: [po()],
    });
    expect(r.canFinalize).toBe(false);
    expect(r.kind).toBe('already_finalized');
  });

  it('approved with QBO-covered PO can finalize', () => {
    const r = evaluateEstimateFinalizeGates({
      estimateStatus: EstimateStatus.APPROVED,
      linkedPos: [po()],
    });
    expect(r.canFinalize).toBe(true);
  });
});

describe('isPotentiallyReadyToFinalizeHeuristic', () => {
  it('flags approved + PO as potentially ready without recon proof', () => {
    expect(
      isPotentiallyReadyToFinalizeHeuristic({
        estimateStatus: EstimateStatus.APPROVED,
        hasLinkedPo: true,
      }),
    ).toBe(true);
  });

  it('does not flag when QBO explicitly missing', () => {
    expect(
      isPotentiallyReadyToFinalizeHeuristic({
        estimateStatus: EstimateStatus.APPROVED,
        hasLinkedPo: true,
        allLinkedPosHaveQbo: false,
      }),
    ).toBe(false);
  });

  it('exports operator-facing potentially-ready copy', () => {
    expect(POTENTIALLY_READY_LABEL).toMatch(/Potentially ready/i);
  });
});

describe('finalizeEstimateAction safety (static)', () => {
  it('does not mutate financial fields on finalize', async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        new URL('../../app/(app)/estimates/[id]/actions.ts', import.meta.url),
        'utf8',
      ),
    );
    const finalizeBlock = src.slice(
      src.indexOf('export async function finalizeEstimateAction'),
      src.indexOf('export async function unfinalizeEstimateAction'),
    );
    expect(finalizeBlock).not.toMatch(/computeEstimate/);
    expect(finalizeBlock).not.toMatch(/finalPriceCents/);
    expect(finalizeBlock).not.toMatch(/subtotalCostCents/);
    expect(finalizeBlock).toMatch(/estimate_finalized/);
    expect(finalizeBlock).toMatch(/status: EstimateStatus\.FINALIZED/);
  });

  it('finalizes an estimate with nothing to purchase instead of dead-ending', async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        new URL('../../app/(app)/estimates/[id]/actions.ts', import.meta.url),
        'utf8',
      ),
    );
    const finalizeBlock = src.slice(
      src.indexOf('export async function finalizeEstimateAction'),
      src.indexOf('export async function unfinalizeEstimateAction'),
    );
    // Only a genuine seeding failure may block the status change; an
    // all-labor / all-misc estimate has no PO to create and must still close.
    expect(finalizeBlock).toMatch(/reason !== 'nothing_to_purchase'/);
    expect(finalizeBlock).toMatch(/purchaseOrderId: po\?\.purchaseOrderId/);
  });

  it('the PO seeder distinguishes "nothing to purchase" from a hard failure', async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        new URL('../purchase-orders/create-po-from-internal-materials.ts', import.meta.url),
        'utf8',
      ),
    );
    expect(src).toMatch(/reason: 'nothing_to_purchase'/);
    expect(src).toMatch(/reason: 'estimate_not_found'/);
  });

  it('saveEstimateAction refuses finalized estimates', async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        new URL('../../app/(app)/estimates/[id]/actions.ts', import.meta.url),
        'utf8',
      ),
    );
    expect(src).toMatch(/Estimate is finalized/);
  });
});
