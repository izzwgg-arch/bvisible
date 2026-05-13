import { cookies } from 'next/headers';
import { prisma } from '@bvisible/db';
import { generateToken, hashToken } from './tokens';

export const SESSION_COOKIE_NAME = 'bv_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const isProd = process.env.NODE_ENV === 'production';

export interface CreateSessionInput {
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

// Creates a new session row, sets the cookie, returns the raw token (only
// time it ever exists outside the user's cookie jar). Caller can ignore
// the return value — the cookie is already set.
export async function createSession(input: CreateSessionInput): Promise<string> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      userId: input.userId,
      tokenHash,
      expiresAt,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });

  const jar = await cookies();
  jar.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });

  return token;
}

// Reads + revokes the session backing the current cookie, then clears it.
// Best-effort — if there is no cookie or the session is already revoked,
// still clears the cookie so the user is logged out client-side.
export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const cookie = jar.get(SESSION_COOKIE_NAME);
  if (cookie?.value) {
    const tokenHash = hashToken(cookie.value);
    try {
      await prisma.session.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      // Swallow: cookie clearing is the contract; DB hygiene is best-effort.
    }
  }
  jar.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

// Resolve the current session row from the cookie. Returns null on:
// - missing cookie
// - unknown token hash
// - expired session
// - revoked session
// Updates lastSeenAt opportunistically (best-effort, non-blocking).
export async function resolveSessionFromCookie(): Promise<{
  sessionId: string;
  userId: string;
  expiresAt: Date;
} | null> {
  const jar = await cookies();
  const cookie = jar.get(SESSION_COOKIE_NAME);
  if (!cookie?.value) return null;

  const tokenHash = hashToken(cookie.value);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, revokedAt: true },
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;

  // Touch lastSeenAt at most once per minute to avoid a write per request.
  prisma.session
    .updateMany({
      where: {
        id: session.id,
        lastSeenAt: { lt: new Date(Date.now() - 60 * 1000) },
      },
      data: { lastSeenAt: new Date() },
    })
    .catch(() => {});

  return {
    sessionId: session.id,
    userId: session.userId,
    expiresAt: session.expiresAt,
  };
}
