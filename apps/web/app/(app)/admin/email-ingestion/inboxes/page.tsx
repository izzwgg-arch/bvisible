import Link from 'next/link';
import { prisma } from '@bvisible/db';
import { requireSuperAdmin } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { AdminMetric, AdminPanel, AdminPill, adminSecondaryButtonClass } from '@/components/app/admin-ui';

export const metadata = { title: 'Email inboxes' };
export const dynamic = 'force-dynamic';

function fmt(d: Date | null): string {
  if (!d) return '—';
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function maskUsername(u: string): string {
  const at = u.indexOf('@');
  if (at <= 0) {
    if (u.length <= 2) return '***';
    return `${u[0]}***${u[u.length - 1]}`;
  }
  const local = u.slice(0, at);
  const domain = u.slice(at);
  if (local.length <= 2) return `***${domain}`;
  return `${local[0]}***${local[local.length - 1]}${domain}`;
}

export default async function AllInboxesPage() {
  await requireSuperAdmin();

  // Reads every tenant + its (optional) inbox row with a single query.
  // Tenants without an inbox still appear so SUPER_ADMIN can see what's
  // missing at a glance.
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      slug: true,
      emailInbox: {
        select: {
          host: true,
          port: true,
          secure: true,
          mailbox: true,
          username: true,
          enabled: true,
          pollIntervalSeconds: true,
          lastPolledAt: true,
          lastErrorAt: true,
          lastErrorMessage: true,
          updatedAt: true,
        },
      },
    },
  });

  const totals = {
    configured: tenants.filter((t) => t.emailInbox).length,
    healthy: tenants.filter(
      (t) => t.emailInbox && t.emailInbox.enabled && !t.emailInbox.lastErrorMessage
    ).length,
    errored: tenants.filter(
      (t) => t.emailInbox && t.emailInbox.lastErrorMessage
    ).length,
    disabled: tenants.filter(
      (t) => t.emailInbox && !t.emailInbox.enabled
    ).length,
  };

  return (
    <>
      <PageHeader
        title="Email inboxes"
        subtitle="System-wide inbox command center for vendor email ingestion across every company."
      />

      <section className="mb-5 grid gap-3 md:grid-cols-4">
        <AdminMetric label="Configured" value={totals.configured} detail="Companies with IMAP settings" />
        <AdminMetric label="Healthy" value={totals.healthy} detail="Enabled without last error" tone="emerald" />
        <AdminMetric label="Errored" value={totals.errored} detail="Need connection review" tone="rose" />
        <AdminMetric label="Disabled" value={totals.disabled} detail="Configured but paused" tone="slate" />
      </section>

      <AdminPanel
        title="Inbox fleet"
        eyebrow="Email operations"
        description="Configure, rotate credentials, and monitor IMAP ingestion health without exposing passwords."
      >
        <div className="grid gap-3 p-4">
              {tenants.map((t) => {
                const inbox = t.emailInbox;
                const status = !inbox
                  ? ('not-configured' as const)
                  : !inbox.enabled
                    ? ('disabled' as const)
                    : inbox.lastErrorMessage
                      ? ('errored' as const)
                      : ('healthy' as const);
                return (
                  <article
                    key={t.id}
                    className="grid gap-4 rounded-[18px] border border-slate-100 bg-white px-4 py-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-100 hover:shadow-[0_18px_42px_rgba(15,23,42,0.08)] xl:grid-cols-[minmax(0,1fr)_150px_minmax(0,1fr)_140px_120px]"
                  >
                    <div className="min-w-0">
                      <h3 className="truncate text-[14px] font-semibold text-slate-950">{t.name}</h3>
                      <p className="mt-1 font-mono text-[11.5px] text-slate-500">{t.slug}</p>
                    </div>
                    <div>
                      <StatusChip status={status} />
                    </div>
                    <div className="min-w-0 text-[12.5px] text-slate-500">
                      {inbox ? (
                        <span className="font-mono text-[12px] text-slate-700">
                          {inbox.host}:{inbox.port}
                          {inbox.secure ? '' : ' (STARTTLS/plain)'}
                        </span>
                      ) : (
                        'No inbox configured'
                      )}
                      <div className="mt-1 font-mono text-[11.5px] text-slate-500">
                        {inbox ? inbox.mailbox : '—'}
                      </div>
                    </div>
                    <div className="font-mono text-[12px] text-slate-500">
                      {inbox ? (
                        maskUsername(inbox.username)
                      ) : (
                        '—'
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 xl:justify-end">
                      <span className="text-[12px] text-slate-500 tabular-nums">
                      {inbox ? fmt(inbox.lastPolledAt) : '—'}
                      </span>
                      <Link
                        href={`/admin/tenants/${t.id}/email-inbox`}
                        className={adminSecondaryButtonClass}
                      >
                        {inbox ? 'Edit' : 'Configure'}
                      </Link>
                    </div>
                  </article>
                );
              })}
              {tenants.length === 0 ? (
                <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-[13px] text-slate-500">
                    No tenants yet.
                </div>
              ) : null}
        </div>
      </AdminPanel>
    </>
  );
}

function StatusChip({
  status,
}: {
  status: 'healthy' | 'errored' | 'disabled' | 'not-configured';
}) {
  const label =
    status === 'not-configured' ? 'not configured' : status;
  const tone =
    status === 'healthy' ? 'emerald' : status === 'errored' ? 'amber' : 'slate';
  return <AdminPill tone={tone}>{label}</AdminPill>;
}
