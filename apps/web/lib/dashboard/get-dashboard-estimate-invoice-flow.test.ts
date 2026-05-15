import { describe, expect, it, vi } from 'vitest';
import { EstimateStatus, InvoiceStatus } from '@bvisible/db';

import type { EstimateInvoiceFlowDb } from '@/lib/dashboard/get-dashboard-estimate-invoice-flow';
import { getDashboardEstimateInvoiceFlow } from '@/lib/dashboard/get-dashboard-estimate-invoice-flow';

describe('dashboard estimate invoice flow', () => {
  it('threads tenantId through prisma delegates', async () => {
    const findManyEstimate = vi.fn().mockResolvedValue([]);
    const findManyInvoice = vi.fn().mockResolvedValue([]);

    await getDashboardEstimateInvoiceFlow('tenant-inv', {
      estimate: { findMany: findManyEstimate },
      invoice: { findMany: findManyInvoice },
    } as unknown as EstimateInvoiceFlowDb);

    expect(findManyEstimate).toHaveBeenCalledTimes(1);
    expect(findManyEstimate.mock.calls[0]?.[0]?.where?.tenantId).toBe('tenant-inv');
    expect(findManyEstimate.mock.calls[0]?.[0]?.where?.deletedAt).toBeNull();
    expect(findManyEstimate.mock.calls[0]?.[0]?.where?.status).toBe(EstimateStatus.APPROVED);

    expect(findManyInvoice).toHaveBeenCalledTimes(2);
    for (const call of findManyInvoice.mock.calls) {
      expect(call[0]?.where?.tenantId).toBe('tenant-inv');
      expect(call[0]?.where?.deletedAt).toBeNull();
    }

    const unpaidCall = findManyInvoice.mock.calls.find(
      (c) => c[0]?.where?.status === InvoiceStatus.UNPAID
    );
    expect(unpaidCall?.[0]?.where?.estimate?.is?.status).toBe(EstimateStatus.APPROVED);

    const paidCall = findManyInvoice.mock.calls.find(
      (c) => c[0]?.where?.status === InvoiceStatus.PAID && c[0]?.where?.paidAt != null
    );
    expect(paidCall?.[0]?.where?.estimateId).toEqual({ not: null });
  });

  it('maps estimate rows with missing-invoice predicate', async () => {
    const findManyEstimate = vi.fn().mockResolvedValue([
      {
        id: 'e1',
        number: 'EST-1',
        title: 'Roof',
        updatedAt: new Date('2026-05-05T12:00:00Z'),
        client: { companyName: 'Co' },
      },
    ]);
    const findManyInvoice = vi.fn().mockResolvedValue([]);

    const res = await getDashboardEstimateInvoiceFlow('t1', {
      estimate: { findMany: findManyEstimate },
      invoice: { findMany: findManyInvoice },
    } as unknown as EstimateInvoiceFlowDb);

    expect(res.approvedAwaitingInvoice).toHaveLength(1);
    expect(res.approvedAwaitingInvoice[0]?.estimateId).toBe('e1');
    expect(findManyEstimate.mock.calls[0]?.[0]?.where?.invoices?.none?.tenantId).toBe('t1');
  });
});
