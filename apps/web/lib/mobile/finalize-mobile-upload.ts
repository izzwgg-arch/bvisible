import type { PrismaClient } from '@bvisible/db';
import { prisma as defaultPrisma } from '@bvisible/db';
import { revalidatePath } from 'next/cache';
import type { NextResponse } from 'next/server';
import { open, stat, unlink } from 'node:fs/promises';
import { jsonErr, jsonOk } from '@/lib/api/v1/envelope';
import { writeAuditLog } from '@/lib/auth/audit';
import { insertPoAttachmentAndTimelineEvent } from '@/lib/po/attachment-insert';
import type { MobileAuthContext } from '@/lib/mobile/require-mobile-bearer';
import { requestMeta } from '@/lib/mobile/request-meta';
import {
  MAX_UPLOAD_BYTES,
  ALLOWED_MIMES,
  detectMimeFromBytes,
  resolveAttachmentPath,
} from '@/lib/po/uploads';

function attachmentJson(args: {
  attachmentId: string;
  purchaseOrderId: string;
  mimeType: string;
  sizeBytes: number;
  kind: string;
  idempotentReplay: boolean;
}): NextResponse {
  return jsonOk({
    attachmentId: args.attachmentId,
    purchaseOrderId: args.purchaseOrderId,
    mimeType: args.mimeType,
    sizeBytes: args.sizeBytes,
    kind: args.kind,
    idempotentReplay: args.idempotentReplay,
  });
}

/** Lookup attachment created from this pending row (storageKey is unique per upload reservation). */
async function findAttachmentForPending(
  db: PrismaClient,
  auth: MobileAuthContext,
  pending: {
    purchaseOrderId: string;
    storageKey: string;
    kind: string;
  }
) {
  return db.pOAttachment.findFirst({
    where: {
      tenantId: auth.tenantId,
      purchaseOrderId: pending.purchaseOrderId,
      storageKey: pending.storageKey,
      uploadedById: auth.userId,
    },
    select: {
      id: true,
      mimeType: true,
      sizeBytes: true,
      kind: true,
    },
  });
}

/**
 * Finalize mobile pending upload. Safe to retry: completed uploads return the same
 * attachment payload without duplicating rows, timeline events, or audits.
 */
export async function finalizeMobileUploadResponse(args: {
  prismaClient?: PrismaClient;
  auth: MobileAuthContext;
  uploadId: string;
  req: Request;
}): Promise<NextResponse> {
  const db = args.prismaClient ?? defaultPrisma;
  const { auth, uploadId, req } = args;

  const pending = await db.mobilePendingUpload.findFirst({
    where: {
      id: uploadId,
      tenantId: auth.tenantId,
      userId: auth.userId,
      revokedAt: null,
    },
  });

  if (!pending) {
    return jsonErr('invalid_upload', 'Upload not found.', 404);
  }

  if (pending.expiresAt <= new Date()) {
    return jsonErr(
      'upload_expired',
      'Upload reservation expired. Start the upload again.',
      400
    );
  }

  if (pending.completedAt) {
    const existing = await findAttachmentForPending(db, auth, pending);
    if (!existing) {
      return jsonErr(
        'upload_inconsistent',
        'Upload marked complete but attachment is missing. Contact support.',
        409
      );
    }
    return attachmentJson({
      attachmentId: existing.id,
      purchaseOrderId: pending.purchaseOrderId,
      mimeType: existing.mimeType,
      sizeBytes: existing.sizeBytes,
      kind: existing.kind,
      idempotentReplay: true,
    });
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

  const po = await db.purchaseOrder.findFirst({
    where: {
      id: pending.purchaseOrderId,
      tenantId: auth.tenantId,
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
    attachmentId = await db.$transaction(async (tx) => {
      const mark = await tx.mobilePendingUpload.updateMany({
        where: {
          id: pending.id,
          completedAt: null,
          revokedAt: null,
          tenantId: auth.tenantId,
          userId: auth.userId,
        },
        data: { completedAt: new Date() },
      });
      if (mark.count !== 1) {
        throw new Error('race_or_completed');
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
    const raced = await findAttachmentForPending(db, auth, pending);
    if (raced) {
      return attachmentJson({
        attachmentId: raced.id,
        purchaseOrderId: pending.purchaseOrderId,
        mimeType: raced.mimeType,
        sizeBytes: raced.sizeBytes,
        kind: raced.kind,
        idempotentReplay: true,
      });
    }
    return jsonErr(
      'complete_failed',
      'Could not finalize upload. Try again.',
      409
    );
  }

  const { ipAddress, userAgent } = requestMeta(req);
  await writeAuditLog({
    action: 'mobile_upload_complete',
    userId: auth.userId,
    tenantId: auth.tenantId,
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
    userId: auth.userId,
    tenantId: auth.tenantId,
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

  return attachmentJson({
    attachmentId,
    purchaseOrderId: pending.purchaseOrderId,
    mimeType: detected.mime,
    sizeBytes,
    kind: pending.kind,
    idempotentReplay: false,
  });
}
