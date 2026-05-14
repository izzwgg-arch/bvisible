import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Role } from '@prisma/client';
import { signMobileAccessToken, verifyMobileAccessToken } from './jwt';

describe('mobile JWT', () => {
  beforeAll(() => {
    vi.stubEnv('MOBILE_JWT_SECRET', 'test-mobile-jwt-secret-min-32-chars!');
  });

  it('sign + verify roundtrip carries tenant, role, session', async () => {
    const { token } = await signMobileAccessToken({
      sessionId: 'sess_cuid_test',
      userId: 'user_test',
      tenantId: 'tenant_test',
      role: Role.ADMIN,
    });

    const v = await verifyMobileAccessToken(token);
    expect(v.userId).toBe('user_test');
    expect(v.tenantId).toBe('tenant_test');
    expect(v.sessionId).toBe('sess_cuid_test');
    expect(v.role).toBe(Role.ADMIN);
  });

  it('rejects forged role claim', async () => {
    const secret = new TextEncoder().encode(
      'test-mobile-jwt-secret-min-32-chars!'
    );
    const { SignJWT } = await import('jose');

    const bad = await new SignJWT({
      tid: 'tenant_test',
      role: 'NOT_A_ROLE',
      sid: 'sess_x',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user_test')
      .setIssuedAt()
      .setExpirationTime('900s')
      .sign(secret);

    await expect(verifyMobileAccessToken(bad)).rejects.toThrow();
  });
});
