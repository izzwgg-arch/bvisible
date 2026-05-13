import { wrapBranded } from './render';

export interface TestEmailInput {
  recipientEmail: string;
  sentByEmail: string;
}

export function renderTestEmail(input: TestEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = 'B Visible · SMTP test email';
  const { html, text } = wrapBranded({
    heading: 'SMTP delivery is working',
    intro:
      `This test email was triggered by ${input.sentByEmail} and delivered to ${input.recipientEmail}. ` +
      `If you received this, the B Visible mailer can reach your inbox.`,
    outro: 'No action is needed. This message exists only to verify mail delivery.',
    footer:
      'B Visible mailer self-test. Sent from the Email test page in Settings; only SUPER_ADMINs can trigger it.',
  });
  return { subject, html, text };
}
