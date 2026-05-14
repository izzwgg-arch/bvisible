import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/audit', () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/po/uploads', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/po/uploads')>();
  return {
    ...orig,
    resolveAttachmentPath: vi.fn(() => '/tmp/fake-upload.bin'),
    detectMimeFromBytes: vi.fn(() => ({ mime: 'image/jpeg', extHint: 'jpg' })),
  };
});

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  open: vi.fn(),
  unlink: vi.fn(),
}));

import { finalizeMobileUploadResponse } from './finalize-mobile-upload';
import type { MobileAuthContext } from './require-mobile-bearer';
import { POAttachmentKind } from '@bvisible/db';

const auth: MobileAuthContext = {
  tenantId: 't1',
  userId: 'u1',
  role: 'ADMIN',
  sessionId: 's1',
};

describe('finalizeMobileUploadResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns replay payload when pending already completed', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const prismaClient = {
      mobilePendingUpload: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'up1',
          tenantId: 't1',
          userId: 'u1',
          purchaseOrderId: 'po1',
          storageKey: 'sk1',
          kind: POAttachmentKind.RECEIPT,
          originalFilename: 'a.jpg',
          declaredSizeBytes: 100,
          expiresAt,
          completedAt: new Date(),
          revokedAt: null,
        }),
      },
      pOAttachment: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'att1',
          mimeType: 'image/jpeg',
          sizeBytes: 100,
          kind: POAttachmentKind.RECEIPT,
        }),
      },
      purchaseOrder: { findFirst: vi.fn() },
      $transaction: vi.fn(),
    };

    const res = await finalizeMobileUploadResponse({
      prismaClient: prismaClient as never,
      auth,
      uploadId: 'up1',
      req: new Request('http://localhost'),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.idempotentReplay).toBe(true);
    expect(body.data.attachmentId).toBe('att1');
    expect(prismaClient.$transaction).not.toHaveBeenCalled();
  });

  it('returns idempotent replay when transaction races but attachment exists', async () => {
    const { stat, open } = await import('node:fs/promises');
    vi.mocked(stat).mockResolvedValue({
      isFile: () => true,
      size: 100,
    } as never);
    vi.mocked(open).mockResolvedValue({
      read: vi.fn().mockResolvedValue({ bytesRead: 64 }),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    const expiresAt = new Date(Date.now() + 60_000);
    const prismaClient = {
      mobilePendingUpload: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'up1',
          tenantId: 't1',
          userId: 'u1',
          purchaseOrderId: 'po1',
          storageKey: 'sk1',
          kind: POAttachmentKind.RECEIPT,
          originalFilename: 'a.jpg',
          declaredSizeBytes: 100,
          expiresAt,
          completedAt: null,
          revokedAt: null,
        }),
      },
      purchaseOrder: {
        findFirst: vi.fn().mockResolvedValue({ id: 'po1', number: 'PO-1' }),
      },
      pOAttachment: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'attRace',
          mimeType: 'image/jpeg',
          sizeBytes: 100,
          kind: POAttachmentKind.RECEIPT,
        }),
      },
      $transaction: vi.fn().mockRejectedValue(new Error('race')),
    };

    const res = await finalizeMobileUploadResponse({
      prismaClient: prismaClient as never,
      auth,
      uploadId: 'up1',
      req: new Request('http://localhost'),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.idempotentReplay).toBe(true);
    expect(body.data.attachmentId).toBe('attRace');
  });
});
