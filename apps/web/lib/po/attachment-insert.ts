import type { Prisma } from '@bvisible/db';
import { POEventKind, type POAttachmentKind } from '@bvisible/db';

/** Shared PO attachment row + ATTACHMENT_ADDED timeline event (web + mobile). */
export async function insertPoAttachmentAndTimelineEvent(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    purchaseOrderId: string;
    uploadedById: string;
    storageKey: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    kind: POAttachmentKind;
    metadataExtra?: Record<string, unknown>;
  }
): Promise<{ attachmentId: string }> {
  const att = await tx.pOAttachment.create({
    data: {
      tenantId: input.tenantId,
      purchaseOrderId: input.purchaseOrderId,
      storageKey: input.storageKey,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      kind: input.kind,
      uploadedById: input.uploadedById,
    },
    select: { id: true },
  });

  const meta: Record<string, unknown> = {
    attachmentId: att.id,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    kind: input.kind,
    ...(input.metadataExtra ?? {}),
  };

  await tx.pOEvent.create({
    data: {
      tenantId: input.tenantId,
      purchaseOrderId: input.purchaseOrderId,
      kind: POEventKind.ATTACHMENT_ADDED,
      message: `Attached ${input.originalFilename} (${input.mimeType})`,
      metadata: meta as unknown as Prisma.InputJsonValue,
      actorId: input.uploadedById,
    },
  });

  return { attachmentId: att.id };
}
