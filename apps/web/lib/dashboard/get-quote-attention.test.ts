import { describe, expect, it, vi } from 'vitest';
import { EstimateStatus, EstimateTimelineKind } from '@bvisible/db';

import {
  dedupeEstimateRowsByFirstOccurrence,
  getDashboardQuoteAttention,
} from '@/lib/dashboard/get-quote-attention';

describe('dashboard quote attention', () => {
  it('dedupeEstimateRowsByFirstOccurrence preserves first hit order', () => {
    const rows = [
      { estimateId: 'e1', x: 1 },
      { estimateId: 'e2', x: 2 },
      { estimateId: 'e1', x: 3 },
    ];
    expect(dedupeEstimateRowsByFirstOccurrence(rows, 2)).toEqual([
      { estimateId: 'e1', x: 1 },
      { estimateId: 'e2', x: 2 },
    ]);
  });

  it('threads tenantId into prisma delegates', async () => {
    const findManyTimeline = vi.fn().mockResolvedValue([]);
    const findManyEstimate = vi.fn().mockResolvedValue([]);

    await getDashboardQuoteAttention('tenant-z', {
      estimateTimelineEvent: { findMany: findManyTimeline },
      estimate: { findMany: findManyEstimate },
    });

    expect(findManyTimeline).toHaveBeenCalledTimes(2);
    for (const call of findManyTimeline.mock.calls) {
      expect(call[0]?.where?.tenantId).toBe('tenant-z');
    }
    expect(findManyEstimate).toHaveBeenCalledTimes(1);
    expect(findManyEstimate.mock.calls[0]?.[0]?.where?.tenantId).toBe('tenant-z');
    expect(findManyEstimate.mock.calls[0]?.[0]?.where?.status).toBe(EstimateStatus.SENT);
    expect(findManyEstimate.mock.calls[0]?.[0]?.where?.quoteLinks?.some?.tenantId).toBe(
      'tenant-z'
    );
  });

  it('maps awaiting estimates without leaking adjacent tenants', async () => {
    const now = new Date('2026-06-01T12:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const findManyTimeline = vi.fn().mockResolvedValue([]);
    const findManyEstimate = vi.fn().mockResolvedValue([
      {
        id: 'est1',
        number: 'N1',
        title: 'T',
        updatedAt: now,
        client: { companyName: 'ACME' },
        quoteLinks: [{ createdAt: new Date('2026-05-01T12:00:00Z') }],
      },
    ]);

    const res = await getDashboardQuoteAttention('tenant-a', {
      estimateTimelineEvent: { findMany: findManyTimeline },
      estimate: { findMany: findManyEstimate },
    });

    expect(res.awaitingCustomerResponse).toHaveLength(1);
    expect(res.awaitingCustomerResponse[0]?.estimateId).toBe('est1');

    vi.useRealTimers();
  });

  it('dedupes accepted timeline duplicates per estimate', async () => {
    const now = new Date('2026-06-01T12:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const acceptCalls = vi.fn().mockResolvedValue([
      {
        createdAt: new Date('2026-05-02T12:00:00Z'),
        estimate: {
          id: 'same',
          number: 'N',
          title: 'T',
          client: { companyName: 'ACME' },
        },
      },
      {
        createdAt: new Date('2026-05-03T12:00:00Z'),
        estimate: {
          id: 'same',
          number: 'N',
          title: 'T',
          client: { companyName: 'ACME' },
        },
      },
    ]);

    const findManyTimeline = vi
      .fn()
      .mockImplementation(async (args: { where: { kind: EstimateTimelineKind } }) => {
        if (args.where.kind === EstimateTimelineKind.QUOTE_ACCEPTED) return acceptCalls();
        return [];
      });

    const res = await getDashboardQuoteAttention('tenant-x', {
      estimateTimelineEvent: { findMany: findManyTimeline },
      estimate: { findMany: vi.fn().mockResolvedValue([]) },
    });

    expect(res.recentlyAccepted).toHaveLength(1);

    vi.useRealTimers();
  });
});
