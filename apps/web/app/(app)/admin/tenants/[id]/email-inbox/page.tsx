import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@bvisible/db';
import { requireSuperAdmin } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { AdminMetric, AdminPanel, AdminPill, adminSecondaryButtonClass } from '@/components/app/admin-ui';
import { InboxForm } from './inbox-form';

export const metadata = { title: 'Tenant inbox' };
export const dynamic = 'force-dynamic';

function fmt(d: Date | null): string {
  if (!d) return '—';
  return d.toISOString().slice(0, 19).replace('T', ' ') + 'Z';
}

function maskUsername(u: string | null): string {
  if (!u) return '—';
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

export default async function TenantEmailInboxPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSuperAdmin();
  const { id } = await params;

  const tenant = await prisma.tenant.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
    },
  });
  if (!tenant) notFound();

  const inbox = await prisma.tenantEmailInbox.findUnique({
    where: { tenantId: id },
    select: {
      id: true,
      host: true,
      port: true,
      secure: true,
      mailbox: true,
      username: true,
      pollIntervalSeconds: true,
      enabled: true,
      lastPolledAt: true,
      lastErrorAt: true,
      lastErrorMessage: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // Read recent ticks + ingest counts so the operator has a single
  // diagnostic surface without bouncing back to /admin/email-ingestion.
  const [recentRuns, statusCounts, recentEmails] = await Promise.all([
    prisma.emailIngestRun.findMany({
      where: { tenantId: id },
      orderBy: [{ startedAt: 'desc' }],
      take: 8,
      select: {
        id: true,
        startedAt: true,
        finishedAt: true,
        durationMs: true,
        scannedCount: true,
        ingestedCount: true,
        matchedCount: true,
        errorCount: true,
        errorMessage: true,
      },
    }),
    prisma.ingestedEmail.groupBy({
      where: { tenantId: id },
      by: ['status'],
      _count: { _all: true },
    }),
    prisma.ingestedEmail.findMany({
      where: { tenantId: id },
      orderBy: [{ createdAt: 'desc' }],
      take: 5,
      select: {
        id: true,
        subject: true,
        fromAddress: true,
        status: true,
        createdAt: true,
      },
    }),
  ]);

  const counterMap = new Map<string, number>();
  for (const c of statusCounts) counterMap.set(c.status, c._count._all);

  const healthy =
    !!inbox &&
    inbox.enabled &&
    !inbox.lastErrorMessage;

  return (
    <>
      <PageHeader
        title={`${tenant.name} — email inbox`}
        subtitle="Per-tenant IMAP inbox for vendor email ingestion. Passwords are encrypted with AES-256-GCM and never displayed."
        actions={
          <Link
            href="/admin/email-ingestion/inboxes"
            className={adminSecondaryButtonClass}
          >
            All inboxes
          </Link>
        }
      />

      <section className="mb-5 grid gap-3 md:grid-cols-4">
        <AdminMetric label="Status" value={!inbox ? 'New' : healthy ? 'Healthy' : inbox.enabled ? 'Errored' : 'Disabled'} detail="Current IMAP configuration state" tone={!inbox ? 'slate' : healthy ? 'emerald' : inbox.enabled ? 'amber' : 'slate'} />
        <AdminMetric label="Pending" value={counterMap.get('PENDING') ?? 0} detail="Emails waiting for processing" tone="amber" />
        <AdminMetric label="Matched" value={counterMap.get('MATCHED') ?? 0} detail="Mail linked to purchase orders" tone="emerald" />
        <AdminMetric label="Failed" value={counterMap.get('FAILED') ?? 0} detail="Messages needing attention" tone="rose" />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <AdminPanel
          title={inbox ? 'Edit inbox' : 'Configure inbox'}
          eyebrow="IMAP setup"
          description="Configure the mailbox that receives vendor quotes, receipts, and purchase-order documents."
          action={<AdminPill tone={!inbox ? 'slate' : healthy ? 'emerald' : 'amber'}>{!inbox ? 'not configured' : healthy ? 'healthy' : inbox.enabled ? 'errored' : 'disabled'}</AdminPill>}
        >
          <div className="p-5">
          <InboxForm
            tenantId={tenant.id}
            existing={
              inbox
                ? {
                    host: inbox.host,
                    port: inbox.port,
                    secure: inbox.secure,
                    mailbox: inbox.mailbox,
                    username: inbox.username,
                    pollIntervalSeconds: inbox.pollIntervalSeconds,
                    enabled: inbox.enabled,
                  }
                : null
            }
          />
          </div>
        </AdminPanel>

        <aside className="flex flex-col gap-4">
          <AdminPanel title="Diagnostics" eyebrow="Connection insight" description="Masked account data, last poll state, and ingestion counts.">
            {!inbox ? (
              <p className="p-5 text-[12.5px] text-slate-500">
                No inbox configured yet. After saving, this panel will show
                last-polled time, last error, and ingest counts.
              </p>
            ) : (
              <dl className="grid grid-cols-[120px_1fr] gap-y-2 p-5 text-[12.5px]">
                <dt className="text-slate-500">Username</dt>
                <dd className="font-mono text-[12px] text-slate-900">{maskUsername(inbox.username)}</dd>
                <dt className="text-slate-500">Last polled</dt>
                <dd className="text-slate-900">{fmt(inbox.lastPolledAt)}</dd>
                <dt className="text-slate-500">Last error</dt>
                <dd className="text-slate-900">{fmt(inbox.lastErrorAt)}</dd>
                <dt className="text-slate-500">Created</dt>
                <dd className="text-slate-900">{fmt(inbox.createdAt)}</dd>
                <dt className="text-slate-500">Updated</dt>
                <dd className="text-slate-900">{fmt(inbox.updatedAt)}</dd>
              </dl>
            )}
            {inbox?.lastErrorMessage ? (
              <p className="mx-5 rounded-[14px] border border-rose-200 bg-rose-50 p-3 text-[12px] text-rose-800">
                {inbox.lastErrorMessage}
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-2 p-5 pt-3 text-[12.5px]">
              <CountChip label="Pending" value={counterMap.get('PENDING') ?? 0} />
              <CountChip label="Matched" value={counterMap.get('MATCHED') ?? 0} />
              <CountChip
                label="Unmatched"
                value={counterMap.get('UNMATCHED') ?? 0}
              />
              <CountChip label="Failed" value={counterMap.get('FAILED') ?? 0} />
            </div>
          </AdminPanel>

          <AdminPanel title="Recent ticks" eyebrow="Timer health" description="Latest polling runs for this tenant.">
            {recentRuns.length === 0 ? (
              <p className="p-5 text-[12.5px] text-slate-500">
                No ticks yet for this tenant.
              </p>
            ) : (
              <ul className="flex flex-col gap-2 p-4 text-[12px]">
                {recentRuns.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-2 rounded-[14px] border border-slate-100 bg-white px-3 py-2 shadow-sm"
                  >
                    <span className="font-mono text-[11px] tabular-nums text-[var(--color-bv-muted)]">
                      {r.startedAt.toISOString().slice(11, 16)}
                    </span>
                    <span className="text-[var(--color-bv-text)]">
                      {r.scannedCount} scanned · {r.ingestedCount} ingested ·{' '}
                      {r.matchedCount} matched
                    </span>
                    {r.errorCount > 0 ? (
                      <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10.5px] font-medium text-rose-700">
                        {r.errorCount} err
                      </span>
                    ) : null}
                    {r.durationMs ? (
                      <span className="text-[11px] text-[var(--color-bv-muted)]">
                        {r.durationMs} ms
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </AdminPanel>

          <AdminPanel title="Recent ingested email" eyebrow="Mail flow" description="Latest messages captured from this inbox.">
            {recentEmails.length === 0 ? (
              <p className="p-5 text-[12.5px] text-slate-500">
                Nothing ingested yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-2 p-4 text-[12px]">
                {recentEmails.map((e) => (
                  <li
                    key={e.id}
                    className="flex flex-col gap-0.5 rounded-[14px] border border-slate-100 bg-white px-3 py-2 shadow-sm"
                  >
                    <span className="font-medium text-[var(--color-bv-text)]">
                      {e.subject || '(no subject)'}
                    </span>
                    <span className="flex items-center gap-2 text-[11px] text-[var(--color-bv-muted)]">
                      <code className="font-mono text-[11px]">{e.fromAddress}</code>
                      <span>·</span>
                      <span className="rounded-full border border-[var(--color-bv-border)] px-1.5 py-0.5 text-[10px]">
                        {e.status.toLowerCase()}
                      </span>
                      <span>·</span>
                      <span>{e.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </AdminPanel>
        </aside>
      </div>
    </>
  );
}

function CountChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-[14px] border border-slate-100 bg-white px-3 py-2 shadow-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-mono tabular-nums text-slate-950">
        {value}
      </span>
    </div>
  );
}
