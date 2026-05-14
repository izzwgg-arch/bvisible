import { describe, it, expect } from 'vitest';
import { POAttachmentKind } from '@bvisible/db';
import { parseMobileUploadKind } from './upload-kind';

describe('parseMobileUploadKind', () => {
  it('maps supported mobile kinds', () => {
    expect(parseMobileUploadKind('RECEIPT')).toBe(POAttachmentKind.RECEIPT);
    expect(parseMobileUploadKind('INSTALL_PHOTO')).toBe(
      POAttachmentKind.INSTALL_PHOTO
    );
    expect(parseMobileUploadKind('FIELD_DOCUMENT')).toBe(
      POAttachmentKind.FIELD_DOCUMENT
    );
    expect(parseMobileUploadKind('VENDOR_INVOICE')).toBe(
      POAttachmentKind.VENDOR_INVOICE
    );
  });

  it('rejects unknown strings', () => {
    expect(parseMobileUploadKind('DRAWING')).toBeNull();
    expect(parseMobileUploadKind('')).toBeNull();
  });
});
