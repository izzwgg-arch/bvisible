import Link from 'next/link';
import { prisma } from '@bvisible/db';
import { requireSuperAdmin } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';

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
        subtitle="System-wide view. SUPER_ADMIN can configure, rotate credentials, and disable any tenant's IMAP inbox here."
      />

      <div className="mb-4 grid gap-2 text-[12.5px] sm:grid-cols-4">
        <Stat label="Configured" value={totals.configured} />
        <Stat label="Healthy" value={totals.healthy} tone="ok" />
        <Stat label="Errored" value={totals.errored} tone="bad" />
        <Stat label="Disabled" value={totals.disabled} tone="muted" />
      </div>

      <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-bv-border)] text-left text-[11.5px] uppercase tracking-wider text-[var(--color-bv-muted)]">
                <th className="px-5 py-2 font-medium">Tenant</th>
                <th className="px-5 py-2 font-medium">Status</th>
                <th className="px-5 py-2 font-medium">Host</th>
                <th className="px-5 py-2 font-medium">Mailbox</th>
                <th className="px-5 py-2 font-medium">Username</th>
                <th className="px-5 py-2 font-medium">Last polled</th>
                <th className="px-5 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
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
                  <tr
                    key={t.id}
                    className="border-b border-[var(--color-bv-border)] last:border-b-0"
                  >
                    <td className="px-5 py-2.5">
                      <div className="flex flex-col">
                        <span className="text-[var(--color-bv-text)]">{t.name}</span>
                        <span className="font-mono text-[11.5px] text-[var(--color-bv-muted)]">
                          {t.slug}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-2.5">
                      <StatusChip status={status} />
                    </td>
                    <td className="px-5 py-2.5 text-[var(--color-bv-muted)]">
                      {inbox ? (
                        <span className="font-mono text-[12px]">
                          {inbox.host}:{inbox.port}
                          {inbox.secure ? '' : ' (STARTTLS/plain)'}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-[var(--color-bv-muted)]">
                      {inbox ? (
                        <span className="font-mono text-[12px]">{inbox.mailbox}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-[var(--color-bv-muted)]">
                      {inbox ? (
                        <span className="font-mono text-[12px]">
                          {maskUsername(inbox.username)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-[var(--color-bv-muted)]">
                      {inbox ? fmt(inbox.lastPolledAt) : '—'}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <Link
                        href={`/admin/tenants/${t.id}/email-inbox`}
                        className="inline-flex items-center justify-center rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-surface)]"
                      >
                        {inbox ? 'Edit' : 'Configure'}
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {tenants.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-8 text-center text-[var(--color-bv-muted)]"
                  >
                    No tenants yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'ok' | 'bad' | 'muted';
}) {
  const cls =
    tone === 'ok'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : tone === 'bad'
        ? 'border-rose-200 bg-rose-50 text-rose-800'
        : tone === 'muted'
          ? 'border-slate-200 bg-slate-50 text-slate-700'
          : 'border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] text-[var(--color-bv-text)]';
  return (
    <div className={`flex items-center justify-between rounded-[8px] border px-3 py-2 ${cls}`}>
      <span className="text-[12px] uppercase tracking-wider opacity-80">{label}</span>
      <span className="font-mono text-[14px] tabular-nums">{value}</span>
    </div>
  );
}

function StatusChip({
  status,
}: {
  status: 'healthy' | 'errored' | 'disabled' | 'not-configured';
}) {
  const map = {
    healthy: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    errored: 'border-amber-200 bg-amber-50 text-amber-800',
    disabled: 'border-slate-200 bg-slate-50 text-slate-600',
    'not-configured': 'border-slate-200 bg-slate-50 text-slate-500',
  } as const;
  const label =
    status === 'not-configured' ? 'not configured' : status;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${map[status]}`}
    >
      {label}
    </span>
  );
}
