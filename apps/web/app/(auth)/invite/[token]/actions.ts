'use server';

import { redirect } from 'next/navigation';
import { Prisma, prisma } from '@bvisible/db';
import { acceptInviteSchema } from '@/lib/validators';
import { hashPassword } from '@/lib/auth/password';
import { hashToken } from '@/lib/auth/tokens';
import { createSession } from '@/lib/auth/session';
import { writeAuditLog } from '@/lib/auth/audit';
import { readRequestContext } from '@/lib/request-context';

export interface AcceptInviteState {
  error: string | null;
}

export async function acceptInviteAction(
  _prev: AcceptInviteState,
  formData: FormData
): Promise<AcceptInviteState> {
  const parsed = acceptInviteSchema.safeParse({
    token: formData.get('token'),
    name: formData.get('name'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { token, name, password } = parsed.data;
  const ctx = await readRequestContext();

  const tokenHash = hashToken(token);
  const passwordHash = await hashPassword(password);

  let userId: string;
  let tenantId: string | null;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const invite = await tx.userInvite.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          email: true,
          role: true,
          tenantId: true,
          expiresAt: true,
          acceptedAt: true,
        },
      });
      if (!invite) throw new InviteError('invalid');
      if (invite.acceptedAt) throw new InviteError('used');
      if (invite.expiresAt.getTime() <= Date.now()) throw new InviteError('expired');

      // Upsert the user. If an existing user with this email + tenant
      // is found, we activate it; otherwise create.
      const existing = await tx.user.findFirst({
        where: { email: invite.email, tenantId: invite.tenantId },
        select: { id: true },
      });

      const now = new Date();
      const created = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              name,
              passwordHash,
              role: invite.role,
              inviteAcceptedAt: now,
              disabledAt: null,
              updatedAt: now,
            },
            select: { id: true, tenantId: true },
          })
        : await tx.user.create({
            data: {
              email: invite.email,
              name,
              role: invite.role,
              tenantId: invite.tenantId,
              passwordHash,
              invitedAt: now,
              inviteAcceptedAt: now,
            },
            select: { id: true, tenantId: true },
          });

      await tx.userInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: now },
      });

      return created;
    });
    userId = result.id;
    tenantId = result.tenantId;
  } catch (err) {
    if (err instanceof InviteError) {
      return { error: 'This invite is no longer valid. Ask your admin for a new one.' };
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { error: 'An account with that email already exists. Try signing in.' };
    }
    throw err;
  }

  await writeAuditLog({
    action: 'invite_accepted',
    userId,
    tenantId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  await createSession({
    userId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
  redirect('/home');
}

class InviteError extends Error {
  constructor(public reason: 'invalid' | 'used' | 'expired') {
    super(reason);
  }
}
