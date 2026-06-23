import { wrapBranded } from './render';

export interface ResetEmailInput {
  resetLink: string;
  expiresInMinutes: number;
}

export function renderResetEmail(input: ResetEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = 'Reset your B Visible password';
  const { html, text } = wrapBranded({
    preheader: `Use this secure link within ${input.expiresInMinutes} minutes to reset your password.`,
    heading: 'Reset your password',
    intro:
      'We received a request to reset your B Visible password. ' +
      'Click the button below to choose a new one. ' +
      'If you did not request this, you can safely ignore this email.',
    button: { label: 'Set a new password', href: input.resetLink },
    outro: `This link expires in ${input.expiresInMinutes} minutes and can only be used once.`,
    reason: 'You received this email because a password reset was requested for a B Visible account using this address.',
  });
  return { subject, html, text };
}
