import { prisma, Role } from '@bvisible/db';
import { jsonErr } from '@/lib/api/v1/envelope';
import type { NextResponse } from 'next/server';
import { verifyMobileAccessToken } from './jwt';
import { ensureDefaultCompanyUncached } from '@/lib/company/default-company';

export interface MobileAuthContext {
  tenantId: string;
  userId: string;
  role: string;
  sessionId: string;
}

export async function requireMobileBearer(
  req: Request
): Promise<{ ok: true; ctx: MobileAuthContext } | { ok: false; response: NextResponse }> {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return {
      ok: false,
      response: jsonErr('unauthorized', 'Missing Bearer token.', 401),
    };
  }
  const raw = auth.slice('Bearer '.length).trim();
  if (!raw) {
    return {
      ok: false,
      response: jsonErr('unauthorized', 'Missing Bearer token.', 401),
    };
  }

  let claims: MobileAuthContext;
  try {
    const v = await verifyMobileAccessToken(raw);
    claims = {
      tenantId: v.tenantId,
      userId: v.userId,
      role: v.role,
      sessionId: v.sessionId,
    };
  } catch {
    return {
      ok: false,
      response: jsonErr('invalid_token', 'Invalid or expired access token.', 401),
    };
  }

  const session = await prisma.mobileSession.findFirst({
    where: {
      id: claims.sessionId,
      tenantId: claims.tenantId,
      userId: claims.userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });

  if (!session) {
    return {
      ok: false,
      response: jsonErr('session_invalid', 'Session revoked or expired.', 401),
    };
  }

  const user = await prisma.user.findFirst({
    where: {
      id: claims.userId,
      disabledAt: null,
    },
    select: { id: true, tenantId: true, role: true },
  });

  if (!user) {
    return {
      ok: false,
      response: jsonErr('user_disabled', 'Account unavailable.', 403),
    };
  }

  const defaultCompany = await ensureDefaultCompanyUncached();
  const effectiveTenantId =
    user.role === Role.SUPER_ADMIN
      ? defaultCompany.id
      : (user.tenantId ?? defaultCompany.id);

  if (claims.tenantId !== effectiveTenantId) {
    return {
      ok: false,
      response: jsonErr('session_invalid', 'Session revoked or expired.', 401),
    };
  }

  return { ok: true, ctx: claims };
}
