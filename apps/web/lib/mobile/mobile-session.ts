import { prisma, Role, type Role as RoleT } from '@bvisible/db';
import { generateToken, hashToken } from '@/lib/auth/tokens';
import { signMobileAccessToken } from './jwt';
import { MOBILE_REFRESH_TTL_MS } from './constants';
import { ensureDefaultCompanyUncached } from '@/lib/company/default-company';

export async function createMobileSessionAndTokens(params: {
  tenantId: string;
  userId: string;
  role: RoleT;
  deviceLabel?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sessionId: string;
}> {
  const refreshToken = generateToken();
  const refreshTokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + MOBILE_REFRESH_TTL_MS);

  const row = await prisma.mobileSession.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId,
      refreshTokenHash,
      expiresAt,
      deviceLabel: params.deviceLabel?.trim().slice(0, 120) || null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    },
    select: { id: true },
  });

  const { token: accessToken, expiresIn } = await signMobileAccessToken({
    sessionId: row.id,
    userId: params.userId,
    tenantId: params.tenantId,
    role: params.role,
  });

  return {
    accessToken,
    refreshToken,
    expiresIn,
    sessionId: row.id,
  };
}

export async function rotateMobileRefreshToken(params: {
  refreshTokenPlain: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sessionId: string;
  tenantId: string;
  userId: string;
}> {
  const refreshTokenHash = hashToken(params.refreshTokenPlain);
  const row = await prisma.mobileSession.findFirst({
    where: {
      refreshTokenHash,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      user: {
        select: {
          id: true,
          tenantId: true,
          role: true,
          disabledAt: true,
        },
      },
    },
  });

  if (!row || row.user.disabledAt) {
    throw new Error('invalid_refresh');
  }

  const defaultCompany = await ensureDefaultCompanyUncached();
  const expectedTenantId =
    row.user.role === Role.SUPER_ADMIN
      ? defaultCompany.id
      : (row.user.tenantId ?? defaultCompany.id);

  if (row.tenantId !== expectedTenantId) {
    throw new Error('invalid_refresh');
  }

  const newRefresh = generateToken();
  const newHash = hashToken(newRefresh);

  await prisma.mobileSession.update({
    where: { id: row.id },
    data: {
      refreshTokenHash: newHash,
      expiresAt: new Date(Date.now() + MOBILE_REFRESH_TTL_MS),
      lastUsedAt: new Date(),
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    },
  });

  const { token: accessToken, expiresIn } = await signMobileAccessToken({
    sessionId: row.id,
    userId: row.userId,
    tenantId: row.tenantId,
    role: row.user.role,
  });

  return {
    accessToken,
    refreshToken: newRefresh,
    expiresIn,
    sessionId: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
  };
}

export async function revokeMobileSession(sessionId: string): Promise<void> {
  await prisma.mobileSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
