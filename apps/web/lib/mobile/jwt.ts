import * as jose from 'jose';
import { randomUUID } from 'node:crypto';
import type { Role } from '@bvisible/db';
import { Role as RoleEnum } from '@bvisible/db';
import { MOBILE_ACCESS_TOKEN_TTL_SEC } from './constants';

const ROLES = new Set<string>(Object.values(RoleEnum));

function mobileJwtSecretKey(): Uint8Array {
  const s = process.env.MOBILE_JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error('MOBILE_JWT_SECRET must be set (min 32 chars)');
  }
  return new TextEncoder().encode(s);
}

export async function signMobileAccessToken(args: {
  sessionId: string;
  userId: string;
  tenantId: string;
  role: Role;
}): Promise<{ token: string; expiresIn: number }> {
  const secret = mobileJwtSecretKey();
  const expiresIn = MOBILE_ACCESS_TOKEN_TTL_SEC;
  const token = await new jose.SignJWT({
    tid: args.tenantId,
    role: args.role,
    sid: args.sessionId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(args.userId)
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .setJti(randomUUID())
    .sign(secret);

  return { token, expiresIn };
}

export async function verifyMobileAccessToken(token: string): Promise<{
  userId: string;
  tenantId: string;
  role: Role;
  sessionId: string;
}> {
  const secret = mobileJwtSecretKey();
  const { payload } = await jose.jwtVerify(token, secret, {
    algorithms: ['HS256'],
  });
  const userId = typeof payload.sub === 'string' ? payload.sub : '';
  const tenantId = typeof payload.tid === 'string' ? payload.tid : '';
  const roleRaw = payload.role;
  const sessionId = typeof payload.sid === 'string' ? payload.sid : '';
  const role =
    typeof roleRaw === 'string' && ROLES.has(roleRaw)
      ? (roleRaw as Role)
      : null;
  if (!userId || !tenantId || !sessionId || !role) {
    throw new Error('invalid_mobile_access_token');
  }
  return { userId, tenantId, role, sessionId };
}

export function assertMobileJwtConfigured(): void {
  mobileJwtSecretKey();
}
