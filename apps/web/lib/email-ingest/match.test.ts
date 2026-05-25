import { describe, expect, it, vi, beforeEach } from 'vitest';
import { POStatus } from '@bvisible/db';
import type { ParsedEmail } from './parse';
import { matchEmail, type MatchResult } from './match';

const tenantId = 'tenant1';

function baseEmail(over: Partial<ParsedEmail> = {}): ParsedEmail {
  return {
    messageId: '<msg@id>',
    fromAddress: 'vendor@vendor.com',
    fromName: 'Vendor',
    toAddress: null,
    subject: 'Hello',
    receivedAt: new Date('2025-01-15T12:00:00Z'),
    bodyTextSnippet: '',
    attachments: [],
    ...over,
  };
}

type PoRow = {
  id: string;
  tenantId: string;
  number: string;
  qboPoNumber: string | null;
  vendorId: string;
  status: POStatus;
  updatedAt: Date;
  deletedAt: Date | null;
};

const mock = vi.hoisted(() => {
  let purchases: PoRow[] = [];
  let vendors: { id: string; email: string; tenantId: string }[] = [];

  const openStatuses = ['SENT', 'ORDERED', 'PARTIALLY_RECEIVED'] as const;

  const prisma = {
    purchaseOrder: {
      findMany: vi.fn(async (args: { where: any; take?: number }) => {
        const w = args.where;
        if (w.number?.in) {
          return purchases.filter(
            (p) =>
              p.tenantId === w.tenantId &&
              !p.deletedAt &&
              w.number.in.includes(p.number),
          );
        }
        if (w.qboPoNumber?.in) {
          return purchases.filter(
            (p) =>
              p.tenantId === w.tenantId &&
              !p.deletedAt &&
              p.qboPoNumber &&
              w.qboPoNumber.in.includes(p.qboPoNumber),
          );
        }
        if (w.vendorId) {
          const since = w.updatedAt.gte.getTime();
          return purchases
            .filter(
              (p) =>
                p.tenantId === w.tenantId &&
                !p.deletedAt &&
                p.vendorId === w.vendorId &&
                openStatuses.includes(p.status as (typeof openStatuses)[number]) &&
                new Date(p.updatedAt).getTime() >= since,
            )
            .sort(
              (a, b) =>
                new Date(b.updatedAt).getTime() -
                new Date(a.updatedAt).getTime(),
            )
            .slice(0, args.take ?? 99);
        }
        return [];
      }),
    },
    vendor: {
      findFirst: vi.fn(async ({ where }: { where: { tenantId: string; email: string } }) => {
        return (
          vendors.find(
            (v) => v.tenantId === where.tenantId && v.email === where.email,
          ) ?? null
        );
      }),
    },
  };

  return {
    prisma,
    setPurchases: (rows: PoRow[]) => {
      purchases = rows;
    },
    setVendors: (rows: { id: string; email: string; tenantId: string }[]) => {
      vendors = rows;
    },
  };
});

vi.mock('@bvisible/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bvisible/db')>();
  return {
    ...actual,
    prisma: mock.prisma,
  };
});

describe('matchEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.setPurchases([]);
    mock.setVendors([]);
  });

  it('matches internal PO number in subject (single hit)', async () => {
    mock.setPurchases([
      {
        id: 'po1',
        tenantId,
        number: 'PO-1001',
        qboPoNumber: null,
        vendorId: 'v1',
        status: POStatus.SENT,
        updatedAt: new Date('2025-01-10'),
        deletedAt: null,
      },
    ]);
    mock.setVendors([{ id: 'v1', email: 'vendor@vendor.com', tenantId }]);
    const r = await matchEmail({
      tenantId,
      attachmentNames: [],
      email: baseEmail({ subject: 'Re: PO-1001 quote' }),
    });
    expectPo(r, 'po1', 'PO_NUMBER');
  });

  it('matches internal PO number in body when subject has none', async () => {
    mock.setPurchases([
      {
        id: 'po2',
        tenantId,
        number: 'PO-2002',
        qboPoNumber: null,
        vendorId: 'v1',
        status: POStatus.SENT,
        updatedAt: new Date('2025-01-10'),
        deletedAt: null,
      },
    ]);
    mock.setVendors([{ id: 'v1', email: 'vendor@vendor.com', tenantId }]);
    const r = await matchEmail({
      tenantId,
      attachmentNames: [],
      email: baseEmail({
        subject: 'Invoice attached',
        bodyTextSnippet: 'Please see invoice for PO-2002',
      }),
    });
    expectPo(r, 'po2', 'PO_NUMBER');
  });

  it('matches QBO PO number when no internal token', async () => {
    mock.setPurchases([
      {
        id: 'poq',
        tenantId,
        number: 'PO-3003',
        qboPoNumber: 'QBO-7788',
        vendorId: 'v1',
        status: POStatus.SENT,
        updatedAt: new Date('2025-01-10'),
        deletedAt: null,
      },
    ]);
    mock.setVendors([{ id: 'v1', email: 'vendor@vendor.com', tenantId }]);
    const r = await matchEmail({
      tenantId,
      attachmentNames: [],
      email: baseEmail({ subject: 'Ref QBO-7788' }),
    });
    expectPo(r, 'poq', 'QBO_NUMBER');
  });

  it('prefers internal PO when both internal and QBO tokens exist', async () => {
    mock.setPurchases([
      {
        id: 'poInt',
        tenantId,
        number: 'PO-4004',
        qboPoNumber: 'QBO-9999',
        vendorId: 'v1',
        status: POStatus.SENT,
        updatedAt: new Date('2025-01-10'),
        deletedAt: null,
      },
    ]);
    mock.setVendors([{ id: 'v1', email: 'vendor@vendor.com', tenantId }]);
    const r = await matchEmail({
      tenantId,
      attachmentNames: [],
      email: baseEmail({ subject: 'PO-4004 and QBO-9999' }),
    });
    expectPo(r, 'poInt', 'PO_NUMBER');
  });

  it('matches internal PO token inside attachment filename', async () => {
    mock.setPurchases([
      {
        id: 'attPo',
        tenantId,
        number: 'PO-1234',
        qboPoNumber: null,
        vendorId: 'v1',
        status: POStatus.SENT,
        updatedAt: new Date('2020-01-01'),
        deletedAt: null,
      },
    ]);
    mock.setVendors([{ id: 'v1', email: 'vendor@vendor.com', tenantId }]);
    const r = await matchEmail({
      tenantId,
      attachmentNames: ['invoice-PO-1234.pdf'],
      email: baseEmail({ subject: 'See attached', bodyTextSnippet: '' }),
    });
    expectPo(r, 'attPo', 'PO_NUMBER');
  });

  it('returns NONE when body has two PO tokens and subject has none', async () => {
    mock.setPurchases([
      {
        id: 'a',
        tenantId,
        number: 'PO-9101',
        qboPoNumber: null,
        vendorId: 'v1',
        status: POStatus.SENT,
        updatedAt: new Date('2025-01-10'),
        deletedAt: null,
      },
      {
        id: 'b',
        tenantId,
        number: 'PO-9102',
        qboPoNumber: null,
        vendorId: 'v1',
        status: POStatus.SENT,
        updatedAt: new Date('2025-01-09'),
        deletedAt: null,
      },
    ]);
    mock.setVendors([{ id: 'v1', email: 'vendor@vendor.com', tenantId }]);
    const r = await matchEmail({
      tenantId,
      attachmentNames: [],
      email: baseEmail({
        subject: 'Please review',
        bodyTextSnippet: 'Refs PO-9101 and PO-9102 in the thread.',
      }),
    });
    expectNone(r, 'v1', ['MULTIPLE_PO_MATCHES']);
  });

  it('returns NONE when multiple internal PO numbers match different rows', async () => {
    mock.setPurchases([
      {
        id: 'a',
        tenantId,
        number: 'PO-5001',
        qboPoNumber: null,
        vendorId: 'v1',
        status: POStatus.SENT,
        updatedAt: new Date('2025-01-10'),
        deletedAt: null,
      },
      {
        id: 'b',
        tenantId,
        number: 'PO-5002',
        qboPoNumber: null,
        vendorId: 'v1',
        status: POStatus.SENT,
        updatedAt: new Date('2025-01-09'),
        deletedAt: null,
      },
    ]);
    mock.setVendors([{ id: 'v1', email: 'vendor@vendor.com', tenantId }]);
    const r = await matchEmail({
      tenantId,
      attachmentNames: [],
      email: baseEmail({ subject: 'PO-5001 and PO-5002 combined' }),
    });
    expectNone(r, 'v1', ['MULTIPLE_PO_MATCHES']);
  });

  it('returns NONE when multiple QBO tokens match different rows', async () => {
    mock.setPurchases([
      {
        id: 'q1',
        tenantId,
        number: 'PO-1',
        qboPoNumber: 'ABC-111',
        vendorId: 'v1',
        status: POStatus.SENT,
        updatedAt: new Date('2025-01-10'),
        deletedAt: null,
      },
      {
        id: 'q2',
        tenantId,
        number: 'PO-2',
        qboPoNumber: 'ABC-222',
        vendorId: 'v1',
        status: POStatus.SENT,
        updatedAt: new Date('2025-01-09'),
        deletedAt: null,
      },
    ]);
    mock.setVendors([{ id: 'v1', email: 'vendor@vendor.com', tenantId }]);
    const r = await matchEmail({
      tenantId,
      attachmentNames: [],
      email: baseEmail({ subject: 'ABC-111 vs ABC-222' }),
    });
    expectNone(r, 'v1', ['MULTIPLE_QBO_MATCHES']);
  });

  it('matches vendor + exactly one recent open PO', async () => {
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    mock.setPurchases([
      {
        id: 'only',
        tenantId,
        number: 'PO-6001',
        qboPoNumber: null,
        vendorId: 'v1',
        status: POStatus.SENT,
        updatedAt: recent,
        deletedAt: null,
      },
    ]);
    mock.setVendors([{ id: 'v1', email: 'vendor@vendor.com', tenantId }]);
    const r = await matchEmail({
      tenantId,
      attachmentNames: [],
      email: baseEmail({ subject: 'Hello', bodyTextSnippet: 'no po token' }),
    });
    expectPo(r, 'only', 'VENDOR_AND_RECENT');
  });

  it('returns NONE when vendor has multiple recent open POs', async () => {
    const t1 = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const t2 = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    mock.setPurchases([
      {
        id: 'x1',
        tenantId,
        number: 'PO-7001',
        qboPoNumber: null,
        vendorId: 'v1',
        status: POStatus.SENT,
        updatedAt: t1,
        deletedAt: null,
      },
      {
        id: 'x2',
        tenantId,
        number: 'PO-7002',
        qboPoNumber: null,
        vendorId: 'v1',
        status: POStatus.SENT,
        updatedAt: t2,
        deletedAt: null,
      },
    ]);
    mock.setVendors([{ id: 'v1', email: 'vendor@vendor.com', tenantId }]);
    const r = await matchEmail({
      tenantId,
      attachmentNames: [],
      email: baseEmail({ subject: 'FYI' }),
    });
    expectNone(r, 'v1', ['MULTIPLE_VENDOR_PO_CANDIDATES']);
  });

  it('returns NONE for unknown PO number (no DB row)', async () => {
    mock.setPurchases([]);
    mock.setVendors([{ id: 'v1', email: 'vendor@vendor.com', tenantId }]);
    const r = await matchEmail({
      tenantId,
      attachmentNames: [],
      email: baseEmail({ subject: 'PO-99999999' }),
    });
    expectNone(r, 'v1', ['UNKNOWN_PO']);
  });

  it('returns NONE without PO token and multiple vendor POs', async () => {
    const t1 = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const t2 = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    mock.setPurchases([
      {
        id: 'm1',
        tenantId,
        number: 'PO-8001',
        qboPoNumber: null,
        vendorId: 'v1',
        status: POStatus.SENT,
        updatedAt: t1,
        deletedAt: null,
      },
      {
        id: 'm2',
        tenantId,
        number: 'PO-8002',
        qboPoNumber: null,
        vendorId: 'v1',
        status: POStatus.SENT,
        updatedAt: t2,
        deletedAt: null,
      },
    ]);
    mock.setVendors([{ id: 'v1', email: 'vendor@vendor.com', tenantId }]);
    const r = await matchEmail({
      tenantId,
      attachmentNames: [],
      email: baseEmail({ subject: 'No reference here' }),
    });
    expectNone(r, 'v1', ['MULTIPLE_VENDOR_PO_CANDIDATES']);
  });
});

function expectPo(
  r: MatchResult,
  purchaseOrderId: string,
  reason: MatchResult['reason'],
) {
  expect(r.reason).toBe(reason);
  expect(r.purchaseOrderId).toBe(purchaseOrderId);
}

function expectNone(
  r: MatchResult,
  vendorId: string | null,
  matcherCodes?: string[],
) {
  expect(r.reason).toBe('NONE');
  expect(r.purchaseOrderId).toBeNull();
  expect(r.vendorId).toBe(vendorId);
  if (matcherCodes) {
    expect([...(r.matcherReviewCodes ?? [])].sort()).toEqual(
      [...matcherCodes].sort(),
    );
  }
}
