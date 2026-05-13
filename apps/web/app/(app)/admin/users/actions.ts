'use server';

import { redirect } from 'next/navigation';
import { prisma, Role } from '@bvisible/db';
import { inviteUserSchema } from '@/lib/validators';
import { generateToken, hashToken } from '@/lib/auth/tokens';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireRole } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';

export interface InviteUserState {
  error: string | null;
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function inviteUserAction(
  _prev: InviteUserState,
  formData: FormData
): Promise<InviteUserState> {
  const me = await requireRole(Role.ADMIN, Role.SUPER_ADMIN);

  const parsed = inviteUserSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { email, role } = parsed.data;

  // Tenant scope: ADMIN invites into their own tenant. SUPER_ADMIN can
  // invite into any tenant — for now, only their own (if they have
  // one); cross-tenant invites land when /admin/tenants gets a "set
  // active tenant" affordance.
  const targetTenantId = me.tenantId;
  if (!targetTenantId) {
    return {
      error:
        'You are not in a tenant context. Create a tenant first under Tenants, or attach yourself to a tenant.',
    };
  }

  // Reject if there's already an accepted user with this email in this
  // tenant. Pending unaccepted invites are fine — they'll be rotated.
  const existing = await prisma.user.findFirst({
    where: { email, tenantId: targetTenantId },
    select: { id: true, inviteAcceptedAt: true },
  });
  if (existing?.inviteAcceptedAt) {
    return { error: 'A user with that email already exists in this tenant.' };
  }

  const token = generateToken();
  const ctx = await readRequestContext();

  await prisma.userInvite.create({
    data: {
      email,
      role,
      tenantId: targetTenantId,
      tokenHash: hashToken(token),
      invitedById: me.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });

  await writeAuditLog({
    action: 'invite_created',
    userId: me.id,
    tenantId: targetTenantId,
    targetType: 'invite',
    targetId: email,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { email, role },
  });

  // Show the invite link inline — the page reads `?invite=<token>` and
  // displays it once. Email sending is stubbed until SMTP is wired.
  redirect(`/admin/users?invite=${encodeURIComponent(token)}&invitedEmail=${encodeURIComponent(email)}`);
}
