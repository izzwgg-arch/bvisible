export const runtime = 'nodejs';

import { open, stat, unlink } from 'node:fs/promises';
import { prisma } from '@bvisible/db';
import { revalidatePath } from 'next/cache';
import { writeAuditLog } from '@/lib/auth/audit';
import { jsonErr, jsonOk } from '@/lib/api/v1/envelope';
import { parseJsonBody } from '@/lib/api/v1/parse-json-body';
import { mobileUploadCompleteSchema } from '@/lib/validators';
import { requireMobileBearer } from '@/lib/mobile/require-mobile-bearer';
import { requestMeta } from '@/lib/mobile/request-meta';
import {
  MAX_UPLOAD_BYTES,
  ALLOWED_MIMES,
  detectMimeFromBytes,
  resolveAttachmentPath,
} from '@/lib/po/uploads';
import { insertPoAttachmentAndTimelineEvent } from '@/lib/po/attachment-insert';

export async function POST(req: Request) {
  const auth = await requireMobileBearer(req);
  if (!auth.ok) return auth.response;

  const raw = await parseJsonBody(req);
  const parsed = mobileUploadCompleteSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonErr(
      'validation_error',
      parsed.error.issues[0]?.message ?? 'Invalid body.',
      400
    );
  }

  const { uploadId } = parsed.data;

  const pending = await prisma.mobilePendingUpload.findFirst({
    where: {
      id: uploadId,
      tenantId: auth.ctx.tenantId,
      userId: auth.ctx.userId,
      completedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!pending) {
    return jsonErr(
      'invalid_upload',
      'Upload not found, expired, or already completed.',
      400
    );
  }

  const abs = resolveAttachmentPath(
    pending.tenantId,
    pending.purchaseOrderId,
    pending.storageKey
  );

  let sizeBytes = 0;
  try {
    const st = await stat(abs);
    if (!st.isFile()) {
      return jsonErr('upload_missing', 'Upload bytes not found.', 400);
    }
    sizeBytes = st.size;
  } catch {
    return jsonErr('upload_missing', 'Upload bytes not found.', 400);
  }

  if (sizeBytes !== pending.declaredSizeBytes || sizeBytes > MAX_UPLOAD_BYTES) {
    try {
      await unlink(abs);
    } catch {
      /* ignore */
    }
    return jsonErr(
      'size_mismatch',
      'Uploaded size does not match declaration or exceeds limit.',
      400
    );
  }

  const fh = await open(abs, 'r');
  const probe = new Uint8Array(64);
  await fh.read(probe, 0, 64, 0);
  await fh.close();

  const detected = detectMimeFromBytes(probe);
  if (
    !detected ||
    !(ALLOWED_MIMES as readonly string[]).includes(detected.mime)
  ) {
    try {
      await unlink(abs);
    } catch {
      /* ignore */
    }
    return jsonErr(
      'invalid_mime',
      'Unsupported or spoofed file type after upload.',
      415
    );
  }

  const po = await prisma.purchaseOrder.findFirst({
    where: {
      id: pending.purchaseOrderId,
      tenantId: auth.ctx.tenantId,
      deletedAt: null,
    },
    select: { id: true, number: true },
  });
  if (!po) {
    try {
      await unlink(abs);
    } catch {
      /* ignore */
    }
    return jsonErr('not_found', 'Purchase order not found.', 404);
  }

  let attachmentId: string;
  try {
    attachmentId = await prisma.$transaction(async (tx) => {
      const mark = await tx.mobilePendingUpload.updateMany({
        where: {
          id: pending.id,
          completedAt: null,
          revokedAt: null,
          tenantId: auth.ctx.tenantId,
          userId: auth.ctx.userId,
        },
        data: { completedAt: new Date() },
      });
      if (mark.count !== 1) {
        throw new Error('race');
      }

      const created = await insertPoAttachmentAndTimelineEvent(tx, {
        tenantId: pending.tenantId,
        purchaseOrderId: pending.purchaseOrderId,
        uploadedById: pending.userId,
        storageKey: pending.storageKey,
        originalFilename: pending.originalFilename,
        mimeType: detected.mime,
        sizeBytes,
        kind: pending.kind,
        metadataExtra: { source: 'mobile', mobilePendingUploadId: pending.id },
      });

      return created.attachmentId;
    });
  } catch {
    return jsonErr(
      'complete_failed',
      'Could not finalize upload. Try again.',
      409
    );
  }

  const { ipAddress, userAgent } = requestMeta(req);
  await writeAuditLog({
    action: 'mobile_upload_complete',
    userId: auth.ctx.userId,
    tenantId: auth.ctx.tenantId,
    targetType: 'mobile_pending_upload',
    targetId: pending.id,
    ipAddress,
    userAgent,
    metadata: {
      attachmentId,
      purchaseOrderId: pending.purchaseOrderId,
      number: po.number,
      mimeType: detected.mime,
      sizeBytes,
      kind: pending.kind,
    },
  });

  await writeAuditLog({
    action: 'po_attachment_added',
    userId: auth.ctx.userId,
    tenantId: auth.ctx.tenantId,
    targetType: 'po_attachment',
    targetId: attachmentId,
    ipAddress,
    userAgent,
    metadata: {
      number: po.number,
      mimeType: detected.mime,
      sizeBytes,
      kind: pending.kind,
      source: 'mobile',
    },
  });

  revalidatePath(`/purchase-orders/${pending.purchaseOrderId}`);

  return jsonOk({
    attachmentId,
    purchaseOrderId: pending.purchaseOrderId,
    mimeType: detected.mime,
    sizeBytes,
    kind: pending.kind,
  });
}
