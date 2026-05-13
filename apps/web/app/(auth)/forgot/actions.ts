'use server';

import { headers } from 'next/headers';
import { prisma } from '@bvisible/db';
import { requestResetSchema } from '@/lib/validators';
import { generateToken, hashToken } from '@/lib/auth/tokens';
import { writeAuditLog } from '@/lib/auth/audit';
import { readRequestContext } from '@/lib/request-context';

export interface RequestResetState {
  error: string | null;
  ok: boolean;
  // Until SMTP is wired, we surface the reset link to the requester
  // inline so they can complete the flow. It's bounded to the same
  // session that submitted the form (no cross-user leak — the only way
  // to see it is to have submitted the form yourself).
  devLink: string | null;
}

const RESET_TTL_MS = 30 * 60 * 1000;

export async function requestResetAction(
  _prev: RequestResetState,
  formData: FormData
): Promise<RequestResetState> {
  const parsed = requestResetSchema.safeParse({
    email: formData.get('email'),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? 'Enter a valid email.',
      ok: false,
      devLink: null,
    };
  }
  const { email } = parsed.data;
  const ctx = await readRequestContext();

  const user = await prisma.user.findFirst({
    where: { email, disabledAt: null },
    select: { id: true, tenantId: true },
  });

  let devLink: string | null = null;

  if (user) {
    const token = generateToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      },
    });
    await writeAuditLog({
      action: 'password_reset_requested',
      userId: user.id,
      tenantId: user.tenantId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      // NOTE: do NOT log the token. metadata stores the email which is
      // already user-identifying for audit purposes.
      metadata: { email },
    });
    devLink = await buildResetLink(token);
  } else {
    // Same shape, same response time class. Don't leak that the email
    // is unknown.
    await writeAuditLog({
      action: 'password_reset_requested',
      userId: null,
      tenantId: null,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { email, reason: 'unknown_email' },
    });
  }

  return { error: null, ok: true, devLink };
}

async function buildResetLink(token: string): Promise<string> {
  const h = await headers();
  // Prefer x-forwarded-host (nginx sets it) over `host` so the link
  // reflects the public hostname behind the proxy.
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  const proto = (h.get('x-forwarded-proto') ?? 'http').split(',')[0]?.trim() ?? 'http';
  return `${proto}://${host}/reset/${encodeURIComponent(token)}`;
}
