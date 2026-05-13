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
    heading: 'Reset your password',
    intro:
      'We received a request to reset your B Visible password. ' +
      'Click the button below to choose a new one. ' +
      'If you did not request this, you can safely ignore this email.',
    button: { label: 'Set a new password', href: input.resetLink },
    outro: `This link expires in ${input.expiresInMinutes} minutes and can only be used once.`,
  });
  return { subject, html, text };
}
