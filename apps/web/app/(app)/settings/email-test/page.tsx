import { requireSuperAdmin } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { AdminMetric, AdminPanel, AdminPill } from '@/components/app/admin-ui';
import { loadSmtpConfigFromDb, MailerConfigError, diagnosticsFor } from '@/lib/mailer';
import { prisma } from '@bvisible/db';
import { TestEmailForm } from './test-email-form';
import { SmtpConfigForm } from './smtp-config-form';

export const metadata = { title: 'Email test' };
export const dynamic = 'force-dynamic';

export default async function EmailTestPage() {
  const me = await requireSuperAdmin();
  const [config, existingRow] = await Promise.all([
    loadSmtpConfigFromDb(),
    prisma.smtpConfig.findFirst({
      select: { id: true, host: true, port: true, secure: true, user: true, from: true, replyTo: true },
    }),
  ]);
  const configured = !(config instanceof MailerConfigError);
  const diag = configured ? diagnosticsFor(config) : null;

  return (
    <>
      <PageHeader
        title="Email test"
        subtitle="SMTP delivery diagnostics for quotes, invites, and operational notifications. Credentials stay masked."
      />

      <section className="mb-5 grid gap-3 md:grid-cols-3">
        <AdminMetric label="SMTP status" value={configured ? 'Configured' : 'Missing'} detail="Read from production env" tone={configured ? 'emerald' : 'amber'} />
        <AdminMetric label="Transport" value={diag?.secure ? 'TLS' : configured ? 'STARTTLS' : '—'} detail="Connection security mode" tone="blue" />
        <AdminMetric label="Sender" value={diag?.from ? 'Ready' : '—'} detail={diag?.from ?? 'No SMTP_FROM'} tone="violet" />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <AdminPanel
          title="SMTP configuration"
          eyebrow="Mailer settings"
          description="Outbound email credentials. Password is encrypted before it lands in the database."
          action={<AdminPill tone={configured ? 'emerald' : 'amber'}>{configured ? 'configured' : 'missing'}</AdminPill>}
        >
          <div className="p-5">
            <SmtpConfigForm existing={existingRow} />
          </div>
        </AdminPanel>

        <AdminPanel
          title="Send a test email"
          eyebrow="Delivery proof"
          description="Runs SMTP verify() first, then sends a branded test message. Errors are sanitized before display."
        >
          <div className="p-5">
            <TestEmailForm defaultRecipient={me.email} />
          </div>
        </AdminPanel>
      </div>
    </>
  );
}
