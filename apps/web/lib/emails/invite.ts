import { wrapBranded } from './render';

export interface InviteEmailInput {
  inviteLink: string;
  role: 'ADMIN' | 'SUPER_ADMIN' | 'USER';
  tenantName: string;
  invitedByEmail: string;
}

export function renderInviteEmail(input: InviteEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const roleLabel =
    input.role === 'SUPER_ADMIN'
      ? 'Super admin'
      : input.role === 'ADMIN'
        ? 'Admin'
        : 'Member';
  const subject = `You've been invited to ${input.tenantName} on B Visible`;
  const { html, text } = wrapBranded({
    preheader: `${input.invitedByEmail} invited you to join ${input.tenantName}.`,
    heading: `You're invited to ${input.tenantName}`,
    intro:
      `${input.invitedByEmail} invited you to join ${input.tenantName} on B Visible as ${roleLabel}. ` +
      `Set your password using the button below to finish setting up your account.`,
    details: [
      { label: 'Workspace', value: input.tenantName },
      { label: 'Role', value: roleLabel },
    ],
    button: { label: 'Accept invite', href: input.inviteLink },
    outro: 'This invite link expires in 7 days. If it expires, ask the person who invited you to send a new one.',
    reason: `You received this invitation because ${input.invitedByEmail} added this address to ${input.tenantName} in B Visible.`,
  });
  return { subject, html, text };
}
