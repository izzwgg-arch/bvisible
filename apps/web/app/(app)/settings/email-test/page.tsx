import { requireSuperAdmin } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { loadSmtpConfig, MailerConfigError, diagnosticsFor } from '@/lib/mailer';
import { TestEmailForm } from './test-email-form';

export const metadata = { title: 'Email test' };
export const dynamic = 'force-dynamic';

export default async function EmailTestPage() {
  const me = await requireSuperAdmin();
  const config = loadSmtpConfig();
  const configured = !(config instanceof MailerConfigError);
  const diag = configured ? diagnosticsFor(config) : null;

  return (
    <>
      <PageHeader
        title="Email test"
        subtitle="Verify SMTP delivery from this server. SUPER_ADMIN only."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
          <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-bv-text)]">
            SMTP configuration
          </h2>
          <p className="mt-1 text-[13px] text-[var(--color-bv-muted)]">
            Read from <code className="font-mono text-[12px]">/opt/bvisible/shared/env/.env</code>.
            Passwords are never displayed.
          </p>

          {configured && diag ? (
            <dl className="mt-4 grid grid-cols-[140px_1fr] gap-y-2 text-[13.5px]">
              <dt className="text-[var(--color-bv-muted)]">Host</dt>
              <dd className="text-[var(--color-bv-text)] font-mono text-[12.5px]">{diag.host}</dd>
              <dt className="text-[var(--color-bv-muted)]">Port</dt>
              <dd className="text-[var(--color-bv-text)] font-mono text-[12.5px]">{diag.port}</dd>
              <dt className="text-[var(--color-bv-muted)]">Secure</dt>
              <dd className="text-[var(--color-bv-text)] font-mono text-[12.5px]">
                {diag.secure ? 'true (TLS-on-connect)' : 'false (STARTTLS or plain)'}
              </dd>
              <dt className="text-[var(--color-bv-muted)]">User</dt>
              <dd className="text-[var(--color-bv-text)] font-mono text-[12.5px]">{diag.maskedUser}</dd>
              <dt className="text-[var(--color-bv-muted)]">From</dt>
              <dd className="text-[var(--color-bv-text)] font-mono text-[12.5px]">{diag.from}</dd>
              {diag.replyTo ? (
                <>
                  <dt className="text-[var(--color-bv-muted)]">Reply-To</dt>
                  <dd className="text-[var(--color-bv-text)] font-mono text-[12.5px]">{diag.replyTo}</dd>
                </>
              ) : null}
            </dl>
          ) : (
            <div className="mt-4 rounded-[8px] border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
              <p className="font-medium">SMTP is not configured.</p>
              <p className="mt-1 text-[12.5px] text-amber-800">
                {(config as MailerConfigError).message}
              </p>
              <p className="mt-2 text-[12px] text-amber-800">
                Set <code className="font-mono">SMTP_HOST</code>, <code className="font-mono">SMTP_PORT</code>,{' '}
                <code className="font-mono">SMTP_USER</code>, <code className="font-mono">SMTP_PASSWORD</code>,{' '}
                <code className="font-mono">SMTP_FROM</code> (and optionally{' '}
                <code className="font-mono">SMTP_SECURE</code>,{' '}
                <code className="font-mono">SMTP_REPLY_TO</code>) in{' '}
                <code className="font-mono">/opt/bvisible/shared/env/.env</code>, then redeploy.
              </p>
            </div>
          )}
        </section>

        <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
          <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-bv-text)]">
            Send a test email
          </h2>
          <p className="mt-1 text-[13px] text-[var(--color-bv-muted)]">
            We will run an SMTP <code className="font-mono text-[12px]">verify()</code> first, then send a
            branded test message. Errors are sanitized before display — no credentials leak to the UI.
          </p>
          <div className="mt-4">
            <TestEmailForm defaultRecipient={me.email} />
          </div>
        </section>
      </div>
    </>
  );
}
