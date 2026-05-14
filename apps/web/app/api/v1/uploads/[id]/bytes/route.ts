export const runtime = 'nodejs';

import { prisma } from '@bvisible/db';
import { jsonErr, jsonOk } from '@/lib/api/v1/envelope';
import { requireMobileBearer } from '@/lib/mobile/require-mobile-bearer';
import {
  MAX_UPLOAD_BYTES,
  persistAttachmentBytes,
} from '@/lib/po/uploads';

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireMobileBearer(req);
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;

  const pending = await prisma.mobilePendingUpload.findFirst({
    where: {
      id,
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

  const lenHeader = req.headers.get('content-length');
  if (lenHeader) {
    const n = Number(lenHeader);
    if (
      Number.isFinite(n) &&
      (n !== pending.declaredSizeBytes || n > MAX_UPLOAD_BYTES)
    ) {
      return jsonErr(
        'size_mismatch',
        'Content-Length must match declared upload size.',
        400
      );
    }
  }

  let buf: ArrayBuffer;
  try {
    buf = await req.arrayBuffer();
  } catch {
    return jsonErr('bad_body', 'Could not read upload body.', 400);
  }

  if (buf.byteLength !== pending.declaredSizeBytes) {
    return jsonErr(
      'size_mismatch',
      'Body size must match declared upload size.',
      400
    );
  }

  if (buf.byteLength > MAX_UPLOAD_BYTES) {
    return jsonErr('too_large', `Max upload is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`, 413);
  }

  const bytes = new Uint8Array(buf);

  try {
    await persistAttachmentBytes({
      tenantId: pending.tenantId,
      purchaseOrderId: pending.purchaseOrderId,
      storageKey: pending.storageKey,
      bytes,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'persist_failed';
    return jsonErr('persist_failed', msg, 500);
  }

  return jsonOk({
    uploadId: pending.id,
    bytesWritten: bytes.byteLength,
  });
}
