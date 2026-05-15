import { describe, expect, it, vi } from 'vitest';
import { EstimateStatus, EstimateTimelineKind, POReconciliationStatus } from '@bvisible/db';

import { getDashboardEstimatePoFlow } from '@/lib/dashboard/get-estimate-po-flow';

describe('dashboard estimate PO flow', () => {
  it('threads tenantId through prisma delegates', async () => {
    const findManyEstimate = vi.fn().mockResolvedValue([]);
    const findManyPo = vi.fn().mockResolvedValue([]);

    await getDashboardEstimatePoFlow('tenant-flow', {
      estimate: { findMany: findManyEstimate },
      purchaseOrder: { findMany: findManyPo },
    });

    expect(findManyEstimate).toHaveBeenCalledTimes(2);
    for (const call of findManyEstimate.mock.calls) {
      expect(call[0]?.where?.tenantId).toBe('tenant-flow');
      expect(call[0]?.where?.deletedAt).toBeNull();
    }

    expect(findManyPo).toHaveBeenCalledTimes(2);
    for (const call of findManyPo.mock.calls) {
      expect(call[0]?.where?.tenantId).toBe('tenant-flow');
      expect(call[0]?.where?.deletedAt).toBeNull();
    }

    const awaitingArgs = findManyEstimate.mock.calls.find(
      (c) => c[0]?.where?.purchaseOrders?.none != null
    );
    expect(awaitingArgs?.[0]?.where?.status).toBe(EstimateStatus.APPROVED);
    expect(awaitingArgs?.[0]?.where?.purchaseOrders?.none?.tenantId).toBe('tenant-flow');

    const acceptedTimelineScoped = findManyEstimate.mock.calls.some(
      (c) =>
        c[0]?.select?.timelineEvents?.where?.tenantId === 'tenant-flow' &&
        c[0]?.select?.timelineEvents?.where?.kind === EstimateTimelineKind.QUOTE_ACCEPTED
    );
    expect(acceptedTimelineScoped).toBe(true);
  });

  it('surfaces reconciliation attention only with explicit recon rows', async () => {
    const findManyEstimate = vi.fn().mockResolvedValue([]);
    const findManyPo = vi.fn().mockImplementation(async (args: { select?: unknown }) => {
      if (args.select && typeof args.select === 'object' && 'createdAt' in (args.select as object)) {
        return [
          {
            id: 'po-x',
            number: 'PO-000011',
            createdAt: new Date('2026-05-02T12:00:00Z'),
            estimate: {
              id: 'est-z',
              number: 'EST-9',
              title: 'Job',
              client: { companyName: 'ACME' },
            },
          },
        ];
      }

      return [
        {
          id: 'po-1',
          number: 'PO-000010',
          estimateId: 'est-a',
          estimate: { number: 'EST-1' },
          reconciliations: [
            {
              status: POReconciliationStatus.REVIEW_REQUIRED,
              updatedAt: new Date('2026-05-03T12:00:00Z'),
            },
          ],
        },
        {
          id: 'po-2',
          number: 'PO-000009',
          estimateId: 'est-b',
          estimate: { number: 'EST-2' },
          reconciliations: [],
        },
      ];
    });

    const res = await getDashboardEstimatePoFlow('tenant-op', {
      estimate: { findMany: findManyEstimate },
      purchaseOrder: { findMany: findManyPo },
    });

    expect(res.estimateLinkedPoReconciliationAttention).toHaveLength(1);
    expect(res.estimateLinkedPoReconciliationAttention[0]?.poId).toBe('po-1');
    expect(res.recentPosFromEstimates[0]?.estimateId).toBe('est-z');
  });

  it('accepted awaiting PO query excludes estimates that already have linked PO rows', async () => {
    const findManyPo = vi.fn().mockResolvedValue([]);
    const findManyEstimate = vi.fn().mockImplementation(async (args: { where?: unknown }) => {
      const w = args.where as {
        purchaseOrders?: { none?: unknown; some?: unknown };
        status?: EstimateStatus;
      };
      if (w.purchaseOrders?.none) {
        return [{ id: 'e-await', number: 'N', title: 'T', updatedAt: new Date(), client: { companyName: 'X' }, timelineEvents: [] }];
      }
      if (w.purchaseOrders?.some) {
        return [];
      }
      return [];
    });

    const res = await getDashboardEstimatePoFlow('tenant-q', {
      estimate: { findMany: findManyEstimate },
      purchaseOrder: { findMany: findManyPo },
    });

    expect(res.acceptedAwaitingPo).toHaveLength(1);
    expect(res.acceptedAwaitingPo[0]?.estimateId).toBe('e-await');
  });
});
