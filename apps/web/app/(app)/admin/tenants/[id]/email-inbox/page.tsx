import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@bvisible/db';
import { requireSuperAdmin } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
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
            className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-1.5 text-[13px] text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
          >
            All inboxes
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-bv-text)]">
              {inbox ? 'Edit inbox' : 'Configure inbox'}
            </h2>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                !inbox
                  ? 'border-slate-200 bg-slate-50 text-slate-600'
                  : healthy
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              {!inbox ? 'not configured' : healthy ? 'healthy' : inbox.enabled ? 'errored' : 'disabled'}
            </span>
          </div>
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
        </section>

        <aside className="flex flex-col gap-4">
          <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
            <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-bv-text)]">
              Diagnostics
            </h2>
            {!inbox ? (
              <p className="mt-2 text-[12.5px] text-[var(--color-bv-muted)]">
                No inbox configured yet. After saving, this panel will show
                last-polled time, last error, and ingest counts.
              </p>
            ) : (
              <dl className="mt-3 grid grid-cols-[120px_1fr] gap-y-1.5 text-[12.5px]">
                <dt className="text-[var(--color-bv-muted)]">Username</dt>
                <dd className="text-[var(--color-bv-text)]">{maskUsername(inbox.username)}</dd>
                <dt className="text-[var(--color-bv-muted)]">Last polled</dt>
                <dd className="text-[var(--color-bv-text)]">{fmt(inbox.lastPolledAt)}</dd>
                <dt className="text-[var(--color-bv-muted)]">Last error</dt>
                <dd className="text-[var(--color-bv-text)]">{fmt(inbox.lastErrorAt)}</dd>
                <dt className="text-[var(--color-bv-muted)]">Created</dt>
                <dd className="text-[var(--color-bv-text)]">{fmt(inbox.createdAt)}</dd>
                <dt className="text-[var(--color-bv-muted)]">Updated</dt>
                <dd className="text-[var(--color-bv-text)]">{fmt(inbox.updatedAt)}</dd>
              </dl>
            )}
            {inbox?.lastErrorMessage ? (
              <p className="mt-3 rounded-[6px] border border-rose-200 bg-rose-50 p-2 text-[12px] text-rose-800">
                {inbox.lastErrorMessage}
              </p>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-2 text-[12.5px]">
              <CountChip label="Pending" value={counterMap.get('PENDING') ?? 0} />
              <CountChip label="Matched" value={counterMap.get('MATCHED') ?? 0} />
              <CountChip
                label="Unmatched"
                value={counterMap.get('UNMATCHED') ?? 0}
              />
              <CountChip label="Failed" value={counterMap.get('FAILED') ?? 0} />
            </div>
          </section>

          <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
            <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-bv-text)]">
              Recent ticks
            </h2>
            {recentRuns.length === 0 ? (
              <p className="mt-2 text-[12.5px] text-[var(--color-bv-muted)]">
                No ticks yet for this tenant.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1.5 text-[12px]">
                {recentRuns.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-2 rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2 py-1.5"
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
          </section>

          <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
            <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-bv-text)]">
              Recent ingested email
            </h2>
            {recentEmails.length === 0 ? (
              <p className="mt-2 text-[12.5px] text-[var(--color-bv-muted)]">
                Nothing ingested yet.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1 text-[12px]">
                {recentEmails.map((e) => (
                  <li
                    key={e.id}
                    className="flex flex-col gap-0.5 rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2 py-1.5"
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
          </section>
        </aside>
      </div>
    </>
  );
}

function CountChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2 py-1.5">
      <span className="text-[var(--color-bv-muted)]">{label}</span>
      <span className="font-mono tabular-nums text-[var(--color-bv-text)]">
        {value}
      </span>
    </div>
  );
}
