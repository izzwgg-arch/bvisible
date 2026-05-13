'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma, Role } from '@bvisible/db';
import { inviteUserSchema } from '@/lib/validators';
import { generateToken, hashToken } from '@/lib/auth/tokens';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireRole } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';
import { sendMail, MailerConfigError } from '@/lib/mailer';
import { renderInviteEmail } from '@/lib/emails/invite';

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

  // Send the invite email. SMTP failures are caught and surfaced to
  // the admin (not the invitee — they have no UI yet) so the flow is
  // never blocked: we fall back to displaying the link inline so the
  // admin can manually deliver it. This keeps the team unblocked when
  // the SMTP provider hiccups.
  const inviteLink = await buildInviteLink(token);
  const mail = renderInviteEmail({
    inviteLink,
    role,
    tenantName: me.tenant?.name ?? 'B Visible',
    invitedByEmail: me.email,
  });
  const send = await sendMail({
    to: email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });

  const mailDelivery = send.ok
    ? ('sent' as const)
    : send.error instanceof MailerConfigError
      ? ('failed_no_config' as const)
      : (`failed_${send.error.kind}` as const);

  await writeAuditLog({
    action: 'invite_created',
    userId: me.id,
    tenantId: targetTenantId,
    targetType: 'invite',
    targetId: email,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { email, role, mailDelivery },
  });

  if (send.ok) {
    redirect(`/admin/users?sent=${encodeURIComponent(email)}`);
  }

  // SMTP failed: show the invite link inline so the admin can deliver
  // it manually. The token is single-use so this is no worse than the
  // pre-mailer state.
  const failureKind = send.error instanceof MailerConfigError ? 'no_config' : send.error.kind;
  redirect(
    `/admin/users?invite=${encodeURIComponent(token)}` +
      `&invitedEmail=${encodeURIComponent(email)}` +
      `&mailErr=${encodeURIComponent(failureKind)}`
  );
}

async function buildInviteLink(token: string): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  const proto = (h.get('x-forwarded-proto') ?? 'http').split(',')[0]?.trim() ?? 'http';
  return `${proto}://${host}/invite/${encodeURIComponent(token)}`;
}
