export const runtime = 'nodejs';

import { writeAuditLog } from '@/lib/auth/audit';
import { jsonErr, jsonOk } from '@/lib/api/v1/envelope';
import { parseJsonBody } from '@/lib/api/v1/parse-json-body';
import { mobileRefreshSchema } from '@/lib/validators';
import { rotateMobileRefreshToken } from '@/lib/mobile/mobile-session';
import { assertMobileJwtConfigured } from '@/lib/mobile/jwt';
import { requestMeta } from '@/lib/mobile/request-meta';

export async function POST(req: Request) {
  try {
    assertMobileJwtConfigured();
  } catch {
    return jsonErr(
      'server_misconfigured',
      'Mobile API is not configured (MOBILE_JWT_SECRET).',
      503
    );
  }

  const raw = await parseJsonBody(req);
  const parsed = mobileRefreshSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonErr(
      'validation_error',
      parsed.error.issues[0]?.message ?? 'Invalid body.',
      400
    );
  }

  const { refreshToken } = parsed.data;
  const { ipAddress, userAgent } = requestMeta(req);

  try {
    const tokens = await rotateMobileRefreshToken({
      refreshTokenPlain: refreshToken,
      ipAddress,
      userAgent,
    });

    await writeAuditLog({
      action: 'mobile_refresh_success',
      userId: tokens.userId,
      tenantId: tokens.tenantId,
      targetType: 'mobile_session',
      targetId: tokens.sessionId,
      ipAddress,
      userAgent,
    });

    return jsonOk({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      tokenType: 'Bearer',
    });
  } catch {
    await writeAuditLog({
      action: 'mobile_refresh_failure',
      ipAddress,
      userAgent,
    });
    return jsonErr('invalid_refresh', 'Invalid or expired refresh token.', 401);
  }
}
