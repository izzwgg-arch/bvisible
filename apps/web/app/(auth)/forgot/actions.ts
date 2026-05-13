'use server';

import { headers } from 'next/headers';
import { prisma } from '@bvisible/db';
import { requestResetSchema } from '@/lib/validators';
import { generateToken, hashToken } from '@/lib/auth/tokens';
import { writeAuditLog } from '@/lib/auth/audit';
import { readRequestContext } from '@/lib/request-context';
import { sendMail, MailerConfigError } from '@/lib/mailer';
import { renderResetEmail } from '@/lib/emails/reset';

export interface RequestResetState {
  error: string | null;
  ok: boolean;
}

const RESET_TTL_MS = 30 * 60 * 1000;
const RESET_TTL_MIN = Math.round(RESET_TTL_MS / 60_000);

export async function requestResetAction(
  _prev: RequestResetState,
  formData: FormData
): Promise<RequestResetState> {
  const parsed = requestResetSchema.safeParse({
    email: formData.get('email'),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? 'Enter a valid email.',
      ok: false,
    };
  }
  const { email } = parsed.data;
  const ctx = await readRequestContext();

  const user = await prisma.user.findFirst({
    where: { email, disabledAt: null },
    select: { id: true, tenantId: true },
  });

  // Always respond with the same generic OK regardless of whether the
  // email exists OR whether SMTP delivery succeeds. Deliberate: the
  // public form must not let an attacker enumerate accounts and must
  // not leak that mail is misconfigured. SMTP failures are surfaced
  // instead via:
  //   - `audit_logs.metadata.mailDelivery` (operator query)
  //   - the SUPER_ADMIN /settings/email-test page (manual probe)

  if (!user) {
    await writeAuditLog({
      action: 'password_reset_requested',
      userId: null,
      tenantId: null,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { email, reason: 'unknown_email', mailDelivery: 'skipped_no_user' },
    });
    return { error: null, ok: true };
  }

  const token = generateToken();
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    },
  });

  const resetLink = await buildResetLink(token);
  const mail = renderResetEmail({ resetLink, expiresInMinutes: RESET_TTL_MIN });
  const send = await sendMail({
    to: email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });

  // Audit metadata: NEVER includes the token or the link. Just the
  // delivery outcome and (on failure) a typed error kind so an operator
  // can correlate the failure with the mailer logs without grepping.
  const mailDelivery = send.ok
    ? ('sent' as const)
    : send.error instanceof MailerConfigError
      ? ('failed_no_config' as const)
      : (`failed_${send.error.kind}` as const);

  await writeAuditLog({
    action: 'password_reset_requested',
    userId: user.id,
    tenantId: user.tenantId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { email, mailDelivery },
  });

  return { error: null, ok: true };
}

async function buildResetLink(token: string): Promise<string> {
  const h = await headers();
  // Prefer x-forwarded-host (nginx sets it) over `host` so the link
  // reflects the public hostname behind the proxy.
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  const proto = (h.get('x-forwarded-proto') ?? 'http').split(',')[0]?.trim() ?? 'http';
  return `${proto}://${host}/reset/${encodeURIComponent(token)}`;
}
