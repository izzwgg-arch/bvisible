import { describe, expect, it, vi } from 'vitest';
import { EstimateLineKind } from '@bvisible/db';

import { renderEstimateQuoteEmail } from '@/lib/emails/estimate-quote';
import {
  generateRawQuoteToken,
  hashQuoteToken,
  isPlausibleQuoteToken,
  timingSafeEqualHex,
} from '@/lib/estimate/quote-link-crypto';
import { resolvePublicQuoteByRawToken } from '@/lib/estimate/load-public-quote';
import { issueEstimateQuoteLink } from '@/lib/estimate/quote-link-issue';
import * as quoteCrypto from '@/lib/estimate/quote-link-crypto';

describe('quote-link-crypto', () => {
  it('generates plausible base64url tokens', () => {
    const a = generateRawQuoteToken();
    const b = generateRawQuoteToken();
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(a).not.toBe(b);
    expect(isPlausibleQuoteToken(a)).toBe(true);
  });

  it('rejects garbage tokens without querying shape assumptions', () => {
    expect(isPlausibleQuoteToken('')).toBe(false);
    expect(isPlausibleQuoteToken('short')).toBe(false);
    expect(isPlausibleQuoteToken(`${'a'.repeat(39)}`)).toBe(false);
    expect(isPlausibleQuoteToken(`${'a'.repeat(65)}`)).toBe(false);
    expect(isPlausibleQuoteToken(`${'a'.repeat(43)}../`)).toBe(false);
  });

  it('hashes deterministically as sha256 hex', () => {
    const t = `${'x'.repeat(43)}`;
    expect(hashQuoteToken(t)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashQuoteToken(t)).toBe(hashQuoteToken(t));
  });

  it('compares hex digests in constant time', () => {
    const h =
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect(timingSafeEqualHex(h, h)).toBe(true);
    expect(
      timingSafeEqualHex(
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      )
    ).toBe(false);
    expect(timingSafeEqualHex('deadbeef', 'deadbeef')).toBe(false);
  });
});

describe('issueEstimateQuoteLink', () => {
  it('revokes active rows then inserts a new token hash', async () => {
    const fixedRaw =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz01';
    vi.spyOn(quoteCrypto, 'generateRawQuoteToken').mockReturnValue(fixedRaw);

    const txStub = {
      estimateQuoteLink: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({ id: 'new' }),
      },
    };

    const prismaMock = {
      $transaction: vi.fn(async (fn: (tx: typeof txStub) => Promise<void>) => {
        await fn(txStub);
      }),
    };

    await issueEstimateQuoteLink({
      prisma: prismaMock as never,
      tenantId: 't1',
      estimateId: 'e1',
      createdById: 'u1',
      expiresAt: null,
    });

    expect(txStub.estimateQuoteLink.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', estimateId: 'e1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });

    expect(txStub.estimateQuoteLink.create).toHaveBeenCalledWith({
      data: {
        tenantId: 't1',
        estimateId: 'e1',
        tokenHash: hashQuoteToken(fixedRaw),
        expiresAt: null,
        createdById: 'u1',
      },
    });

    vi.restoreAllMocks();
  });
});

function minimalValidLinkRow(
  overrides: Partial<{ revokedAt: Date | null; expiresAt: Date | null }> = {}
) {
  return {
    id: 'link1',
    tenantId: 'ten1',
    estimateId: 'est1',
    revokedAt: null as Date | null,
    expiresAt: null as Date | null,
    estimate: {
      deletedAt: null,
      number: 'EST-000001',
      title: 'Sign package',
      notes: 'Please confirm colors.',
      subtotalCostCents: 10_000,
      finalPriceCents: 30_000,
      updatedAt: new Date('2026-05-01T12:00:00Z'),
      tenant: { name: 'Shop Inc' },
      client: {
        companyName: 'Buyer LLC',
        contactName: 'Sam',
        email: 'sam@buyer.test',
        phone: '555-0100',
      },
      lines: [
        {
          id: 'ln1',
          description: 'Banner',
          qtyMilli: 1000,
          kind: EstimateLineKind.MISC,
          computedCostCents: 10_000,
        },
      ],
    },
    ...overrides,
  };
}

describe('resolvePublicQuoteByRawToken', () => {
  it('returns null when token shape is invalid', async () => {
    const prismaMock = { estimateQuoteLink: { findUnique: vi.fn() } };
    await expect(
      resolvePublicQuoteByRawToken(prismaMock as never, '!!!')
    ).resolves.toBeNull();
    expect(prismaMock.estimateQuoteLink.findUnique).not.toHaveBeenCalled();
  });

  it('returns null when revoked', async () => {
    const prismaMock = {
      estimateQuoteLink: {
        findUnique: vi.fn().mockResolvedValue(
          minimalValidLinkRow({ revokedAt: new Date() })
        ),
      },
    };
    const raw = generateRawQuoteToken();
    await expect(
      resolvePublicQuoteByRawToken(prismaMock as never, raw)
    ).resolves.toBeNull();
  });

  it('returns null when expired', async () => {
    const prismaMock = {
      estimateQuoteLink: {
        findUnique: vi.fn().mockResolvedValue(
          minimalValidLinkRow({
            expiresAt: new Date('2020-01-01T00:00:00Z'),
          })
        ),
      },
    };
    const raw = generateRawQuoteToken();
    await expect(
      resolvePublicQuoteByRawToken(prismaMock as never, raw)
    ).resolves.toBeNull();
  });

  it('returns null when estimate is soft-deleted', async () => {
    const row = minimalValidLinkRow();
    const prismaMock = {
      estimateQuoteLink: {
        findUnique: vi.fn().mockResolvedValue({
          ...row,
          estimate: { ...row.estimate, deletedAt: new Date() },
        }),
      },
    };
    const raw = generateRawQuoteToken();
    await expect(
      resolvePublicQuoteByRawToken(prismaMock as never, raw)
    ).resolves.toBeNull();
  });

  it('returns customer-safe lines without unit costs', async () => {
    const prismaMock = {
      estimateQuoteLink: {
        findUnique: vi.fn().mockResolvedValue(minimalValidLinkRow()),
      },
    };
    const raw = generateRawQuoteToken();
    vi.spyOn(quoteCrypto, 'hashQuoteToken').mockReturnValue('deadbeef');
    const quote = await resolvePublicQuoteByRawToken(prismaMock as never, raw);
    vi.restoreAllMocks();
    expect(quote).not.toBeNull();
    expect(quote!.lines).toHaveLength(1);
    const row = quote!.lines[0]!;
    expect(row).not.toHaveProperty('unitCostCents');
    expect(row).not.toHaveProperty('computedCostCents');
    expect(row.lineSellCents).toBeGreaterThan(0);
    expect(quote!.totalSellCents).toBe(30_000);
  });
});

describe('renderEstimateQuoteEmail', () => {
  it('embeds the public quote URL for customers', () => {
    const mail = renderEstimateQuoteEmail({
      companyName: 'Shop Inc',
      estimateNumber: 'EST-1',
      title: 'Work',
      quoteUrl: 'https://bv.example/quote/RAWTOKEN',
      contactName: null,
    });
    expect(mail.html).toContain('https://bv.example/quote/RAWTOKEN');
    expect(mail.text).toContain('https://bv.example/quote/RAWTOKEN');
    expect(mail.html).not.toContain('Sign in to your B Visible workspace');
  });
});
