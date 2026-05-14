export const runtime = 'nodejs';

import { prisma, Role } from '@bvisible/db';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { writeAuditLog } from '@/lib/auth/audit';
import { isLockedForEmail } from '@/lib/auth/rate-limit';
import { jsonErr, jsonOk } from '@/lib/api/v1/envelope';
import { parseJsonBody } from '@/lib/api/v1/parse-json-body';
import { mobileLoginSchema } from '@/lib/validators';
import { createMobileSessionAndTokens } from '@/lib/mobile/mobile-session';
import { assertMobileJwtConfigured } from '@/lib/mobile/jwt';
import { requestMeta } from '@/lib/mobile/request-meta';
import { ensureDefaultCompanyUncached } from '@/lib/company/default-company';

const GENERIC_INVALID = 'Invalid email or password.';
const LOCKED_OUT = 'Too many failed attempts. Try again in a few minutes.';

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
  const parsed = mobileLoginSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonErr(
      'validation_error',
      parsed.error.issues[0]?.message ?? 'Invalid body.',
      400
    );
  }

  const { email, password, deviceLabel } = parsed.data;
  const { ipAddress, userAgent } = requestMeta(req);

  if (await isLockedForEmail(email)) {
    return jsonErr('locked_out', LOCKED_OUT, 429);
  }

  const user = await prisma.user.findFirst({
    where: { email },
    select: {
      id: true,
      email: true,
      tenantId: true,
      passwordHash: true,
      disabledAt: true,
      role: true,
    },
  });

  let passOk = false;
  if (user?.passwordHash) {
    passOk = await verifyPassword(password, user.passwordHash);
  } else {
    await hashPassword(password);
  }

  const blockedMobile =
    !user || !passOk || !user.passwordHash || user.disabledAt;

  if (blockedMobile) {
    await writeAuditLog({
      action: 'mobile_login_failure',
      userId: user?.id ?? null,
      tenantId: user?.tenantId ?? null,
      ipAddress,
      userAgent,
      metadata: {
        email,
        reason: !user
          ? 'unknown_email'
          : user.disabledAt
            ? 'disabled'
            : 'bad_password',
      },
    });
    return jsonErr('invalid_credentials', GENERIC_INVALID, 401);
  }

  const defaultCompany = await ensureDefaultCompanyUncached();
  const tenantIdForMobile =
    user.role === Role.SUPER_ADMIN
      ? defaultCompany.id
      : (user.tenantId ?? defaultCompany.id);

  const tokens = await createMobileSessionAndTokens({
    tenantId: tenantIdForMobile,
    userId: user.id,
    role: user.role,
    deviceLabel: deviceLabel ?? null,
    ipAddress,
    userAgent,
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await writeAuditLog({
    action: 'mobile_login_success',
    userId: user.id,
    tenantId: tenantIdForMobile,
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
}
