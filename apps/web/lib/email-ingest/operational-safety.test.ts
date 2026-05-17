import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { safeOriginalFilename } from '@/lib/po/uploads';
import { emailAttachmentDedupeKey } from './run';

describe('emailAttachmentDedupeKey', () => {
  it('collapses identical filename+bytes', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const n = safeOriginalFilename('x/../evil.pdf');
    const a = emailAttachmentDedupeKey(n, bytes);
    const b = emailAttachmentDedupeKey(n, bytes);
    expect(a).toBe(b);
    expect(a).toContain(createHash('sha256').update(bytes).digest('hex'));
  });

  it('differs when bytes differ', () => {
    const n = safeOriginalFilename('doc.pdf');
    const a = emailAttachmentDedupeKey(n, new Uint8Array([1]));
    const b = emailAttachmentDedupeKey(n, new Uint8Array([2]));
    expect(a).not.toBe(b);
  });
});
