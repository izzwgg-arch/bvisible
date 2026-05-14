export const runtime = 'nodejs';

import { prisma } from '@bvisible/db';
import { writeAuditLog } from '@/lib/auth/audit';
import { jsonErr, jsonOk } from '@/lib/api/v1/envelope';
import { parseJsonBody } from '@/lib/api/v1/parse-json-body';
import { mobileUploadPresignSchema } from '@/lib/validators';
import { requireMobileBearer } from '@/lib/mobile/require-mobile-bearer';
import { parseMobileUploadKind } from '@/lib/mobile/upload-kind';
import {
  MOBILE_PENDING_UPLOAD_TTL_MS,
} from '@/lib/mobile/constants';
import { requestMeta, publicRequestBaseUrl } from '@/lib/mobile/request-meta';
import { newStorageKey, safeOriginalFilename } from '@/lib/po/uploads';

export async function POST(req: Request) {
  const auth = await requireMobileBearer(req);
  if (!auth.ok) return auth.response;

  const raw = await parseJsonBody(req);
  const parsed = mobileUploadPresignSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonErr(
      'validation_error',
      parsed.error.issues[0]?.message ?? 'Invalid body.',
      400
    );
  }

  const { purchaseOrderId, kind: kindStr, originalFilename, declaredSizeBytes } =
    parsed.data;

  const kind = parseMobileUploadKind(kindStr);
  if (!kind) {
    return jsonErr('invalid_kind', 'Unsupported attachment kind.', 400);
  }

  const po = await prisma.purchaseOrder.findFirst({
    where: {
      id: purchaseOrderId,
      tenantId: auth.ctx.tenantId,
      deletedAt: null,
    },
    select: { id: true, number: true },
  });
  if (!po) {
    return jsonErr('not_found', 'Purchase order not found.', 404);
  }

  const safeName = safeOriginalFilename(originalFilename);
  const storageKey = newStorageKey(safeName);
  const expiresAt = new Date(Date.now() + MOBILE_PENDING_UPLOAD_TTL_MS);

  const row = await prisma.mobilePendingUpload.create({
    data: {
      tenantId: auth.ctx.tenantId,
      userId: auth.ctx.userId,
      purchaseOrderId,
      storageKey,
      kind,
      originalFilename: safeName.slice(0, 200),
      declaredSizeBytes,
      expiresAt,
    },
    select: { id: true },
  });

  const { ipAddress, userAgent } = requestMeta(req);
  await writeAuditLog({
    action: 'mobile_upload_presign',
    userId: auth.ctx.userId,
    tenantId: auth.ctx.tenantId,
    targetType: 'mobile_pending_upload',
    targetId: row.id,
    ipAddress,
    userAgent,
    metadata: {
      purchaseOrderId,
      number: po.number,
      kind: kindStr,
      declaredSizeBytes,
    },
  });

  const base = publicRequestBaseUrl(req);
  const uploadUrl = `${base}/api/v1/uploads/${row.id}/bytes`;

  return jsonOk({
    uploadId: row.id,
    uploadUrl,
    expiresAt: expiresAt.toISOString(),
    declaredSizeBytes,
  });
}
