'use server';

import { revalidatePath } from 'next/cache';
import { OcrJobStatus, prisma, Role } from '@bvisible/db';
import { requireRoleWithEffectiveCompany } from '@/lib/auth/current-user';
import {
  buildOcrApproveTriggerDedupeKey,
  runPoReconciliationSnapshot,
} from '@/lib/reconciliation/run';
import { persistApprovedOcrPriceLines } from '@/lib/vendor-pricing/persist';
import { z } from 'zod';

const approveSchema = z.object({
  documentId: z.string(),
  lines: z.array(
    z.object({
      ocrLineItemId: z.string(),
      include: z.boolean(),
      itemRaw: z.string().min(1).max(500),
      priceCents: z.number().int().positive(),
      unit: z.string().max(40).nullable().optional(),
      quantityMilli: z.number().int().positive().nullable().optional(),
    })
  ),
});

export async function approveOcrDocumentAction(
  input: unknown
): Promise<{
  ok: boolean;
  error?: string;
  purchaseOrderId?: string;
  reconciliationId?: string | null;
  reconciliationSkipped?: boolean;
}> {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);

  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid approval payload.' };

  const doc = await prisma.ocrDocument.findFirst({
    where: {
      id: parsed.data.documentId,
      tenantId: me.tenantId,
      status: OcrJobStatus.REVIEW_REQUIRED,
    },
    include: {
      poAttachment: {
        select: {
          id: true,
          purchaseOrderId: true,
          purchaseOrder: { select: { vendorId: true } },
        },
      },
    },
  });

  if (!doc?.poAttachmentId || !doc.poAttachment) {
    return { ok: false, error: 'Document not found or not awaiting review.' };
  }

  const vendorId = doc.poAttachment.purchaseOrder.vendorId;
  if (!vendorId) {
    return {
      ok: false,
      error: 'Assign a vendor on this PO before approving OCR prices.',
    };
  }

  const linesIn = parsed.data.lines.filter((l) => l.include);
  if (linesIn.length === 0) {
    return { ok: false, error: 'Select at least one line to record.' };
  }

  const ids = linesIn.map((l) => l.ocrLineItemId);
  const valid = await prisma.ocrLineItem.count({
    where: { ocrDocumentId: doc.id, id: { in: ids } },
  });
  if (valid !== ids.length) {
    return { ok: false, error: 'Line selection mismatch — refresh and retry.' };
  }

  await persistApprovedOcrPriceLines({
    tenantId: me.tenantId,
    vendorId,
    purchaseOrderId: doc.poAttachment.purchaseOrderId,
    actorId: me.id,
    ocrDocumentId: doc.id,
    sourcePoAttachmentId: doc.poAttachment.id,
    lines: linesIn.map((l) => ({
      ocrLineItemId: l.ocrLineItemId,
      itemRaw: l.itemRaw,
      priceCents: l.priceCents,
      unit: l.unit ?? null,
      quantityMilli: l.quantityMilli ?? null,
    })),
  });

  const triggerDedupeKey = buildOcrApproveTriggerDedupeKey({
    tenantId: me.tenantId,
    purchaseOrderId: doc.poAttachment.purchaseOrderId,
    ocrDocumentId: doc.id,
    includedOcrLineItemIds: ids,
  });

  const reconResult = await runPoReconciliationSnapshot({
    tenantId: me.tenantId,
    purchaseOrderId: doc.poAttachment.purchaseOrderId,
    actorId: me.id,
    triggerDedupeKey,
  });

  await prisma.ocrDocument.update({
    where: { id: doc.id },
    data: {
      status: OcrJobStatus.CONFIRMED,
      confirmedAt: new Date(),
      confirmedById: me.id,
    },
  });

  revalidatePath('/admin/ocr-review');
  revalidatePath(`/admin/ocr-review/${doc.id}`);
  revalidatePath('/admin/reconciliation');
  revalidatePath(`/purchase-orders/${doc.poAttachment.purchaseOrderId}/reconciliation`);
  revalidatePath('/dashboard');
  revalidatePath(`/purchase-orders/${doc.poAttachment.purchaseOrderId}`);
  return {
    ok: true,
    purchaseOrderId: doc.poAttachment.purchaseOrderId,
    reconciliationId: reconResult.reconciliationId ?? null,
    reconciliationSkipped: reconResult.skipped,
  };
}

export async function rejectOcrDocumentAction(
  documentId: string
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);

  const updated = await prisma.ocrDocument.updateMany({
    where: {
      id: documentId,
      tenantId: me.tenantId,
      status: OcrJobStatus.REVIEW_REQUIRED,
    },
    data: {
      status: OcrJobStatus.REJECTED,
      rejectedAt: new Date(),
      rejectedById: me.id,
      lockedUntil: null,
    },
  });

  if (updated.count === 0) {
    return { ok: false, error: 'Nothing to reject (already processed?).' };
  }

  revalidatePath('/admin/ocr-review');
  revalidatePath(`/admin/ocr-review/${documentId}`);
  return { ok: true };
}
