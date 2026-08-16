import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  outboundCcSetting: {
    findUnique: vi.fn(),
  },
}));

vi.mock('@bvisible/db', () => ({
  prisma: prismaMock,
  OutboundDocumentType: { PURCHASE_ORDER: 'PURCHASE_ORDER' },
}));

import { loadPoCcRecipients, resolvePoCcRecipients } from './po-cc';

describe('loadPoCcRecipients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the company row for the PURCHASE_ORDER document type', async () => {
    prismaMock.outboundCcSetting.findUnique.mockResolvedValueOnce({
      emails: ['cg@bvisible.us'],
    });

    await loadPoCcRecipients('tenant-1');

    expect(prismaMock.outboundCcSetting.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_documentType: {
            tenantId: 'tenant-1',
            documentType: 'PURCHASE_ORDER',
          },
        },
      })
    );
  });

  it('returns the saved list', async () => {
    prismaMock.outboundCcSetting.findUnique.mockResolvedValueOnce({
      emails: ['cg@bvisible.us', 'lt@bvisible.us'],
    });
    await expect(loadPoCcRecipients('t1')).resolves.toEqual([
      'cg@bvisible.us',
      'lt@bvisible.us',
    ]);
  });

  it('a saved-but-empty list means no CC', async () => {
    prismaMock.outboundCcSetting.findUnique.mockResolvedValueOnce({ emails: [] });
    await expect(loadPoCcRecipients('t1')).resolves.toEqual([]);
  });

  it('no row also means no CC — never a fallback to another company list', async () => {
    prismaMock.outboundCcSetting.findUnique.mockResolvedValueOnce(null);
    await expect(loadPoCcRecipients('t1')).resolves.toEqual([]);
  });

  it('sanitizes junk written straight to the database', async () => {
    prismaMock.outboundCcSetting.findUnique.mockResolvedValueOnce({
      emails: ['cg@bvisible.us', 'not-an-email', '  lt@bvisible.us  ', 'CG@bvisible.us'],
    });
    await expect(loadPoCcRecipients('t1')).resolves.toEqual([
      'cg@bvisible.us',
      'lt@bvisible.us',
    ]);
  });
});

describe('resolvePoCcRecipients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to the saved default when no override is given', async () => {
    prismaMock.outboundCcSetting.findUnique.mockResolvedValueOnce({
      emails: ['cg@bvisible.us'],
    });
    await expect(resolvePoCcRecipients('t1')).resolves.toEqual({
      emails: ['cg@bvisible.us'],
      overridden: false,
    });
  });

  it('treats an explicit null the same as no override', async () => {
    prismaMock.outboundCcSetting.findUnique.mockResolvedValueOnce({
      emails: ['cg@bvisible.us'],
    });
    await expect(resolvePoCcRecipients('t1', null)).resolves.toEqual({
      emails: ['cg@bvisible.us'],
      overridden: false,
    });
  });

  it('uses a one-off list instead of the default', async () => {
    const r = await resolvePoCcRecipients('t1', ['owner@bvisible.us']);
    expect(r).toEqual({ emails: ['owner@bvisible.us'], overridden: true });
    // The default must not even be read — the operator already decided.
    expect(prismaMock.outboundCcSetting.findUnique).not.toHaveBeenCalled();
  });

  it('an EMPTY override means "no CC this time", not "use the default"', async () => {
    const r = await resolvePoCcRecipients('t1', []);
    expect(r).toEqual({ emails: [], overridden: true });
    expect(prismaMock.outboundCcSetting.findUnique).not.toHaveBeenCalled();
  });

  it('normalizes an override before it reaches the CC header', async () => {
    const r = await resolvePoCcRecipients('t1', [
      ' owner@bvisible.us ',
      'owner@bvisible.us',
      'bogus',
    ]);
    expect(r.emails).toEqual(['owner@bvisible.us']);
  });
});
