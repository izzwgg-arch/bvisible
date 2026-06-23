'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma, Role } from '@bvisible/db';
import { inviteUserSchema } from '@/lib/validators';
import { generateToken, hashToken } from '@/lib/auth/tokens';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireRole } from '@/lib/auth/current-user';
import { resolveEffectiveCompany } from '@/lib/auth/effective-company';
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

  let eff: Awaited<ReturnType<typeof resolveEffectiveCompany>>;
  try {
    eff = await resolveEffectiveCompany(me);
  } catch (e) {
    const { MultipleCompaniesUnresolvedError } = await import(
      '@/lib/company/default-company'
    );
    if (e instanceof MultipleCompaniesUnresolvedError) {
      return {
        error:
          'Multiple companies are configured without a canonical bvisible slug. Resolve under Company settings before inviting users.',
      };
    }
    throw e;
  }

  const targetTenantId = eff.tenantId;

  // Reject if there's already an accepted user with this email in this
  // tenant. Pending unaccepted invites are fine — they'll be rotated.
  const existing = await prisma.user.findFirst({
    where: { email, tenantId: targetTenantId },
    select: { id: true, inviteAcceptedAt: true },
  });
  if (existing?.inviteAcceptedAt) {
    return { error: 'A user with that email already exists for this company.' };
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
    tenantName: eff.tenant.name,
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

export async function resendInviteAction(formData: FormData): Promise<void> {
  const me = await requireRole(Role.ADMIN, Role.SUPER_ADMIN);
  const inviteId = String(formData.get('inviteId') ?? '');
  if (!inviteId) redirect('/admin/users?inviteErr=missing');

  const eff = me.role === Role.SUPER_ADMIN ? null : await resolveEffectiveCompany(me);
  const invite = await prisma.userInvite.findFirst({
    where: {
      id: inviteId,
      acceptedAt: null,
      ...(me.role === Role.SUPER_ADMIN ? {} : { tenantId: eff!.tenantId }),
    },
    select: {
      id: true,
      email: true,
      role: true,
      tenantId: true,
      tenant: { select: { name: true } },
    },
  });

  if (!invite) redirect('/admin/users?inviteErr=not_found');

  const existingAcceptedUser = await prisma.user.findFirst({
    where: { email: invite.email, tenantId: invite.tenantId, inviteAcceptedAt: { not: null } },
    select: { id: true },
  });
  if (existingAcceptedUser) redirect('/admin/users?inviteErr=accepted');

  const token = generateToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await prisma.userInvite.update({
    where: { id: invite.id },
    data: {
      tokenHash: hashToken(token),
      invitedById: me.id,
      expiresAt,
    },
  });

  const inviteLink = await buildInviteLink(token);
  const tenantName = invite.tenant?.name ?? eff?.tenant.name ?? 'B Visible';
  const mail = renderInviteEmail({
    inviteLink,
    role: invite.role,
    tenantName,
    invitedByEmail: me.email,
  });
  const send = await sendMail({
    to: invite.email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });

  const mailDelivery = send.ok
    ? ('sent' as const)
    : send.error instanceof MailerConfigError
      ? ('failed_no_config' as const)
      : (`failed_${send.error.kind}` as const);

  const ctx = await readRequestContext();
  await writeAuditLog({
    action: 'invite_resent',
    userId: me.id,
    tenantId: invite.tenantId,
    targetType: 'invite',
    targetId: invite.email,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { email: invite.email, role: invite.role, inviteId: invite.id, mailDelivery },
  });

  if (send.ok) {
    redirect(`/admin/users?resent=${encodeURIComponent(invite.email)}`);
  }

  const failureKind = send.error instanceof MailerConfigError ? 'no_config' : send.error.kind;
  redirect(
    `/admin/users?invite=${encodeURIComponent(token)}` +
      `&invitedEmail=${encodeURIComponent(invite.email)}` +
      `&mailErr=${encodeURIComponent(failureKind)}`
  );
}

async function buildInviteLink(token: string): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  const proto = (h.get('x-forwarded-proto') ?? 'http').split(',')[0]?.trim() ?? 'http';
  return `${proto}://${host}/invite/${encodeURIComponent(token)}`;
}
