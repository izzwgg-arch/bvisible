import { describe, expect, it } from 'vitest';
import { EstimateStatus, POReconciliationStatus } from '@bvisible/db';
import { buildEstimateFinalizeChecklist } from './estimate-finalize-checklist';

describe('buildEstimateFinalizeChecklist', () => {
  const estId = 'est-1';

  it('blocks when no linked PO', () => {
    const c = buildEstimateFinalizeChecklist({
      estimateId: estId,
      estimateStatus: EstimateStatus.APPROVED,
      quoteAccepted: true,
      linkedPos: [],
    });
    expect(c.readyToFinalize).toBe(false);
    expect(c.items.find((i) => i.key === 'po')?.done).toBe(false);
  });

  it('blocks finalize when QBO missing on linked PO', () => {
    const c = buildEstimateFinalizeChecklist({
      estimateId: estId,
      estimateStatus: EstimateStatus.APPROVED,
      quoteAccepted: true,
      linkedPos: [
        {
          id: 'po-1',
          number: 'PO-100',
          qboPoNumber: null,
          latestReconciliationStatus: POReconciliationStatus.MATCHED,
        },
      ],
    });
    expect(c.readyToFinalize).toBe(false);
    expect(c.blockedSummary).toMatch(/QuickBooks/i);
    expect(c.items.find((i) => i.key === 'qbo')?.done).toBe(false);
  });

  it('ready when approved, QBO on all POs, recon clean', () => {
    const c = buildEstimateFinalizeChecklist({
      estimateId: estId,
      estimateStatus: EstimateStatus.APPROVED,
      quoteAccepted: true,
      linkedPos: [
        {
          id: 'po-1',
          number: 'PO-100',
          qboPoNumber: 'QBO-55',
          latestReconciliationStatus: POReconciliationStatus.MATCHED,
        },
      ],
    });
    expect(c.readyToFinalize).toBe(true);
    expect(c.blockedSummary).toBeNull();
  });

  it('blocks when reconciliation needs attention', () => {
    const c = buildEstimateFinalizeChecklist({
      estimateId: estId,
      estimateStatus: EstimateStatus.APPROVED,
      quoteAccepted: true,
      linkedPos: [
        {
          id: 'po-1',
          number: 'PO-100',
          qboPoNumber: 'QBO-1',
          latestReconciliationStatus: POReconciliationStatus.VARIANCE,
        },
      ],
    });
    expect(c.readyToFinalize).toBe(false);
    expect(c.items.find((i) => i.key === 'recon')?.done).toBe(false);
  });
});
