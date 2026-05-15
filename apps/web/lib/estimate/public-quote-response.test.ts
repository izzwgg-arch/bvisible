import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EstimateStatus, EstimateTimelineKind } from '@bvisible/db';

import { writeAuditLog } from '@/lib/auth/audit';
import {
  classifyQuoteResponseRace,
  executePublicQuoteCustomerResponse,
  estimateStatusAfterPublicAccept,
  estimateStatusAfterPublicDecline,
  truncateResponseIp,
  truncateResponseUserAgent,
} from '@/lib/estimate/execute-public-quote-response';

vi.mock('@/lib/auth/audit', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

function makeLinkRow(
  overrides: Partial<{
    respondedAt: Date | null;
    acceptedAt: Date | null;
    declinedAt: Date | null;
    revokedAt: Date | null;
    expiresAt: Date | null;
    estimateStatus: EstimateStatus;
  }> = {}
) {
  const responded = overrides.respondedAt ?? null;
  return {
    id: 'L1',
    tenantId: 'T1',
    estimateId: 'E1',
    revokedAt: overrides.revokedAt ?? null,
    expiresAt: overrides.expiresAt ?? null,
    respondedAt: responded,
    acceptedAt: overrides.acceptedAt ?? null,
    declinedAt: overrides.declinedAt ?? null,
    estimate: {
      id: 'E1',
      tenantId: 'T1',
      deletedAt: null,
      status: overrides.estimateStatus ?? EstimateStatus.SENT,
      number: 'EST-42',
    },
  };
}

/** Len 40 — passes `isPlausibleQuoteToken` lower bound. */
const RAW_TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789abcd';

describe('public quote response helpers', () => {
  it('truncates ip and user-agent for storage', () => {
    expect(truncateResponseIp('203.0.113.45')).toBe('203.0.113.45');
    expect(truncateResponseUserAgent('Mozilla/5.0 (Windows NT 10.0)')).toContain('Mozilla');
  });

  it('classifies races', () => {
    expect(classifyQuoteResponseRace('accept', { acceptedAt: new Date(), declinedAt: null })).toBe(
      'idempotent'
    );
    expect(classifyQuoteResponseRace('decline', { acceptedAt: new Date(), declinedAt: null })).toBe(
      'opposite'
    );
    expect(classifyQuoteResponseRace('decline', { acceptedAt: null, declinedAt: new Date() })).toBe(
      'idempotent'
    );
  });

  it('maps estimate statuses for public transitions', () => {
    expect(estimateStatusAfterPublicAccept()).toBe(EstimateStatus.APPROVED);
    expect(estimateStatusAfterPublicDecline()).toBe(EstimateStatus.REJECTED);
  });
});

describe('executePublicQuoteCustomerResponse', () => {
  beforeEach(() => {
    vi.mocked(writeAuditLog).mockClear();
  });

  it('records accept once with timeline + audit', async () => {
    const row = makeLinkRow();
    const timelineCreates: unknown[] = [];
    const tx = {
      estimateQuoteLink: {
        findUnique: vi.fn().mockResolvedValue(row),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      estimate: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      estimateTimelineEvent: {
        create: vi.fn((args: { data: unknown }) => {
          timelineCreates.push(args.data);
          return {};
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    const res = await executePublicQuoteCustomerResponse({
      prisma: prisma as never,
      rawToken: RAW_TOKEN,
      intent: 'accept',
      customerName: 'Alex',
      customerNote: 'Please proceed',
      ctx: { ipAddress: '198.51.100.10', userAgent: 'vitest' },
    });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.outcome).toBe('recorded');
    expect(timelineCreates).toHaveLength(1);
    expect((timelineCreates[0] as { kind: string }).kind).toBe(EstimateTimelineKind.QUOTE_ACCEPTED);
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeAuditLog).mock.calls[0]![0]!.action).toBe('estimate_quote_accepted');
  });

  it('records decline once with timeline + audit', async () => {
    const row = makeLinkRow();
    const timelineCreates: unknown[] = [];
    const tx = {
      estimateQuoteLink: {
        findUnique: vi.fn().mockResolvedValue(row),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      estimate: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      estimateTimelineEvent: {
        create: vi.fn((args: { data: unknown }) => {
          timelineCreates.push(args.data);
          return {};
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    const res = await executePublicQuoteCustomerResponse({
      prisma: prisma as never,
      rawToken: RAW_TOKEN,
      intent: 'decline',
      customerName: 'Sam',
      customerNote: null,
      ctx: { ipAddress: null, userAgent: null },
    });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.outcome).toBe('recorded');
    expect(timelineCreates).toHaveLength(1);
    expect((timelineCreates[0] as { kind: string }).kind).toBe(EstimateTimelineKind.QUOTE_DECLINED);
    expect(writeAuditLog).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeAuditLog).mock.calls[0]![0]!.action).toBe('estimate_quote_declined');
  });

  it('accept idempotent does not emit audit or timeline', async () => {
    const responded = new Date();
    const row = makeLinkRow({
      respondedAt: responded,
      acceptedAt: responded,
    });
    const tx = {
      estimateQuoteLink: { findUnique: vi.fn().mockResolvedValue(row) },
      estimate: { updateMany: vi.fn() },
      estimateTimelineEvent: { create: vi.fn() },
    };
    const prisma = { $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };

    const res = await executePublicQuoteCustomerResponse({
      prisma: prisma as never,
      rawToken: RAW_TOKEN,
      intent: 'accept',
      customerName: null,
      customerNote: null,
      ctx: { ipAddress: null, userAgent: null },
    });

    expect(res.ok && res.outcome === 'idempotent').toBe(true);
    expect(tx.estimateTimelineEvent.create).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('decline idempotent does not emit audit or timeline', async () => {
    const responded = new Date();
    const row = makeLinkRow({
      respondedAt: responded,
      declinedAt: responded,
    });
    const tx = {
      estimateQuoteLink: { findUnique: vi.fn().mockResolvedValue(row) },
      estimate: { updateMany: vi.fn() },
      estimateTimelineEvent: { create: vi.fn() },
    };
    const prisma = { $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };

    const res = await executePublicQuoteCustomerResponse({
      prisma: prisma as never,
      rawToken: RAW_TOKEN,
      intent: 'decline',
      customerName: null,
      customerNote: null,
      ctx: { ipAddress: null, userAgent: null },
    });

    expect(res.ok && res.outcome === 'idempotent').toBe(true);
    expect(tx.estimateTimelineEvent.create).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('blocks opposite accept after decline', async () => {
    const responded = new Date();
    const row = makeLinkRow({
      respondedAt: responded,
      declinedAt: responded,
    });
    const tx = {
      estimateQuoteLink: { findUnique: vi.fn().mockResolvedValue(row) },
      estimate: { updateMany: vi.fn() },
      estimateTimelineEvent: { create: vi.fn() },
    };
    const prisma = { $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };

    const res = await executePublicQuoteCustomerResponse({
      prisma: prisma as never,
      rawToken: RAW_TOKEN,
      intent: 'accept',
      customerName: null,
      customerNote: null,
      ctx: { ipAddress: null, userAgent: null },
    });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.code).toBe('opposite_response');
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('blocks opposite action after accept', async () => {
    const responded = new Date();
    const row = makeLinkRow({
      respondedAt: responded,
      acceptedAt: responded,
    });
    const tx = {
      estimateQuoteLink: { findUnique: vi.fn().mockResolvedValue(row) },
      estimate: { updateMany: vi.fn() },
      estimateTimelineEvent: { create: vi.fn() },
    };
    const prisma = { $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };

    const res = await executePublicQuoteCustomerResponse({
      prisma: prisma as never,
      rawToken: RAW_TOKEN,
      intent: 'decline',
      customerName: null,
      customerNote: null,
      ctx: { ipAddress: null, userAgent: null },
    });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.code).toBe('opposite_response');
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('blocks finalized estimates', async () => {
    const row = makeLinkRow({ estimateStatus: EstimateStatus.FINALIZED });
    const tx = {
      estimateQuoteLink: { findUnique: vi.fn().mockResolvedValue(row) },
      estimate: { updateMany: vi.fn() },
      estimateTimelineEvent: { create: vi.fn() },
    };
    const prisma = { $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };

    const res = await executePublicQuoteCustomerResponse({
      prisma: prisma as never,
      rawToken: RAW_TOKEN,
      intent: 'accept',
      customerName: null,
      customerNote: null,
      ctx: { ipAddress: null, userAgent: null },
    });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.code).toBe('finalized_blocked');
  });

  it('rejects revoked links', async () => {
    const row = makeLinkRow({ revokedAt: new Date() });
    const tx = {
      estimateQuoteLink: { findUnique: vi.fn().mockResolvedValue(row) },
      estimate: { updateMany: vi.fn() },
      estimateTimelineEvent: { create: vi.fn() },
    };
    const prisma = { $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };

    const res = await executePublicQuoteCustomerResponse({
      prisma: prisma as never,
      rawToken: RAW_TOKEN,
      intent: 'decline',
      customerName: null,
      customerNote: null,
      ctx: { ipAddress: null, userAgent: null },
    });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.code).toBe('link_unavailable');
  });

  it('rejects expired links', async () => {
    const row = makeLinkRow({ expiresAt: new Date('2001-01-01') });
    const tx = {
      estimateQuoteLink: { findUnique: vi.fn().mockResolvedValue(row) },
      estimate: { updateMany: vi.fn() },
      estimateTimelineEvent: { create: vi.fn() },
    };
    const prisma = { $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };

    const res = await executePublicQuoteCustomerResponse({
      prisma: prisma as never,
      rawToken: RAW_TOKEN,
      intent: 'accept',
      customerName: null,
      customerNote: null,
      ctx: { ipAddress: null, userAgent: null },
    });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.code).toBe('link_unavailable');
  });

  it('reject implausible tokens early', async () => {
    const prisma = { $transaction: vi.fn() };
    const res = await executePublicQuoteCustomerResponse({
      prisma: prisma as never,
      rawToken: 'nope',
      intent: 'accept',
      customerName: null,
      customerNote: null,
      ctx: { ipAddress: null, userAgent: null },
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.code).toBe('invalid_token');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
