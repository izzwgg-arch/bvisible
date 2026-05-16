import { mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { MAX_UPLOAD_BYTES } from '@/lib/po/uploads';
import { UnsupportedAttachmentError, persistEmailAttachment } from './storage';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

describe('persistEmailAttachment', () => {
  it('rejects oversize blobs before writing', async () => {
    const bytes = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    await expect(
      persistEmailAttachment({
        tenantId: 'tenantabc',
        ingestedEmailId: 'emailabc',
        originalFilename: 'big.pdf',
        bytes,
      }),
    ).rejects.toThrow(UnsupportedAttachmentError);
    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });
});
