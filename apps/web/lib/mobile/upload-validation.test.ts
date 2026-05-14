import { describe, it, expect } from 'vitest';
import { detectMimeFromBytes, MAX_UPLOAD_BYTES } from '@/lib/po/uploads';
import { mobileUploadPresignSchema } from '@/lib/validators';

describe('mobile upload validation', () => {
  it('rejects oversize declared bytes', () => {
    const r = mobileUploadPresignSchema.safeParse({
      purchaseOrderId: 'po123',
      kind: 'RECEIPT',
      originalFilename: 'a.pdf',
      declaredSizeBytes: MAX_UPLOAD_BYTES + 1,
    });
    expect(r.success).toBe(false);
  });

  it('magic-byte PDF passes sniff', () => {
    const buf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    expect(detectMimeFromBytes(buf)?.mime).toBe('application/pdf');
  });
});
