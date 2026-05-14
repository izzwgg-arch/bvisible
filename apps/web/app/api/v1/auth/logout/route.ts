export const runtime = 'nodejs';

import { writeAuditLog } from '@/lib/auth/audit';
import { jsonErr, jsonOk } from '@/lib/api/v1/envelope';
import { revokeMobileSession } from '@/lib/mobile/mobile-session';
import { requireMobileBearer } from '@/lib/mobile/require-mobile-bearer';
import { requestMeta } from '@/lib/mobile/request-meta';

export async function POST(req: Request) {
  const auth = await requireMobileBearer(req);
  if (!auth.ok) return auth.response;

  await revokeMobileSession(auth.ctx.sessionId);

  const { ipAddress, userAgent } = requestMeta(req);
  await writeAuditLog({
    action: 'mobile_logout',
    userId: auth.ctx.userId,
    tenantId: auth.ctx.tenantId,
    targetType: 'mobile_session',
    targetId: auth.ctx.sessionId,
    ipAddress,
    userAgent,
  });

  return jsonOk({});
}
