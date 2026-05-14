export const runtime = 'nodejs';

import { jsonErr } from '@/lib/api/v1/envelope';
import { finalizeMobileUploadResponse } from '@/lib/mobile/finalize-mobile-upload';
import { parseJsonBody } from '@/lib/api/v1/parse-json-body';
import { mobileUploadCompleteSchema } from '@/lib/validators';
import { requireMobileBearer } from '@/lib/mobile/require-mobile-bearer';

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

  return finalizeMobileUploadResponse({
    auth: auth.ctx,
    uploadId: parsed.data.uploadId,
    req,
  });
}
