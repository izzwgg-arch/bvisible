import {
  POAttachmentKind,
  Prisma,
  prisma,
} from '@bvisible/db';

const OCR_ATTACHMENT_KINDS = new Set<POAttachmentKind>([
  POAttachmentKind.RECEIPT,
  POAttachmentKind.INVOICE,
  POAttachmentKind.VENDOR_INVOICE,
  POAttachmentKind.VENDOR_DOC,
  POAttachmentKind.FIELD_DOCUMENT,
  POAttachmentKind.EMAIL_ATTACHMENT,
]);

export function poAttachmentEligibleForOcr(kind: POAttachmentKind): boolean {
  return OCR_ATTACHMENT_KINDS.has(kind);
}

/**
 * Idempotent enqueue — unique `poAttachmentId` prevents duplicate OCR rows.
 */
export async function enqueueOcrJobForPoAttachment(input: {
  tenantId: string;
  poAttachmentId: string;
  kind: POAttachmentKind;
}): Promise<'queued' | 'skipped' | 'duplicate'> {
  if (!poAttachmentEligibleForOcr(input.kind)) return 'skipped';
  try {
    await prisma.ocrDocument.create({
      data: {
        tenantId: input.tenantId,
        poAttachmentId: input.poAttachmentId,
      },
    });
    return 'queued';
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return 'duplicate';
    }
    throw err;
  }
}
