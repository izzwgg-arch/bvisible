'use server';

import { redirect } from 'next/navigation';
import { prisma } from '@bvisible/db';
import { completeResetSchema } from '@/lib/validators';
import { hashPassword } from '@/lib/auth/password';
import { hashToken } from '@/lib/auth/tokens';
import { createSession } from '@/lib/auth/session';
import { writeAuditLog } from '@/lib/auth/audit';
import { readRequestContext } from '@/lib/request-context';

export interface CompleteResetState {
  error: string | null;
}

export async function completeResetAction(
  _prev: CompleteResetState,
  formData: FormData
): Promise<CompleteResetState> {
  const parsed = completeResetSchema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { token, password } = parsed.data;
  const ctx = await readRequestContext();

  const tokenHash = hashToken(token);

  // Atomic: validate, hash password, mark token used, update user, kill
  // existing sessions. If any step fails, the transaction rolls back.
  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.passwordResetToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        usedAt: true,
        user: { select: { id: true, tenantId: true, disabledAt: true } },
      },
    });
    if (!row) return { ok: false as const, reason: 'invalid' };
    if (row.usedAt) return { ok: false as const, reason: 'used' };
    if (row.expiresAt.getTime() <= Date.now()) return { ok: false as const, reason: 'expired' };
    if (row.user.disabledAt) return { ok: false as const, reason: 'disabled' };

    const newHash = await hashPassword(password);

    await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash: newHash, updatedAt: new Date() },
    });
    await tx.passwordResetToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    });
    // Revoke all live sessions for this user — password change should
    // invalidate every signed-in device.
    await tx.session.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true as const, userId: row.userId, tenantId: row.user.tenantId };
  });

  if (!result.ok) {
    return { error: 'This reset link is no longer valid. Request a new one.' };
  }

  await writeAuditLog({
    action: 'password_reset_completed',
    userId: result.userId,
    tenantId: result.tenantId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  // Auto-sign in.
  await createSession({
    userId: result.userId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
  redirect('/dashboard');
}
