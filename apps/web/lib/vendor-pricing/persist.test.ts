import { POEventKind, Prisma } from '@bvisible/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runVendorPriceExtractionAfterMaterialize } from './persist';

vi.mock('@/lib/auth/audit', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

type HistRow = {
  dedupeKey: string;
  priceCents: number;
  vendorCatalogItemId: string;
  tenantId: string;
};

const mockState = vi.hoisted(() => {
  const catalogs = new Map<string, { id: string }>();
  let catSeq = 0;
  const histories: HistRow[] = [];
  const notifications: unknown[] = [];
  const events: unknown[] = [];

  const reset = (): void => {
    catalogs.clear();
    catSeq = 0;
    histories.length = 0;
    notifications.length = 0;
    events.length = 0;
    polineMutations.length = 0;
  };

  const polineMutations: string[] = [];

  const prisma = {
    vendorCatalogItem: {
      findUnique: vi.fn(
        async ({
          where: {
            tenantId_vendorId_nameNormalized: w,
          },
        }: {
          where: {
            tenantId_vendorId_nameNormalized: {
              tenantId: string;
              vendorId: string;
              nameNormalized: string;
            };
          };
        }) => {
          const key = `${w.tenantId}|${w.vendorId}|${w.nameNormalized}`;
          return catalogs.get(key) ?? null;
        }
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: {
            tenantId: string;
            vendorId: string;
            nameNormalized: string;
          };
        }) => {
          const key = `${data.tenantId}|${data.vendorId}|${data.nameNormalized}`;
          const id = `cat_${++catSeq}`;
          catalogs.set(key, { id });
          return { id };
        }
      ),
    },
    vendorItemAlias: {
      findUnique: vi.fn(async () => null),
    },
    vendorPriceHistory: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { tenantId: string; vendorCatalogItemId: string };
        }) => {
          const rows = histories.filter(
            (h) =>
              h.tenantId === where.tenantId &&
              h.vendorCatalogItemId === where.vendorCatalogItemId
          );
          const last = rows[rows.length - 1];
          return last ? { priceCents: last.priceCents } : null;
        }
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: {
            tenantId: string;
            vendorCatalogItemId: string;
            dedupeKey: string;
            priceCents: number;
          };
        }) => {
          if (histories.some((h) => h.dedupeKey === data.dedupeKey)) {
            throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
              code: 'P2002',
              clientVersion: 'test',
            });
          }
          histories.push({
            dedupeKey: data.dedupeKey,
            priceCents: data.priceCents,
            vendorCatalogItemId: data.vendorCatalogItemId,
            tenantId: data.tenantId,
          });
          return data;
        }
      ),
    },
    vendorPriceNotification: {
      create: vi.fn(async ({ data }: { data: unknown }) => {
        notifications.push(data);
        return data;
      }),
    },
    pOEvent: {
      create: vi.fn(async ({ data }: { data: unknown }) => {
        events.push(data);
        return data;
      }),
    },
    pOLineItem: {
      create: vi.fn(async () => {
        polineMutations.push('create');
        throw new Error('PO lines must not be mutated by vendor pricing');
      }),
      update: vi.fn(async () => {
        polineMutations.push('update');
        throw new Error('PO lines must not be mutated by vendor pricing');
      }),
      updateMany: vi.fn(async () => {
        polineMutations.push('updateMany');
        throw new Error('PO lines must not be mutated by vendor pricing');
      }),
      deleteMany: vi.fn(async () => {
        polineMutations.push('deleteMany');
        throw new Error('PO lines must not be mutated by vendor pricing');
      }),
    },
    get histories() {
      return histories;
    },
    get notifications() {
      return notifications;
    },
    get events() {
      return events;
    },
    get polineMutations() {
      return polineMutations;
    },
    reset,
  };

  return prisma;
});

vi.mock('@bvisible/db', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@bvisible/db')>();
  return {
    ...mod,
    prisma: mockState,
  };
});

describe('runVendorPriceExtractionAfterMaterialize (mocked prisma)', () => {
  beforeEach(() => {
    mockState.reset();
    vi.mocked(mockState.vendorCatalogItem.findUnique).mockClear();
    vi.mocked(mockState.vendorCatalogItem.create).mockClear();
    vi.mocked(mockState.vendorPriceHistory.findFirst).mockClear();
    vi.mocked(mockState.vendorPriceHistory.create).mockClear();
    vi.mocked(mockState.vendorPriceNotification.create).mockClear();
    vi.mocked(mockState.pOEvent.create).mockClear();
  });

  it('creates catalog item and history for new normalized item', async () => {
    await runVendorPriceExtractionAfterMaterialize({
      tenantId: 't1',
      vendorId: 'v1',
      ingestedEmailId: 'e1',
      purchaseOrderId: 'po1',
      actorId: 'u1',
      subject: 'PO update',
      bodyTextSnippet: 'ACM 4X8 WHITE: 200.00',
      attachments: [],
    });

    expect(mockState.vendorCatalogItem.create).toHaveBeenCalledTimes(1);
    expect(mockState.histories).toHaveLength(1);
    expect(mockState.histories[0]?.priceCents).toBe(20000);
    expect(mockState.notifications).toHaveLength(0);
  });

  it('dedupes identical extraction via dedupeKey (duplicate run)', async () => {
    const args = {
      tenantId: 't1',
      vendorId: 'v1',
      ingestedEmailId: 'e1',
      purchaseOrderId: 'po1',
      actorId: 'u1',
      subject: 'PO update',
      bodyTextSnippet: 'ACM 4X8 WHITE: 200.00',
      attachments: [],
    };

    await runVendorPriceExtractionAfterMaterialize(args);
    await runVendorPriceExtractionAfterMaterialize(args);

    expect(mockState.histories).toHaveLength(1);
  });

  it('detects lower price, creates notification and VENDOR_LOWER_PRICE POEvent', async () => {
    await runVendorPriceExtractionAfterMaterialize({
      tenantId: 't1',
      vendorId: 'v1',
      ingestedEmailId: 'e2',
      purchaseOrderId: 'po1',
      actorId: 'u1',
      subject: 'Quote',
      bodyTextSnippet: [
        'ACM 4X8 WHITE: 145.00',
        'ACM 4X8 WHITE: 125.00',
      ].join('\n'),
      attachments: [],
    });

    expect(mockState.histories).toHaveLength(2);
    expect(mockState.notifications).toHaveLength(1);
    expect(mockState.events).toHaveLength(1);
    const ev = mockState.events[0] as {
      kind: POEventKind;
      purchaseOrderId: string;
      sourceEmailId: string;
    };
    expect(ev.kind).toBe(POEventKind.VENDOR_LOWER_PRICE);
    expect(ev.purchaseOrderId).toBe('po1');
    expect(ev.sourceEmailId).toBe('e2');
  });

  it('does not touch PO line APIs', async () => {
    await runVendorPriceExtractionAfterMaterialize({
      tenantId: 't1',
      vendorId: 'v1',
      ingestedEmailId: 'e3',
      purchaseOrderId: 'po1',
      actorId: 'u1',
      subject: 'x',
      bodyTextSnippet: 'ACM 4X8 WHITE: 100.00',
      attachments: [],
    });

    expect(mockState.polineMutations).toHaveLength(0);
  });
});
