'use server';

import { requireSuperAdmin } from '@/lib/auth/current-user';
import { testEmailSchema } from '@/lib/validators';
import { sendMail, verifyTransport, MailerConfigError, type SafeSmtpDiagnostics } from '@/lib/mailer';
import { renderTestEmail } from '@/lib/emails/test';

export interface TestEmailState {
  ok: boolean;
  error: string | null;
  // Sanitized diagnostics — never contains the password.
  diagnostics: SafeSmtpDiagnostics | null;
  detail: { code: string | null; responseCode: number | null } | null;
  messageId: string | null;
  recipient: string | null;
}

export async function sendTestEmailAction(
  _prev: TestEmailState,
  formData: FormData
): Promise<TestEmailState> {
  const me = await requireSuperAdmin();

  const parsed = testEmailSchema.safeParse({
    recipient: formData.get('recipient'),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Enter a valid email.',
      diagnostics: null,
      detail: null,
      messageId: null,
      recipient: null,
    };
  }
  const { recipient } = parsed.data;

  // Verify FIRST so we surface auth/connect failures before we generate
  // a body. The transport is pooled so this is one round-trip with the
  // server, not two TCP connections.
  const verify = await verifyTransport();
  if (!verify.ok) {
    return {
      ok: false,
      error: verify.error?.message ?? 'SMTP verify failed.',
      diagnostics: verify.diagnostics,
      detail:
        verify.error && verify.error.kind !== 'config'
          ? { code: verify.error.code ?? null, responseCode: verify.error.responseCode ?? null }
          : null,
      messageId: null,
      recipient,
    };
  }

  const mail = renderTestEmail({ recipientEmail: recipient, sentByEmail: me.email });
  const send = await sendMail({
    to: recipient,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });

  if (!send.ok) {
    const err = send.error;
    return {
      ok: false,
      error: err.message,
      diagnostics: send.diagnostics,
      detail:
        err instanceof MailerConfigError
          ? null
          : { code: err.code ?? null, responseCode: err.responseCode ?? null },
      messageId: null,
      recipient,
    };
  }

  return {
    ok: true,
    error: null,
    diagnostics: send.diagnostics,
    detail: null,
    messageId: send.result.messageId,
    recipient,
  };
}
