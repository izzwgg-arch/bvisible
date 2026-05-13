'use server';

import { redirect } from 'next/navigation';
import { prisma } from '@bvisible/db';
import { changePasswordSchema } from '@/lib/validators';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { destroyCurrentSession } from '@/lib/auth/session';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireUser } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';

export async function logoutAction(): Promise<void> {
  // Best effort to record before destroying — getCurrentUser is cached
  // for the request so this doesn't double-fetch.
  const user = await requireUser();
  const ctx = await readRequestContext();
  await writeAuditLog({
    action: 'logout',
    userId: user.id,
    tenantId: user.tenantId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
  await destroyCurrentSession();
  redirect('/login');
}

export interface ChangePasswordState {
  error: string | null;
  ok: boolean;
}

export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const user = await requireUser();
  const ctx = await readRequestContext();

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.', ok: false };
  }
  const { currentPassword, newPassword } = parsed.data;

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  if (!row?.passwordHash) {
    return { error: 'No password set on this account. Use the reset flow.', ok: false };
  }
  const ok = await verifyPassword(currentPassword, row.passwordHash);
  if (!ok) {
    return { error: 'Current password is incorrect.', ok: false };
  }

  const newHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });
    // Revoke all sessions EXCEPT the current one. The current cookie
    // remains valid so the user stays signed in here.
    await tx.session.updateMany({
      where: {
        userId: user.id,
        id: { not: user.sessionId },
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  });

  await writeAuditLog({
    action: 'password_changed',
    userId: user.id,
    tenantId: user.tenantId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return { error: null, ok: true };
}
