import { POAttachmentKind } from '@bvisible/db';

export const MOBILE_UPLOAD_KINDS = [
  'RECEIPT',
  'INSTALL_PHOTO',
  'FIELD_DOCUMENT',
  'VENDOR_INVOICE',
] as const;

export type MobileUploadKind = (typeof MOBILE_UPLOAD_KINDS)[number];

export function parseMobileUploadKind(raw: string): POAttachmentKind | null {
  switch (raw) {
    case 'RECEIPT':
      return POAttachmentKind.RECEIPT;
    case 'INSTALL_PHOTO':
      return POAttachmentKind.INSTALL_PHOTO;
    case 'FIELD_DOCUMENT':
      return POAttachmentKind.FIELD_DOCUMENT;
    case 'VENDOR_INVOICE':
      return POAttachmentKind.VENDOR_INVOICE;
    default:
      return null;
  }
}
